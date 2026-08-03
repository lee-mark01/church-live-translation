import type { OutputLanguage } from '../../lib/languages';

/**
 * Per-language TTS voice + style configuration.
 * gpt-4o-mini-tts supports the `instructions` parameter for tone control.
 */
export interface TtsVoiceConfig {
  voice: string;
  instructions: string;
}

export const TTS_VOICE_CONFIG: Record<string, TtsVoiceConfig> = {
  en: {
    voice: 'cedar',
    instructions:
      'Speak clearly and warmly as a professional simultaneous interpreter delivering ' +
      'a continuous translation of a church sermon. Each segment is part of a longer flowing ' +
      'speech — maintain natural rhythm without excessive pauses. Do not use sentence-final ' +
      'falling intonation unless the text ends with a period, exclamation mark, or question mark.',
  },
  zh: {
    voice: 'cedar',
    instructions:
      '作为专业的同声传译员，清晰温暖地朗读教会讲道的连续翻译。每个片段是较长连续讲话的一部分，' +
      '保持自然的节奏，不要过度停顿。除非文本以句号、感叹号或问号结尾，否则不要使用句末降调。',
  },
};

const DEFAULT_VOICE_CONFIG: TtsVoiceConfig = {
  voice: 'cedar',
  instructions:
    'Speak clearly and warmly as a professional simultaneous interpreter. ' +
    'Each segment is part of a continuous speech — maintain natural flowing rhythm.',
};

/**
 * Stream TTS audio from gpt-4o-mini-tts for a given sentence.
 * Calls the callback with raw PCM16 chunks as they arrive.
 * Returns when the stream is fully consumed.
 */
export async function streamTts(
  apiKey: string,
  text: string,
  language: OutputLanguage,
  onChunk: (pcm16Buffer: Buffer) => void,
): Promise<void> {
  const config = TTS_VOICE_CONFIG[language] ?? DEFAULT_VOICE_CONFIG;

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
      voice: config.voice,
      instructions: config.instructions,
      response_format: 'pcm', // 24kHz 16-bit signed LE mono
      speed: 1.15,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS API error: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('TTS response has no body');

  // Buffer small chunks into ~100ms segments (24kHz * 2 bytes * 0.1s = 4800 bytes)
  const MIN_CHUNK_SIZE = 4800;
  let pending = Buffer.alloc(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      pending = Buffer.concat([pending, Buffer.from(value)]);
      while (pending.length >= MIN_CHUNK_SIZE) {
        // Ensure even byte count for PCM16
        const sendSize = MIN_CHUNK_SIZE & ~1;
        onChunk(pending.subarray(0, sendSize));
        pending = pending.subarray(sendSize);
      }
    }
  }
  // Flush remaining (ensure even)
  if (pending.length >= 2) {
    const len = pending.length & ~1;
    onChunk(pending.subarray(0, len));
  }
}
