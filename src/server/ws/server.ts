import { WebSocketServer, WebSocket } from 'ws';
import { RealtimeClient } from '../openai/realtimeClient';
import { translateTranscript } from '../openai/translator';
import type {
  AudioChunkMessage,
  AudioChunkAck,
  AudioStopAck,
  SttTranscriptDelta,
  SttTranscriptFinal,
  SttConnectionStatus,
  TranslationCompleted,
  TranslationError,
  ViewerJoin,
  ViewerChangeLanguage,
  ViewerLanguage,
  ViewerCountUpdate,
  SubtitleFinal,
} from '../../lib/types/audio';

const PORT = Number(process.env.WS_PORT) || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const wss = new WebSocketServer({ port: PORT });
console.log(`[ws] WebSocket server listening on ws://localhost:${PORT}`);

if (!OPENAI_API_KEY) {
  console.warn('[ws] OPENAI_API_KEY not set — STT will be disabled');
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

function broadcastToViewers(sessionCode: string, result: TranslationCompleted): void {
  const clients = viewers.get(sessionCode);
  if (!clients || clients.length === 0) return;

  const createdAt = Date.now();
  const languageMap: Record<ViewerLanguage, string> = {
    en: result.en,
    zhHans: result.zhHans,
    zhHant: result.zhHant,
  };

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;

    const subtitle: SubtitleFinal = {
      type: 'subtitle.final',
      sourceText: result.sourceText,
      language: client.language,
      text: languageMap[client.language],
      createdAt,
    };
    client.ws.send(JSON.stringify(subtitle));
  }

  console.log(`[ws] broadcast to ${clients.length} viewer(s) in session=${sessionCode}`);
}

// --- Admin tracking ---
const adminClients = new Map<string, WebSocket>();

function getViewerCount(sessionCode: string): { total: number; byLanguage: Record<ViewerLanguage, number> } {
  const clients = viewers.get(sessionCode) ?? [];
  const byLanguage: Record<ViewerLanguage, number> = { en: 0, zhHans: 0, zhHant: 0 };
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

  // Track whether this client has identified as admin or viewer
  let role: 'unknown' | 'admin' | 'viewer' = 'unknown';
  let adminSessionCode: string | null = null;

  // Admin state
  let expectedSeq = 1;
  let totalChunks = 0;
  let droppedChunks = 0;
  let openai: RealtimeClient | null = null;
  const pendingTranslations: Set<Promise<void>> = new Set();

  ws.on('message', (raw: Buffer) => {
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
      return;
    }

    // --- Viewer language change ---
    if (msg.type === 'viewer.changeLanguage') {
      const change = msg as unknown as ViewerChangeLanguage;
      // Find and update this viewer's language
      for (const [sessionCode, clients] of viewers) {
        const client = clients.find((c) => c.ws === ws);
        if (client) {
          client.language = change.language;
          console.log(`[ws] viewer changed language to ${change.language}`);
          notifyAdminViewerCount(sessionCode);
          break;
        }
      }
      return;
    }

    // --- Admin safe stop ---
    if (msg.type === 'audio.stop') {
      console.log('[ws] admin requested safe stop');
      void (async () => {
        // 1. Flush remaining audio and wait for transcript
        if (openai) {
          await openai.flushAndClose();
        }

        // 2. Wait for all pending translations (max 3s)
        if (pendingTranslations.size > 0) {
          console.log(`[ws] waiting for ${pendingTranslations.size} pending translation(s)`);
          await Promise.race([
            Promise.allSettled([...pendingTranslations]),
            new Promise((r) => setTimeout(r, 3000)),
          ]);
        }

        sendToAdmin<AudioStopAck>({ type: 'audio.stop.ack' });
        console.log('[ws] safe stop complete, sent ack');
      })();
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
      console.log(`[ws] admin identified for session=${adminSessionCode}`);

      // Send current viewer count immediately
      notifyAdminViewerCount(adminSessionCode);

      // Start OpenAI connection for this admin
      if (OPENAI_API_KEY) {
        openai = new RealtimeClient(OPENAI_API_KEY);

        openai.on('connected', () => {
          sendToAdmin<SttConnectionStatus>({ type: 'stt.connection', status: 'connected' });
        });

        openai.on('disconnected', () => {
          sendToAdmin<SttConnectionStatus>({ type: 'stt.connection', status: 'disconnected' });
        });

        openai.on('error', (message) => {
          sendToAdmin<SttConnectionStatus>({ type: 'stt.connection', status: 'error', message });
        });

        openai.on('transcript_delta', (text) => {
          sendToAdmin<SttTranscriptDelta>({ type: 'stt.transcript.delta', text });
        });

        openai.on('transcript_final', (text) => {
          sendToAdmin<SttTranscriptFinal>({ type: 'stt.transcript.final', text });

          // Translate async — don't block STT pipeline
          const translationPromise = translateTranscript(text)
            .then((result) => {
              console.log(`[translation] done: "${text}" → en="${result.en}"`);

              const translationMsg: TranslationCompleted = {
                type: 'translation.completed',
                sourceText: result.sourceText,
                en: result.en,
                zhHans: result.zhHans,
                zhHant: result.zhHant,
              };

              // Send to admin
              sendToAdmin<TranslationCompleted>(translationMsg);

              // Broadcast to viewers
              if (adminSessionCode) {
                broadcastToViewers(adminSessionCode, translationMsg);
              }
            })
            .catch((err) => {
              console.error('[translation] error:', err);
              sendToAdmin<TranslationError>({
                type: 'translation.error',
                sourceText: text,
                message: err instanceof Error ? err.message : String(err),
              });
            })
            .finally(() => {
              pendingTranslations.delete(translationPromise);
            });
          pendingTranslations.add(translationPromise);
        });

        openai.connect();
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

    // Send ack with running stats
    sendToAdmin<AudioChunkAck>({
      type: 'audio.chunk.ack',
      seq: audioMsg.seq,
      receivedAt,
      clientToServerMs,
      totalChunks,
      droppedChunks,
    });

    // Forward audio to OpenAI (with RMS for silence detection)
    if (openai?.isConnected) {
      openai.appendAudio(audioMsg.audio, audioMsg.rms);
    }
  });

  ws.on('close', () => {
    if (role === 'admin') {
      console.log(`[ws] admin disconnected (total=${totalChunks}, dropped=${droppedChunks})`);
      if (adminSessionCode && adminClients.get(adminSessionCode) === ws) {
        adminClients.delete(adminSessionCode);
      }
      openai?.disconnect();
    } else if (role === 'viewer') {
      removeViewer(ws);
    } else {
      console.log('[ws] unknown client disconnected');
    }
  });

  function sendToAdmin<T>(msg: T): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
});
