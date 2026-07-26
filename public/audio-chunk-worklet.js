/**
 * AudioWorklet processor that accumulates PCM samples, downsamples
 * 48 kHz → 24 kHz (2:1 decimation), and emits fixed-size PCM16 chunks.
 *
 * Output format: PCM16 mono 24 kHz — matches OpenAI Realtime API input spec.
 *
 * Messages IN:  { type: 'set-chunk-ms', chunkMs: number }
 * Messages OUT: { type: 'chunk', chunkIndex: number, pcm16: ArrayBuffer, sampleRate: number, rms: number }
 */
const OUTPUT_SAMPLE_RATE = 24000;

class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputSampleRate = sampleRate; // global provided by AudioWorkletGlobalScope
    this._chunkMs = 100;
    this._samplesPerChunk = Math.floor((OUTPUT_SAMPLE_RATE * this._chunkMs) / 1000);
    this._buffer = new Float32Array(this._samplesPerChunk);
    this._bufferOffset = 0;
    this._chunkIndex = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'set-chunk-ms') {
        this._chunkMs = e.data.chunkMs;
        this._samplesPerChunk = Math.floor((OUTPUT_SAMPLE_RATE * this._chunkMs) / 1000);
        this._buffer = new Float32Array(this._samplesPerChunk);
        this._bufferOffset = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // mono — first channel only
    if (!channelData) return true;

    // Downsample 48kHz → 24kHz by averaging pairs of samples
    for (let i = 0; i + 1 < channelData.length; i += 2) {
      this._buffer[this._bufferOffset++] = (channelData[i] + channelData[i + 1]) / 2;

      if (this._bufferOffset >= this._samplesPerChunk) {
        // Calculate RMS from float32 buffer
        let sumSq = 0;
        for (let j = 0; j < this._samplesPerChunk; j++) {
          sumSq += this._buffer[j] * this._buffer[j];
        }
        const rms = Math.sqrt(sumSq / this._samplesPerChunk);

        // Convert float32 [-1, 1] to int16 PCM
        const pcm16 = new Int16Array(this._samplesPerChunk);
        for (let j = 0; j < this._samplesPerChunk; j++) {
          const s = Math.max(-1, Math.min(1, this._buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this._chunkIndex++;
        this.port.postMessage(
          {
            type: 'chunk',
            chunkIndex: this._chunkIndex,
            pcm16: pcm16.buffer,
            sampleRate: OUTPUT_SAMPLE_RATE,
            rms,
          },
          [pcm16.buffer]
        );

        this._buffer = new Float32Array(this._samplesPerChunk);
        this._bufferOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
