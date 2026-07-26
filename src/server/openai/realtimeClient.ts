import WebSocket from 'ws';
import { EventEmitter } from 'events';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

/**
 * RMS-based speech detection and silence commit.
 *
 * Pre-roll buffer: keeps recent silent chunks in memory so that when speech
 * is detected, the preceding ~500ms of audio is also sent to OpenAI,
 * preventing the first syllable from being clipped.
 */
const SPEECH_RMS_THRESHOLD = 0.003;
const SILENCE_RMS_THRESHOLD = 0.003;
const SILENCE_DURATION_MS = 1500;
const PRE_ROLL_MS = 500;
const CHUNK_MS = 100;
const PRE_ROLL_CHUNKS = Math.ceil(PRE_ROLL_MS / CHUNK_MS); // 5 chunks

interface RealtimeEvents {
  connected: [];
  disconnected: [];
  error: [error: string];
  transcript_delta: [text: string];
  transcript_final: [text: string];
}

export class RealtimeClient extends EventEmitter<RealtimeEvents> {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sessionReady = false;
  private hasUncommittedAudio = false;
  private hasSpeechInBuffer = false;
  private silenceSinceMs: number | null = null;
  private silenceCheckTimer: ReturnType<typeof setInterval> | null = null;
  private preRollBuffer: string[] = []; // circular buffer of recent silent chunks (base64)

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  connect(): void {
    this.ws = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log('[openai] connected to Realtime API (transcription)');

      // Configure transcription session
      this.send({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              transcription: {
                model: 'gpt-4o-transcribe',
                language: 'ko',
              },
              turn_detection: null,
            },
          },
        },
      });

      // Start silence check interval (every 100ms)
      this.silenceCheckTimer = setInterval(() => this.checkSilence(), 100);

      this.emit('connected');
    });

    this.ws.on('message', (data: Buffer) => {
      let event: { type: string; [key: string]: unknown };
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (event.type) {
        case 'session.created':
          console.log('[openai] session created');
          break;

        case 'session.updated':
          console.log('[openai] session configured (transcription)');
          this.sessionReady = true;
          break;

        case 'conversation.item.input_audio_transcription.delta': {
          const delta = (event.delta as string) ?? '';
          if (delta) {
            this.emit('transcript_delta', delta);
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const text = (event.transcript as string)?.trim();
          if (text) {
            console.log(`[openai] transcript final: "${text}"`);
            this.emit('transcript_final', text);
          }
          break;
        }

        case 'input_audio_buffer.committed':
          console.log('[openai] buffer committed');
          break;

        case 'error':
          console.error('[openai] error:', JSON.stringify(event.error));
          this.emit('error', JSON.stringify(event.error));
          break;

        default:
          console.log(`[openai] event: ${event.type}`);
          break;
      }
    });

    this.ws.on('close', () => {
      console.log('[openai] disconnected');
      this.cleanup();
      this.emit('disconnected');
      this.ws = null;
    });

    this.ws.on('error', (err) => {
      console.error('[openai] ws error:', err.message);
      this.emit('error', err.message);
    });
  }

  /** Send base64 audio to OpenAI input buffer, with RMS for silence detection */
  appendAudio(base64Audio: string, rms: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.sessionReady) return;

    const isSpeech = rms >= SPEECH_RMS_THRESHOLD;

    if (!isSpeech && !this.hasSpeechInBuffer) {
      // No speech yet — store in pre-roll buffer only
      this.preRollBuffer.push(base64Audio);
      if (this.preRollBuffer.length > PRE_ROLL_CHUNKS) {
        this.preRollBuffer.shift();
      }
      return;
    }

    if (isSpeech && !this.hasSpeechInBuffer) {
      // Speech just started — flush pre-roll buffer first
      const flushedCount = this.preRollBuffer.length;
      for (const chunk of this.preRollBuffer) {
        this.send({ type: 'input_audio_buffer.append', audio: chunk });
      }
      this.preRollBuffer = [];
      console.log(`[openai] speech detected (RMS=${rms.toFixed(4)}), flushed ${flushedCount} pre-roll chunks`);
    }

    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });

    this.hasUncommittedAudio = true;

    if (isSpeech) {
      // Voice detected — mark buffer as containing speech, reset silence tracking
      this.hasSpeechInBuffer = true;
      this.silenceSinceMs = null;
    } else {
      // Silent chunk after speech — start or continue silence tracking
      if (this.silenceSinceMs === null) {
        this.silenceSinceMs = Date.now();
      }
    }
  }

  /** Manually commit the audio buffer */
  commit(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.sessionReady) return;
    if (!this.hasUncommittedAudio) return;

    this.send({ type: 'input_audio_buffer.commit' });
    this.hasUncommittedAudio = false;
    this.hasSpeechInBuffer = false;
    this.silenceSinceMs = null;
    this.preRollBuffer = [];
    console.log('[openai] commit sent');
  }

  /**
   * Flush remaining audio and wait for transcript before closing.
   * Commits if there's uncommitted speech, waits up to timeoutMs for
   * the final transcript, then closes.
   */
  flushAndClose(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      // If nothing to flush, close immediately
      if (!this.hasUncommittedAudio || !this.hasSpeechInBuffer) {
        console.log('[openai] flushAndClose: nothing to flush, closing');
        this.disconnect();
        resolve();
        return;
      }

      console.log('[openai] flushAndClose: committing remaining audio');
      this.commit();

      // Wait for transcript_final or timeout
      const onFinal = () => {
        clearTimeout(timer);
        console.log('[openai] flushAndClose: final received, closing');
        // Small delay to let translation fire before disconnect
        setTimeout(() => {
          this.disconnect();
          resolve();
        }, 500);
      };

      const timer = setTimeout(() => {
        this.removeListener('transcript_final', onFinal);
        console.log('[openai] flushAndClose: timeout, closing');
        this.disconnect();
        resolve();
      }, timeoutMs);

      this.once('transcript_final', onFinal);
    });
  }

  disconnect(): void {
    this.cleanup();
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(msg: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Called periodically to check if silence duration has been reached */
  private checkSilence(): void {
    if (!this.hasUncommittedAudio || !this.hasSpeechInBuffer || this.silenceSinceMs === null) return;

    const silenceMs = Date.now() - this.silenceSinceMs;
    if (silenceMs >= SILENCE_DURATION_MS) {
      console.log(`[openai] silence ${silenceMs}ms (RMS < ${SILENCE_RMS_THRESHOLD}) — committing`);
      this.commit();
    }
  }

  private cleanup(): void {
    if (this.silenceCheckTimer) {
      clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
    this.silenceSinceMs = null;
    this.hasSpeechInBuffer = false;
    this.sessionReady = false;
    this.preRollBuffer = [];
  }
}
