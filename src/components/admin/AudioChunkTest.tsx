'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  AudioChunkMessage,
  AudioChunkAck,
  TranscriptDelta,
  TranslationDelta,
  TranslateConnectionStatus,
  TranslateLatency,
  ViewerCountUpdate,
  ServerMessage,
  OutputLanguage,
  AdminSentence,
  SentenceComplete,
  CorrectionResult,
} from '@/lib/types/audio';
import { LANGUAGES, LANGUAGE_CODES, LANGUAGE_LABELS } from '@/lib/languages';

const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_MS = 100;
const WS_URL = 'ws://localhost:3001';

// Helper to create a Record with all language codes initialized
function langRecord<T>(init: T): Record<OutputLanguage, T> {
  return Object.fromEntries(LANGUAGE_CODES.map((c) => [c, init])) as Record<OutputLanguage, T>;
}

function generateSessionCode(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${mm}${dd}-${suffix}`;
}

export default function AudioChunkTest() {
  const [sessionCode, setSessionCode] = useState('');
  useEffect(() => {
    setSessionCode(generateSessionCode());
  }, []);
  const [isRunning, setIsRunning] = useState(false);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local chunk stats
  const [chunkCount, setChunkCount] = useState(0);
  const [currentRms, setCurrentRms] = useState<number | null>(null);

  // Server stats
  const [wsConnected, setWsConnected] = useState(false);
  const [lastAckLatency, setLastAckLatency] = useState<number | null>(null);
  const [serverTotalChunks, setServerTotalChunks] = useState(0);
  const [serverDroppedChunks, setServerDroppedChunks] = useState(0);

  // Translation state (dynamic per language)
  const [langConnected, setLangConnected] = useState<Record<OutputLanguage, boolean>>(langRecord(false));
  const [viewerCount, setViewerCount] = useState<ViewerCountUpdate | null>(null);
  const [koreanText, setKoreanText] = useState('');
  const [langText, setLangText] = useState<Record<OutputLanguage, string>>(langRecord(''));
  const [langLatency, setLangLatency] = useState<Record<OutputLanguage, number | null>>(langRecord(null));

  // Sentence correction state
  const [sentences, setSentences] = useState<AdminSentence[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [correcting, setCorrecting] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const expectedIndexRef = useRef(1);

  const stopAudio = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopAudio();
    setIsRunning(false);

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      wsRef.current = null;
      setWsConnected(false);
      setLangConnected(langRecord(false));
      return;
    }

    // Request safe stop
    ws.send(JSON.stringify({ type: 'audio.stop' }));

    const onMessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === 'audio.stop.ack') {
        clearTimeout(timer);
        cleanup();
      }
    };

    const timer = setTimeout(() => cleanup(), 3000);
    ws.addEventListener('message', onMessage);

    function cleanup() {
      ws!.removeEventListener('message', onMessage);
      ws!.close();
      wsRef.current = null;
      setWsConnected(false);
      setLangConnected(langRecord(false));
    }
  }, [stopAudio]);

  const start = useCallback(async () => {
    try {
      setError(null);
      setChunkCount(0);
      setCurrentRms(null);
      setLastAckLatency(null);
      setServerTotalChunks(0);
      setServerDroppedChunks(0);
      setKoreanText('');
      setLangText(langRecord(''));
      setLangLatency(langRecord(null));
      setSentences([]);
      expectedIndexRef.current = 1;

      // 1. Connect WebSocket
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          setWsConnected(true);
          resolve();
        };
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
      });

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;

        switch (msg.type) {
          case 'audio.chunk.ack': {
            const ack = msg as AudioChunkAck;
            setLastAckLatency(ack.clientToServerMs);
            setServerTotalChunks(ack.totalChunks);
            setServerDroppedChunks(ack.droppedChunks);
            break;
          }
          case 'translate.connection': {
            const conn = msg as TranslateConnectionStatus;
            const isConnected = conn.status === 'connected';
            setLangConnected((prev) => ({ ...prev, [conn.language]: isConnected }));
            if (conn.status === 'error') {
              console.error(`[translate:${conn.language}] error:`, conn.message);
            }
            break;
          }
          case 'transcript.delta': {
            const delta = msg as TranscriptDelta;
            setKoreanText((prev) => prev + delta.text);
            break;
          }
          case 'translation.delta': {
            const delta = msg as TranslationDelta;
            setLangText((prev) => ({ ...prev, [delta.language]: prev[delta.language] + delta.text }));
            break;
          }
          case 'translate.latency': {
            const lat = msg as TranslateLatency;
            setLangLatency((prev) => ({ ...prev, [lat.language]: lat.ms }));
            break;
          }
          case 'viewer.count': {
            setViewerCount(msg as ViewerCountUpdate);
            break;
          }
          case 'sentence.complete': {
            const sc = msg as SentenceComplete;
            setSentences((prev) => {
              const idx = prev.findIndex((s) => s.id === sc.sentence.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = sc.sentence;
                return updated;
              }
              return [...prev, sc.sentence];
            });
            break;
          }
          case 'correction.result': {
            const cr = msg as CorrectionResult;
            setSentences((prev) =>
              prev.map((s) =>
                s.id === cr.sentenceId
                  ? { ...s, korean: cr.korean, translations: cr.translations, corrected: true }
                  : s,
              ),
            );
            setCorrecting(false);
            setEditingId(null);
            break;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        setLangConnected(langRecord(false));
      };

      // 2. Get audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 48000 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = ctx;
      setSampleRate(ctx.sampleRate);

      if (ctx.sampleRate !== 48000) {
        setError(
          `Input sample rate is ${ctx.sampleRate} Hz, expected 48000 Hz. ` +
          `24kHz downsampling requires exactly 48kHz input.`
        );
        ctx.close();
        stream.getTracks().forEach((t) => t.stop());
        ws.close();
        return;
      }

      await ctx.audioWorklet.addModule('/audio-chunk-worklet.js');

      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, 'audio-chunk-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.postMessage({ type: 'set-chunk-ms', chunkMs: CHUNK_MS });

      workletNode.port.onmessage = (e) => {
        if (e.data.type === 'chunk') {
          const { chunkIndex, pcm16, rms } = e.data as {
            chunkIndex: number;
            pcm16: ArrayBuffer;
            rms: number;
          };
          const capturedAt = Date.now();
          const sizeBytes = pcm16.byteLength;

          setChunkCount(chunkIndex);
          setCurrentRms(rms);

          expectedIndexRef.current = chunkIndex + 1;

          // Send to WebSocket server
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const bytes = new Uint8Array(pcm16);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const audio = btoa(binary);

            const msg: AudioChunkMessage = {
              type: 'audio.chunk',
              sessionCode,
              seq: chunkIndex,
              capturedAt,
              chunkMs: CHUNK_MS,
              format: 'pcm16',
              sampleRate: OUTPUT_SAMPLE_RATE,
              channels: 1,
              sizeBytes,
              rms,
              audio,
            };
            wsRef.current.send(JSON.stringify(msg));
          }
        }
      };

      source.connect(workletNode);
      workletNode.connect(ctx.destination);
      setIsRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionCode]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  const [viewerUrl, setViewerUrl] = useState(`/watch/${sessionCode}`);
  useEffect(() => {
    setViewerUrl(`${window.location.origin}/watch/${sessionCode}`);
  }, [sessionCode]);

  const [copied, setCopied] = useState(false);
  const copyUrl = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [diagOpen, setDiagOpen] = useState(false);

  // Correction handlers
  const startEdit = (sentence: AdminSentence) => {
    setEditingId(sentence.id);
    setEditText(sentence.korean);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const submitCorrection = () => {
    if (!editingId || !editText.trim() || !wsRef.current) return;
    const original = sentences.find((s) => s.id === editingId);
    if (original && original.korean === editText.trim()) {
      cancelEdit();
      return;
    }
    setCorrecting(true);
    wsRef.current.send(JSON.stringify({
      type: 'correction.request',
      sentenceId: editingId,
      correctedKorean: editText.trim(),
    }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Live Translation Admin</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">실시간 설교 번역 자막 운영 콘솔</p>
      </div>

      {/* Session Info + QR */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Session</h2>
        <div className="flex items-start gap-4">
          <QRCodeSVG value={viewerUrl} size={96} bgColor="transparent" fgColor="currentColor" className="shrink-0 text-zinc-900 dark:text-zinc-100" />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-xs text-zinc-400">Session Code</p>
              <p className="font-mono text-sm font-semibold">{sessionCode}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-400">Viewer URL</p>
              <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">{viewerUrl}</p>
            </div>
            <button
              onClick={copyUrl}
              className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          외국인 성도/방문자는 QR 코드를 스캔해 자막 페이지에 접속할 수 있습니다.
        </p>
      </section>

      {/* Controls */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>

        <div className="flex items-center gap-3">
          <button
            onClick={isRunning ? stop : start}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${
              isRunning
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isRunning ? 'Stop' : 'Start'}
          </button>

          <Badge active={isRunning} label={isRunning ? 'Running' : 'Stopped'} />
          <Badge active={wsConnected} label={wsConnected ? 'WS' : 'WS Off'} />
          {LANGUAGES.map(({ code }) => (
            <Badge key={code} active={langConnected[code]} label={langConnected[code] ? code.toUpperCase() : `${code.toUpperCase()} Off`} />
          ))}
        </div>

        {/* RMS level bar */}
        {isRunning && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-zinc-400">RMS</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className={`h-full rounded-full transition-all ${
                  (currentRms ?? 0) >= 0.003 ? 'bg-green-500' : 'bg-zinc-400'
                }`}
                style={{ width: `${Math.min((currentRms ?? 0) * 500, 100)}%` }}
              />
            </div>
            <span className="w-12 text-right font-mono text-xs text-zinc-500">
              {currentRms !== null ? currentRms.toFixed(4) : '—'}
            </span>
          </div>
        )}

        {/* Latency */}
        {LANGUAGE_CODES.some((c) => langLatency[c] !== null) && (
          <p className="mt-2 text-xs text-zinc-400">
            Latency: {LANGUAGES.map(({ code }) => `${code.toUpperCase()} ${langLatency[code] !== null ? `${langLatency[code]}ms` : '—'}`).join(' · ')}
          </p>
        )}

        {/* Viewer count */}
        <p className="mt-2 text-xs text-zinc-400">
          Viewers: {viewerCount
            ? `${viewerCount.total} (${LANGUAGES.map(({ code, label }) => `${label} ${viewerCount.byLanguage[code] ?? 0}`).join(' · ')})`
            : '—'}
        </p>
      </section>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Live Translation Stream */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Live Translation
        </h2>
        <div className="space-y-4 min-h-[120px]">
          {!LANGUAGE_CODES.some((c) => langConnected[c]) ? (
            <p className="text-sm text-zinc-400">Translation not connected</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-1">Korean (source)</p>
                <p className="text-sm whitespace-pre-wrap">{koreanText || <span className="text-zinc-400 italic">Waiting for speech...</span>}</p>
              </div>
              {LANGUAGES.map(({ code, label }) => (
                <div key={code}>
                  <p className="text-xs font-semibold text-zinc-400 mb-1">{label}</p>
                  <p className="text-sm whitespace-pre-wrap">{langText[code] || <span className="text-zinc-400 italic">—</span>}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Sentence Correction Panel */}
      {sentences.length > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            문장 수정
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            잘못 인식된 문장을 클릭해서 수정하면 번역이 자동으로 다시 됩니다.
          </p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {sentences.map((sentence) => (
              <div
                key={sentence.id}
                className={`rounded-md border p-3 transition-colors ${
                  sentence.corrected
                    ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'
                } ${editingId === sentence.id ? '' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
              >
                {editingId === sentence.id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitCorrection();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-600 dark:bg-zinc-800"
                      autoFocus
                      disabled={correcting}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitCorrection}
                        disabled={correcting}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {correcting ? '번역 중...' : '수정'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={correcting}
                        className="rounded bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  // Display mode
                  <div onClick={() => startEdit(sentence)}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-300 dark:text-zinc-600">{sentence.id}</span>
                      {sentence.corrected && (
                        <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                          수정됨
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-0.5">{sentence.korean}</p>
                    {Object.keys(sentence.translations).length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {LANGUAGES.map(({ code }) =>
                          sentence.translations[code] ? (
                            <p key={code} className="text-xs text-zinc-500 dark:text-zinc-400">
                              <span className="font-medium text-zinc-400 dark:text-zinc-500">{code.toUpperCase()}</span>{' '}
                              {sentence.translations[code]}
                            </p>
                          ) : null,
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Developer Diagnostics (collapsible) */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <button
          onClick={() => setDiagOpen(!diagOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Developer Diagnostics
          </span>
          <span className="text-xs text-zinc-400">{diagOpen ? '▲' : '▼'}</span>
        </button>

        {diagOpen && (
          <div className="border-t border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                <Row label="Format" value="PCM16 mono 24kHz" />
                <Row
                  label="Input Sample Rate"
                  value={sampleRate ? `${sampleRate} Hz` : '—'}
                  status={sampleRate === null ? undefined : sampleRate === 48000 ? 'ok' : 'error'}
                />
                <Row label="Chunk Duration" value={`${CHUNK_MS}ms`} />
                <Row label="Chunk Count" value={chunkCount > 0 ? String(chunkCount) : '—'} />
                <Row
                  label="Client → Server"
                  value={lastAckLatency !== null ? `${lastAckLatency}ms` : '—'}
                />
                <Row
                  label="Total Chunks (server)"
                  value={serverTotalChunks > 0 ? String(serverTotalChunks) : '—'}
                />
                <Row
                  label="Dropped Chunks"
                  value={String(serverDroppedChunks)}
                  status={serverTotalChunks > 0 ? (serverDroppedChunks === 0 ? 'ok' : 'error') : undefined}
                />
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Badge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-zinc-400'}`} />
      {label}
    </span>
  );
}

function Row({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: 'ok' | 'warn' | 'error';
}) {
  let valueClass = 'text-zinc-900 dark:text-zinc-100';
  if (status === 'ok') valueClass = 'text-green-600 dark:text-green-400 font-medium';
  if (status === 'warn') valueClass = 'text-yellow-600 dark:text-yellow-400 font-medium';
  if (status === 'error') valueClass = 'text-red-600 dark:text-red-400 font-bold';

  return (
    <tr>
      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{label}</td>
      <td className={`px-4 py-3 text-right ${valueClass}`}>{value}</td>
    </tr>
  );
}
