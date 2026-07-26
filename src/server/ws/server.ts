import { WebSocketServer, WebSocket } from 'ws';
import { TranslateClient } from '../openai/translateClient';
import { retranslateKorean } from '../openai/retranslate';
import { SessionLogger } from '../session/sessionLogger';
import type {
  AudioChunkMessage,
  AudioChunkAck,
  AudioStopAck,
  TranscriptDelta,
  TranslationDelta,
  TranslateConnectionStatus,
  TranslateLatency,
  ViewerJoin,
  ViewerChangeLanguage,
  ViewerLanguage,
  ViewerCountUpdate,
  OutputLanguage,
  SubtitleDelta,
  SubtitleHistory,
  SubtitleCorrection,
  AdminSentence,
  SentenceComplete,
  CorrectionRequest,
  CorrectionResult,
  ViewerSentence,
} from '../../lib/types/audio';
import { LANGUAGE_CODES } from '../../lib/languages';

const PORT = Number(process.env.WS_PORT) || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const wss = new WebSocketServer({ port: PORT });
console.log(`[ws] WebSocket server listening on ws://localhost:${PORT}`);

if (!OPENAI_API_KEY) {
  console.warn('[ws] OPENAI_API_KEY not set — translation will be disabled');
}

// Sentence boundary detection
const SENTENCE_END_RE = /[.!?。？！]\s*/;

function splitIntoSentences(text: string): string[] {
  const results: string[] = [];
  let remaining = text;
  while (remaining) {
    const match = remaining.match(SENTENCE_END_RE);
    if (match && match.index !== undefined) {
      const end = match.index + match[0].length;
      results.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    } else {
      results.push(remaining);
      break;
    }
  }
  return results.filter((s) => s.trim());
}

function isSentenceComplete(text: string): boolean {
  return /[.!?。？！]\s*$/.test(text);
}

// --- Viewer management ---
interface ViewerClient {
  ws: WebSocket;
  language: ViewerLanguage;
}

// sessionCode → list of viewer clients
const viewers = new Map<string, ViewerClient[]>();

function addViewer(sessionCode: string, client: ViewerClient): void {
  if (!viewers.has(sessionCode)) {
    viewers.set(sessionCode, []);
  }
  viewers.get(sessionCode)!.push(client);
  console.log(`[ws] viewer joined session=${sessionCode} lang=${client.language} (total=${viewers.get(sessionCode)!.length})`);
  notifyAdminViewerCount(sessionCode);
}

function removeViewer(ws: WebSocket): void {
  for (const [sessionCode, clients] of viewers) {
    const idx = clients.findIndex((c) => c.ws === ws);
    if (idx !== -1) {
      clients.splice(idx, 1);
      console.log(`[ws] viewer left session=${sessionCode} (remaining=${clients.length})`);
      if (clients.length === 0) {
        viewers.delete(sessionCode);
      }
      notifyAdminViewerCount(sessionCode);
      return;
    }
  }
}

function broadcastToViewers(sessionCode: string, language: ViewerLanguage, msg: object): void {
  const clients = viewers.get(sessionCode);
  if (!clients || clients.length === 0) return;

  const payload = JSON.stringify(msg);

  for (const client of clients) {
    if (client.language !== language) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(payload);
  }
}

function broadcastToAllViewers(sessionCode: string, msg: object): void {
  const clients = viewers.get(sessionCode);
  if (!clients || clients.length === 0) return;

  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(payload);
  }
}

// --- Sentence storage per session ---
interface SessionSentences {
  sentences: AdminSentence[];
  koreanBuffer: string;       // accumulates input_delta until sentence boundary
  translationBuffers: Record<OutputLanguage, string>;  // per-language accumulator
  translationSentenceIdx: Record<OutputLanguage, number>; // which sentence index each lang is filling
  sentenceCounter: number;
  // Full accumulated text per language (for history on language switch)
  fullTexts: Record<OutputLanguage, string>;
}

const sessionData = new Map<string, SessionSentences>();

function getOrCreateSessionData(sessionCode: string): SessionSentences {
  if (!sessionData.has(sessionCode)) {
    sessionData.set(sessionCode, {
      sentences: [],
      koreanBuffer: '',
      translationBuffers: Object.fromEntries(LANGUAGE_CODES.map((c) => [c, ''])) as Record<OutputLanguage, string>,
      translationSentenceIdx: Object.fromEntries(LANGUAGE_CODES.map((c) => [c, 0])) as Record<OutputLanguage, number>,
      sentenceCounter: 0,
      fullTexts: Object.fromEntries(LANGUAGE_CODES.map((c) => [c, ''])) as Record<OutputLanguage, string>,
    });
  }
  return sessionData.get(sessionCode)!;
}

