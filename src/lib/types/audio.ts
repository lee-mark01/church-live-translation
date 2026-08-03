/** Browser → Server: audio chunk message */
export interface AudioChunkMessage {
  type: 'audio.chunk';
  sessionCode: string;
  seq: number;
  capturedAt: number; // Date.now() when chunk was created
  chunkMs: number;
  format: 'pcm16';
  sampleRate: number;
  channels: 1;
  sizeBytes: number;
  rms: number; // RMS audio level (0.0 ~ 1.0)
  audio: string; // base64-encoded PCM16
}

/** Browser → Server: admin requests safe stop */
export interface AudioStop {
  type: 'audio.stop';
}

/** Server → Browser: safe stop completed, ok to close */
export interface AudioStopAck {
  type: 'audio.stop.ack';
}

/** Server → Browser: chunk acknowledgement (includes running stats) */
export interface AudioChunkAck {
  type: 'audio.chunk.ack';
  seq: number;
  receivedAt: number;
  clientToServerMs: number;
  totalChunks: number;
  droppedChunks: number;
}

/** Server → Browser (admin): streaming Korean source transcript delta */
export interface TranscriptDelta {
  type: 'transcript.delta';
  text: string;
}

/** Server → Browser (admin): streaming translated text delta */
export interface TranslationDelta {
  type: 'translation.delta';
  language: OutputLanguage;
  text: string;
}

/** Server → Browser (viewer): streaming subtitle delta */
export interface SubtitleDelta {
  type: 'subtitle.delta';
  text: string;
}

/** Server → Browser (viewer): full subtitle history on language change */
export interface SubtitleHistory {
  type: 'subtitle.history';
  sentences: ViewerSentence[];
  streamingText: string; // text not yet finalized into sentences
}

/** A sentence as seen by the viewer */
export interface ViewerSentence {
  id: string;
  text: string;
  corrected?: boolean;
}

/** Server → Browser (viewer): a translation sentence was finalized */
export interface SubtitleSentenceComplete {
  type: 'subtitle.sentence.complete';
  sentence: ViewerSentence;
  streamingText: string; // remaining text not yet in a sentence
}

/** Server → Browser (viewer): a sentence was corrected — replace it */
export interface SubtitleCorrection {
  type: 'subtitle.correction';
  sentenceId: string;
  text: string;
}

/** Server → Browser: translation session connection status */
export interface TranslateConnectionStatus {
  type: 'translate.connection';
  status: 'connected' | 'disconnected' | 'error';
  language: OutputLanguage;
  message?: string;
}

/** Server → Browser (admin): translation latency measurement */
export interface TranslateLatency {
  type: 'translate.latency';
  language: OutputLanguage;
  ms: number;
}

/** Server → Browser (admin): a sentence has been finalized with translations */
export interface SentenceComplete {
  type: 'sentence.complete';
  sentence: AdminSentence;
}

/** A finalized sentence with all translations */
export interface AdminSentence {
  id: string;
  korean: string;
  translations: Partial<Record<OutputLanguage, string>>;
  corrected?: boolean;
}

/** Browser → Server (admin): submit a correction */
export interface CorrectionRequest {
  type: 'correction.request';
  sentenceId: string;
  correctedKorean: string;
}

/** Server → Browser (admin): correction completed */
export interface CorrectionResult {
  type: 'correction.result';
  sentenceId: string;
  korean: string;
  translations: Record<OutputLanguage, string>;
}

// OutputLanguage is defined in and re-exported from '@/lib/languages'
export type { OutputLanguage } from '../languages';
import type { OutputLanguage } from '../languages';

/** Viewer language is the same as output language */
export type ViewerLanguage = OutputLanguage;

/** Browser → Server: viewer joins a session */
export interface ViewerJoin {
  type: 'viewer.join';
  sessionCode: string;
  language: ViewerLanguage;
}

/** Browser → Server: viewer changes language */
export interface ViewerChangeLanguage {
  type: 'viewer.changeLanguage';
  language: ViewerLanguage;
}

/** Server → Browser (admin): real-time viewer count */
export interface ViewerCountUpdate {
  type: 'viewer.count';
  sessionCode: string;
  total: number;
  byLanguage: Record<ViewerLanguage, number>;
}

/** Union of all server → admin browser messages */
export type ServerMessage =
  | AudioChunkAck
  | AudioStopAck
  | TranscriptDelta
  | TranslationDelta
  | TranslateConnectionStatus
  | TranslateLatency
  | ViewerCountUpdate
  | SentenceComplete
  | CorrectionResult;

/** Server → Browser (viewer): TTS audio sentence start */
export interface TtsSentenceStart {
  type: 'tts.sentence.start';
  sentenceId: string;
}

/** Server → Browser (viewer): TTS audio chunk */
export interface TtsChunk {
  type: 'tts.chunk';
  sentenceId: string;
  audio: string; // base64 PCM16 24kHz mono
}

/** Server → Browser (viewer): TTS audio sentence end */
export interface TtsSentenceEnd {
  type: 'tts.sentence.end';
  sentenceId: string;
}

/** Union of all server → viewer browser messages */
export type ViewerMessage =
  | SubtitleDelta
  | SubtitleHistory
  | SubtitleSentenceComplete
  | SubtitleCorrection
  | TtsSentenceStart
  | TtsChunk
  | TtsSentenceEnd;
