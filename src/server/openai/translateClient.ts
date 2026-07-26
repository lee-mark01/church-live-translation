import WebSocket from 'ws';
import { EventEmitter } from 'events';

const OPENAI_TRANSLATE_URL =
  'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate';

import type { OutputLanguage } from '../../lib/languages';

interface TranslateEvents {
  connected: [];
  disconnected: [];
  error: [error: string];
  /** Streaming translated text delta */
  output_delta: [text: string];
  /** Korean source transcript delta */
  input_delta: [text: string];
  /** Latency measurement: ms from last audio append to first output delta */
  latency: [ms: number];
}

/**
 * OpenAI gpt-realtime-translate WebSocket client.
 *
 * One instance per output language. No manual commit needed —
 * just keep appending audio and the model handles segmentation internally.
 */
export class TranslateClient extends EventEmitter<TranslateEvents> {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: OutputLanguage;
  private sessionReady = false;
  private lastAudioAppendAt = 0;
  private waitingForDelta = false;

  constructor(apiKey: string, language: OutputLanguage) {
    super();
    this.apiKey = apiKey;
    this.language = language;
  }

  connect(): void {
    this.ws = new WebSocket(OPENAI_TRANSLATE_URL, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log(`[translate:${this.language}] connected`);

      this.send({
        type: 'session.update',
        session: {
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
              noise_reduction: { type: 'near_field' },
            },
            output: {
              language: this.language,
            },
          },
        },
      });

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
          console.log(`[translate:${this.language}] session created`);
          break;

        case 'session.updated':
          console.log(`[translate:${this.language}] session configured`);
          this.sessionReady = true;
          break;

        // Translated output text
        case 'session.output_transcript.delta': {
          const delta = (event.delta as string) ?? '';
          if (delta) {
            if (this.waitingForDelta && this.lastAudioAppendAt > 0) {
              const latencyMs = Date.now() - this.lastAudioAppendAt;
              this.emit('latency', latencyMs);
              this.waitingForDelta = false;
            }
            this.emit('output_delta', delta);
          }
          break;
        }

        // Korean source transcript
        case 'session.input_transcript.delta': {
          const delta = (event.delta as string) ?? '';
          if (delta) this.emit('input_delta', delta);
          break;
        }

        case 'error':
          console.error(`[translate:${this.language}] error:`, JSON.stringify(event.error ?? event));
          this.emit('error', JSON.stringify(event.error ?? event));
          break;

        default:
          // Log unknown events during development
          if (!event.type.startsWith('session.output_audio')) {
            console.log(`[translate:${this.language}] event: ${event.type}`);
          }
          break;
      }
    });

    this.ws.on('close', () => {
      console.log(`[translate:${this.language}] disconnected`);
      this.sessionReady = false;
      this.emit('disconnected');
      this.ws = null;
    });

    this.ws.on('error', (err) => {
      console.error(`[translate:${this.language}] ws error:`, err.message);
      this.emit('error', err.message);
    });
  }

  /** Append base64 PCM16 audio. No commit needed. */
  appendAudio(base64Audio: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.sessionReady) return;

    this.lastAudioAppendAt = Date.now();
    if (!this.waitingForDelta) {
      this.waitingForDelta = true;
    }

    this.send({
      type: 'session.input_audio_buffer.append',
      audio: base64Audio,
    });
  }

  disconnect(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'session.close' });
      }
      this.ws.close();
      this.ws = null;
    }
    this.sessionReady = false;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.sessionReady;
  }

  private send(msg: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(msg));
  }
}
