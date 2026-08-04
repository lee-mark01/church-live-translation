/**
 * Write a WAV file header for PCM16 mono audio.
 */
export function createWavBuffer(pcm16Chunks: Buffer[], sampleRate: number): Buffer {
  const dataSize = pcm16Chunks.reduce((sum, b) => sum + b.length, 0);
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4); // file size - 8
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);      // chunk size
  header.writeUInt16LE(1, 20);       // PCM format
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * channels * bitsPerSample/8)
  header.writeUInt16LE(2, 32);       // block align (channels * bitsPerSample/8)
  header.writeUInt16LE(16, 34);      // bits per sample

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, ...pcm16Chunks]);
}
