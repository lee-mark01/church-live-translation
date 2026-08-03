/**
 * Browser-side TTS audio player.
 * Receives PCM16 24kHz chunks via WebSocket and plays them
 * using AudioBufferSourceNode scheduling for gapless playback.
 */

const TTS_SAMPLE_RATE = 24000;
const INTER_SENTENCE_PAUSE = 0.25; // 250ms silence between sentences

interface QueuedSentence {
  id: string;
  chunks: Int16Array[];
  complete: boolean;
  scheduledChunks: number;
  scheduledEndTime: number;
  started: boolean;
}

export type SentenceCallback = (sentenceId: string) => void;

export class TtsPlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private queue: QueuedSentence[] = [];
  private currentIdx = -1;
  private nextStartTime = 0;
  private rafId: number | null = null;

  onSentenceStart: SentenceCallback = () => {};
  onSentenceEnd: SentenceCallback = () => {};

  get initialized(): boolean {
    return this.ctx !== null;
  }

  get playing(): boolean {
    if (!this.ctx) return false;
    return this.ctx.currentTime < this.nextStartTime;
  }

  /** Must be called from a user gesture (click/tap). */
  async init(): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    document.addEventListener('visibilitychange', this.handleVisibility);
    this.ctx.addEventListener('statechange', this.handleStateChange);
    this.startPolling();
  }

  /** Start receiving chunks for a new sentence. */
  enqueueSentence(sentenceId: string): void {
    this.queue.push({
      id: sentenceId,
      chunks: [],
      complete: false,
      scheduledChunks: 0,
      scheduledEndTime: 0,
      started: false,
    });
    // Start playing if nothing is active
    if (this.currentIdx === -1) {
      this.currentIdx = 0;
    }
  }

  /** Feed a base64-encoded PCM16 chunk for the latest enqueued sentence. */
  feedChunk(sentenceId: string, audioBase64: string): void {
    // Find the matching sentence (usually the last one)
    const sentence = this.findSentence(sentenceId);
    if (!sentence) return;

    try {
      const pcm16 = decodePCM16(audioBase64);
      if (pcm16.length === 0) return;
      sentence.chunks.push(pcm16);
      this.trySchedule();
    } catch {
      // Skip malformed chunks silently
    }
  }

  /** Mark the sentence as fully received. */
  endSentence(sentenceId: string): void {
    const sentence = this.findSentence(sentenceId);
    if (sentence) {
      sentence.complete = true;
    }
    this.trySchedule();
  }

  setVolume(v: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  getVolume(): number {
    return this.gainNode?.gain.value ?? 1;
  }

  stop(): void {
    this.queue = [];
    this.currentIdx = -1;
    // Jump nextStartTime to now so any already-scheduled nodes finish naturally
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    }
  }

  destroy(): void {
    this.stop();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.ctx?.close();
    this.ctx = null;
    this.gainNode = null;
  }

  // --- Internal ---

  private findSentence(sentenceId: string): QueuedSentence | undefined {
    // Search from the end since new sentences are appended
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].id === sentenceId) return this.queue[i];
    }
    return undefined;
  }

  private trySchedule(): void {
    if (!this.ctx || !this.gainNode || this.currentIdx < 0) return;

    const sentence = this.queue[this.currentIdx];
    if (!sentence) return;

    // Schedule any new chunks
    while (sentence.scheduledChunks < sentence.chunks.length) {
      const pcm16 = sentence.chunks[sentence.scheduledChunks];
      const float32 = pcm16ToFloat32(pcm16);

      const buffer = this.ctx.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gainNode);

      const startAt = Math.max(this.nextStartTime, this.ctx.currentTime);
      source.start(startAt);
      this.nextStartTime = startAt + buffer.duration;
      sentence.scheduledEndTime = this.nextStartTime;
      sentence.scheduledChunks++;

      if (!sentence.started) {
        sentence.started = true;
        this.onSentenceStart(sentence.id);
      }
    }
  }

  private startPolling(): void {
    const poll = () => {
      this.rafId = requestAnimationFrame(poll);
      if (!this.ctx || this.currentIdx < 0) return;

      const sentence = this.queue[this.currentIdx];
      if (!sentence) return;

      // Check if current sentence finished playing
      if (
        sentence.complete &&
        sentence.scheduledChunks === sentence.chunks.length &&
        this.ctx.currentTime >= sentence.scheduledEndTime
      ) {
        this.onSentenceEnd(sentence.id);
        this.currentIdx++;

        // Add inter-sentence pause
        this.nextStartTime = Math.max(this.nextStartTime, this.ctx.currentTime) + INTER_SENTENCE_PAUSE;

        // Try to schedule next sentence
        if (this.currentIdx < this.queue.length) {
          this.trySchedule();
        }
      }
    };
    this.rafId = requestAnimationFrame(poll);
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.ctx?.state !== 'running') {
      this.ctx?.resume();
    }
  };

  private handleStateChange = (): void => {
    if (this.ctx && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
  };
}

// --- Helpers ---

function decodePCM16(base64: string): Int16Array {
  const binary = atob(base64);
  // Ensure even byte count (Int16Array requires multiples of 2)
  const len = binary.length & ~1;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768;
  }
  return float32;
}
