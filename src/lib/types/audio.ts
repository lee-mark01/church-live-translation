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
  | ViewerCountUpdate;

/** Union of all server → viewer browser messages */
export type ViewerMessage = SubtitleDelta | SubtitleHistory;
