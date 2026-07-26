import { WebSocketServer, WebSocket } from 'ws';
import { TranslateClient } from '../openai/translateClient';
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
} from '../../lib/types/audio';

const PORT = Number(process.env.WS_PORT) || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const wss = new WebSocketServer({ port: PORT });
console.log(`[ws] WebSocket server listening on ws://localhost:${PORT}`);

if (!OPENAI_API_KEY) {
  console.warn('[ws] OPENAI_API_KEY not set — translation will be disabled');
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

function broadcastToViewers(sessionCode: string, language: ViewerLanguage, text: string): void {
  const clients = viewers.get(sessionCode);
  if (!clients || clients.length === 0) return;

  const msg: SubtitleDelta = { type: 'subtitle.delta', text };
  const payload = JSON.stringify(msg);

  for (const client of clients) {
    if (client.language !== language) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(payload);
  }
}

// --- Admin tracking ---
const adminClients = new Map<string, WebSocket>();

function getViewerCount(sessionCode: string): { total: number; byLanguage: Record<ViewerLanguage, number> } {
  const clients = viewers.get(sessionCode) ?? [];
  const byLanguage: Record<ViewerLanguage, number> = { en: 0, zh: 0 };
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

  // Translation sessions (one per output language)
  const translateSessions = new Map<OutputLanguage, TranslateClient>();

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

      // Disconnect all translation sessions
      for (const [lang, client] of translateSessions) {
        console.log(`[ws] closing translate session: ${lang}`);
        client.disconnect();
      }
      translateSessions.clear();

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
      console.log(`[ws] admin identified for session=${adminSessionCode}`);

      notifyAdminViewerCount(adminSessionCode);

      // Start translation sessions
      if (OPENAI_API_KEY) {
        startTranslateSession('en');
        startTranslateSession('zh');
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

    // Korean source transcript (only need from one session, use 'en')
    if (language === 'en') {
      client.on('input_delta', (text) => {
        sendToAdmin<TranscriptDelta>({ type: 'transcript.delta', text });
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

      // Broadcast to viewers of this language
      if (adminSessionCode) {
        broadcastToViewers(adminSessionCode, language, text);
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