function getViewerHistory(sessionCode: string, language: ViewerLanguage): { sentences: ViewerSentence[]; streamingText: string } {
  const data = sessionData.get(sessionCode);
  if (!data) return { sentences: [], streamingText: '' };

  const sentences = data.sentences
    .filter((s) => s.translations[language])
    .map((s) => ({
      id: s.id,
      text: s.translations[language]!,
      corrected: s.corrected,
    }));

  // Calculate streaming text: full accumulated text minus what's already in sentences
  const sentenceText = sentences.map((s) => s.text).join('');
  const fullText = data.fullTexts[language] || '';
  const streamingText = fullText.startsWith(sentenceText)
    ? fullText.slice(sentenceText.length)
    : data.translationBuffers[language] || '';

  return { sentences, streamingText };
}

// --- Admin tracking ---
const adminClients = new Map<string, WebSocket>();

function getViewerCount(sessionCode: string): { total: number; byLanguage: Record<ViewerLanguage, number> } {
  const clients = viewers.get(sessionCode) ?? [];
  const byLanguage = Object.fromEntries(LANGUAGE_CODES.map((c) => [c, 0])) as Record<ViewerLanguage, number>;
  for (const c of clients) {
    byLanguage[c.language]++;
  }
  return { total: clients.length, byLanguage };
}

function notifyAdminViewerCount(sessionCode: string): void {
  const adminWs = adminClients.get(sessionCode);
  if (!adminWs || adminWs.readyState !== WebSocket.OPEN) return;
  const count = getViewerCount(sessionCode);
  const msg: ViewerCountUpdate = {
    type: 'viewer.count',
    sessionCode,
    total: count.total,
    byLanguage: count.byLanguage,
  };
  adminWs.send(JSON.stringify(msg));
}

