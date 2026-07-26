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

/** Server → Browser: partial transcript delta */
export interface SttTranscriptDelta {
  type: 'stt.transcript.delta';
  text: string;
}

/** Server → Browser: final Korean transcript (after commit) */
export interface SttTranscriptFinal {
  type: 'stt.transcript.final';
  text: string;
}

/** Server → Browser: OpenAI connection status */
export interface SttConnectionStatus {
  type: 'stt.connection';
  status: 'connected' | 'disconnected' | 'error';
  message?: string;
}

/** Supported viewer languages */
export type ViewerLanguage = 'en' | 'zhHans' | 'zhHant';

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

/** Server → Browser (viewer): final subtitle in selected language */
export interface SubtitleFinal {
  type: 'subtitle.final';
  sourceText: string;
  language: ViewerLanguage;
  text: string;
  createdAt: number;
}

/** Server → Browser: translation completed */
export interface TranslationCompleted {
  type: 'translation.completed';
  sourceText: string;
  en: string;
  zhHans: string;
  zhHant: string;
}

/** Server → Browser: translation failed */
export interface TranslationError {
  type: 'translation.error';
  sourceText: string;
  message: string;
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
  | SttTranscriptDelta
  | SttTranscriptFinal
  | SttConnectionStatus
  | TranslationCompleted
  | TranslationError
  | ViewerCountUpdate;

/** Union of all server → viewer browser messages */
export type ViewerMessage = SubtitleFinal;