// --- Connection handling ---
wss.on('connection', (ws: WebSocket) => {
  console.log('[ws] client connected');

  let role: 'unknown' | 'admin' | 'viewer' = 'unknown';
  let adminSessionCode: string | null = null;

  // Admin state
  let expectedSeq = 1;
  let totalChunks = 0;
  let droppedChunks = 0;
  let logger: SessionLogger | null = null;

  // Translation sessions (one per output language)
  const translateSessions = new Map<OutputLanguage, TranslateClient>();

  ws.on('message', async (raw: Buffer) => {
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error('[ws] invalid JSON received');
      return;
    }

    // --- Viewer join ---
    if (msg.type === 'viewer.join') {
      const join = msg as unknown as ViewerJoin;
      role = 'viewer';
      addViewer(join.sessionCode, { ws, language: join.language });

      // Send sentence-based history + streaming text
      const history = getViewerHistory(join.sessionCode, join.language);
      const historyMsg: SubtitleHistory = { type: 'subtitle.history', ...history };
      ws.send(JSON.stringify(historyMsg));
      return;
    }

    // --- Viewer language change ---
    if (msg.type === 'viewer.changeLanguage') {
      const change = msg as unknown as ViewerChangeLanguage;
      for (const [sessionCode, clients] of viewers) {
        const client = clients.find((c) => c.ws === ws);
        if (client) {
          client.language = change.language;
          console.log(`[ws] viewer changed language to ${change.language}`);
          notifyAdminViewerCount(sessionCode);

          // Send sentence-based history + streaming text for the new language
          const history = getViewerHistory(sessionCode, change.language);
          const historyMsg: SubtitleHistory = { type: 'subtitle.history', ...history };
          ws.send(JSON.stringify(historyMsg));
          break;
        }
      }
      return;
    }

    // --- Admin correction request ---
    if (msg.type === 'correction.request') {
      const req = msg as unknown as CorrectionRequest;
      if (!adminSessionCode || !OPENAI_API_KEY) return;

      const data = sessionData.get(adminSessionCode);
      if (!data) return;

      const sentence = data.sentences.find((s) => s.id === req.sentenceId);
      if (!sentence) {
        console.warn(`[ws] correction: sentence ${req.sentenceId} not found`);
        return;
      }

      console.log(`[ws] correction requested: ${req.sentenceId} "${sentence.korean}" → "${req.correctedKorean}"`);

      try {
        // Re-translate via Chat Completions API
        const translations = await retranslateKorean(OPENAI_API_KEY, req.correctedKorean, LANGUAGE_CODES);

        // Update stored sentence
        sentence.korean = req.correctedKorean;
        sentence.translations = translations;
        sentence.corrected = true;

        // Send result to admin
        sendToAdmin<CorrectionResult>({
          type: 'correction.result',
          sentenceId: req.sentenceId,
          korean: req.correctedKorean,
          translations,
        });

        // Broadcast correction to viewers (per language)
        for (const lang of LANGUAGE_CODES) {
          if (translations[lang]) {
            broadcastToViewers(adminSessionCode, lang, {
              type: 'subtitle.correction',
              sentenceId: req.sentenceId,
              text: translations[lang],
            } satisfies SubtitleCorrection);
          }
        }

        console.log(`[ws] correction applied: ${req.sentenceId}`);
      } catch (err) {
        console.error('[ws] correction failed:', err);
      }
      return;
    }

    // --- Admin safe stop ---
    if (msg.type === 'audio.stop') {
      console.log('[ws] admin requested safe stop');

      // Disconnect all translation sessions
      for (const [lang, client] of translateSessions) {
        console.log(`[ws] closing translate session: ${lang}`);
        client.disconnect();
      }
      translateSessions.clear();

      // Save session log
      logger?.save();

      sendToAdmin<AudioStopAck>({ type: 'audio.stop.ack' });
      console.log('[ws] safe stop complete, sent ack');
      return;
    }

    // --- Admin audio chunk ---
    if (msg.type !== 'audio.chunk') return;

    const audioMsg = msg as unknown as AudioChunkMessage;

    // First audio chunk identifies this as admin
    if (role === 'unknown') {
      role = 'admin';
      adminSessionCode = audioMsg.sessionCode;
      adminClients.set(adminSessionCode, ws);
      logger = new SessionLogger(adminSessionCode);
      getOrCreateSessionData(adminSessionCode);
      console.log(`[ws] admin identified for session=${adminSessionCode}`);

      notifyAdminViewerCount(adminSessionCode);

      // Start translation sessions for all configured languages
      if (OPENAI_API_KEY) {
        for (const lang of LANGUAGE_CODES) {
          startTranslateSession(lang);
        }
      }
    }

    const receivedAt = Date.now();
    const clientToServerMs = receivedAt - audioMsg.capturedAt;

    // Sequence check
    if (audioMsg.seq !== expectedSeq) {
      const dropped = audioMsg.seq - expectedSeq;
      if (dropped > 0) {
        droppedChunks += dropped;
        console.warn(`[ws] dropped ${dropped} chunk(s): expected seq ${expectedSeq}, got ${audioMsg.seq}`);
      }
    }
    expectedSeq = audioMsg.seq + 1;
    totalChunks++;

    // Per-chunk log (every 10th to reduce noise)
    if (audioMsg.seq % 10 === 1 || audioMsg.seq <= 3) {
      console.log(
        `[ws] chunk seq=${audioMsg.seq} size=${audioMsg.sizeBytes} ` +
        `clientToServerMs=${clientToServerMs}ms`
      );
    }

    // Send ack
    sendToAdmin<AudioChunkAck>({
      type: 'audio.chunk.ack',
      seq: audioMsg.seq,
      receivedAt,
      clientToServerMs,
      totalChunks,
      droppedChunks,
    });

    // Forward audio to all translate sessions
    for (const client of translateSessions.values()) {
      client.appendAudio(audioMsg.audio);
    }
  });

  ws.on('close', () => {
    if (role === 'admin') {
      console.log(`[ws] admin disconnected (total=${totalChunks}, dropped=${droppedChunks})`);
      if (adminSessionCode && adminClients.get(adminSessionCode) === ws) {
        adminClients.delete(adminSessionCode);
      }
      for (const client of translateSessions.values()) {
        client.disconnect();
      }
      translateSessions.clear();
      logger?.save();
    } else if (role === 'viewer') {
      removeViewer(ws);
    } else {
      console.log('[ws] unknown client disconnected');
    }
  });

  function startTranslateSession(language: OutputLanguage): void {
    const client = new TranslateClient(OPENAI_API_KEY!, language);

    client.on('connected', () => {
      sendToAdmin<TranslateConnectionStatus>({
        type: 'translate.connection',
        status: 'connected',
        language,
      });
    });

    client.on('disconnected', () => {
      sendToAdmin<TranslateConnectionStatus>({
        type: 'translate.connection',
        status: 'disconnected',
        language,
      });
    });

    client.on('error', (message) => {
      sendToAdmin<TranslateConnectionStatus>({
        type: 'translate.connection',
        status: 'error',
        language,
        message,
      });
    });

    // Latency measurement
    client.on('latency', (ms) => {
      console.log(`[translate:${language}] latency: ${ms}ms`);
      sendToAdmin<TranslateLatency>({ type: 'translate.latency', language, ms });
    });

    // Korean source transcript (only need from one session, use the first language)
    if (language === LANGUAGE_CODES[0]) {
      client.on('input_delta', (text) => {
        sendToAdmin<TranscriptDelta>({ type: 'transcript.delta', text });
        logger?.appendInput(text);

        // Sentence segmentation for Korean
        if (adminSessionCode) {
          const data = getOrCreateSessionData(adminSessionCode);
          data.koreanBuffer += text;

          // Check if we have completed sentences
          while (isSentenceComplete(data.koreanBuffer)) {
            const parts = splitIntoSentences(data.koreanBuffer);
            if (parts.length <= 1 && isSentenceComplete(data.koreanBuffer)) {
              // Entire buffer is one completed sentence
              const sentenceText = data.koreanBuffer.trim();
              data.koreanBuffer = '';
              const id = `s-${++data.sentenceCounter}`;
              const sentence: AdminSentence = {
                id,
                korean: sentenceText,
                translations: {},
              };
              data.sentences.push(sentence);
              sendToAdmin<SentenceComplete>({ type: 'sentence.complete', sentence });
              console.log(`[ws] korean sentence finalized: ${id} "${sentenceText}"`);
              break;
            } else if (parts.length > 1) {
              // First part(s) are complete, last may be partial
              for (let i = 0; i < parts.length - 1; i++) {
                const sentenceText = parts[i].trim();
                if (!sentenceText) continue;
                const id = `s-${++data.sentenceCounter}`;
                const sentence: AdminSentence = {
                  id,
                  korean: sentenceText,
                  translations: {},
                };
                data.sentences.push(sentence);
                sendToAdmin<SentenceComplete>({ type: 'sentence.complete', sentence });
                console.log(`[ws] korean sentence finalized: ${id} "${sentenceText}"`);
              }
              const lastPart = parts[parts.length - 1];
              if (isSentenceComplete(lastPart)) {
                const sentenceText = lastPart.trim();
                const id = `s-${++data.sentenceCounter}`;
                const sentence: AdminSentence = {
                  id,
                  korean: sentenceText,
                  translations: {},
                };
                data.sentences.push(sentence);
                sendToAdmin<SentenceComplete>({ type: 'sentence.complete', sentence });
                console.log(`[ws] korean sentence finalized: ${id} "${sentenceText}"`);
                data.koreanBuffer = '';
              } else {
                data.koreanBuffer = lastPart;
              }
              break;
            } else {
              break;
            }
          }
        }
      });
    }

    // Translated text → admin + viewers
    client.on('output_delta', (text) => {
      // Send to admin
      sendToAdmin<TranslationDelta>({
        type: 'translation.delta',
        language,
        text,
      });

      // Accumulate for session log
      logger?.appendOutput(language, text);

      if (adminSessionCode) {
        // Accumulate full text
        const data = getOrCreateSessionData(adminSessionCode);
        data.fullTexts[language] += text;

        // Send delta to viewers
        broadcastToViewers(adminSessionCode, language, {
          type: 'subtitle.delta',
          text,
        } satisfies SubtitleDelta);

        // Sentence segmentation for translations
        data.translationBuffers[language] += text;

        // Check for completed translation sentences
        while (isSentenceComplete(data.translationBuffers[language])) {
          const parts = splitIntoSentences(data.translationBuffers[language]);
          const completeParts = isSentenceComplete(data.translationBuffers[language])
            ? parts
            : parts.slice(0, -1);
          const remaining = isSentenceComplete(data.translationBuffers[language])
            ? ''
            : parts[parts.length - 1] || '';

          for (const part of completeParts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const idx = data.translationSentenceIdx[language];
            if (idx < data.sentences.length) {
              data.sentences[idx].translations[language] = trimmed;
              console.log(`[ws] translation [${language}] filled for ${data.sentences[idx].id}: "${trimmed}"`);
              // Notify admin of updated sentence
              sendToAdmin<SentenceComplete>({ type: 'sentence.complete', sentence: data.sentences[idx] });
            }
            data.translationSentenceIdx[language]++;
          }
          data.translationBuffers[language] = remaining;
          if (!remaining) break;
        }
      }
    });

    client.connect();
    translateSessions.set(language, client);
  }

  function sendToAdmin<T>(msg: T): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
});
