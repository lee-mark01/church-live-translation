'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  AudioChunkMessage,
  AudioChunkAck,
  SttTranscriptDelta,
  SttTranscriptFinal,
  SttConnectionStatus,
  TranslationCompleted,
  TranslationError,
  ViewerCountUpdate,
  ServerMessage,
} from '@/lib/types/audio';

interface TranscriptItem {
  id: number;
  sourceText: string;
  en?: string;
  zhHans?: string;
  zhHant?: string;
  translationStatus: 'pending' | 'completed' | 'error';
  translationError?: string;
}

const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_MS = 100;
const WS_URL = 'ws://localhost:3001';
const SESSION_CODE = 'TEST-001';

export default function AudioChunkTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local chunk stats
  const [chunkCount, setChunkCount] = useState(0);
  const [latestChunkSize, setLatestChunkSize] = useState<number | null>(null);
  const [chunkInterval, setChunkInterval] = useState<number | null>(null);
  const [sequenceOk, setSequenceOk] = useState(true);
  const [currentRms, setCurrentRms] = useState<number | null>(null);

  // Server stats (from ack)
  const [wsConnected, setWsConnected] = useState(false);
  const [lastAckLatency, setLastAckLatency] = useState<number | null>(null);
  const [serverTotalChunks, setServerTotalChunks] = useState(0);
  const [serverDroppedChunks, setServerDroppedChunks] = useState(0);

  // STT state
  const [sttConnected, setSttConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState<ViewerCountUpdate | null>(null);
  const [partialText, setPartialText] = useState('');
  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastChunkTimeRef = useRef<number | null>(null);
  const expectedIndexRef = useRef(1);

  const expectedSize = Math.floor((OUTPUT_SAMPLE_RATE * CHUNK_MS) / 1000) * 2;

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
      setSttConnected(false);
      return;
    }

    // Request safe stop — server will flush remaining audio
    ws.send(JSON.stringify({ type: 'audio.stop' }));

    // Wait for ack or timeout, then close
    const onMessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === 'audio.stop.ack') {
        clearTimeout(timer);
        cleanup();
      }
    };

    const timer = setTimeout(() => {
      cleanup();
    }, 3000);

    ws.addEventListener('message', onMessage);

    function cleanup() {
      ws!.removeEventListener('message', onMessage);
      ws!.close();
      wsRef.current = null;
      setWsConnected(false);
      setSttConnected(false);
    }
  }, [stopAudio]);

  const start = useCallback(async () => {
    try {
      setError(null);
      setChunkCount(0);
      setLatestChunkSize(null);
      setChunkInterval(null);
      setSequenceOk(true);
      setLastAckLatency(null);
      setServerTotalChunks(0);
      setServerDroppedChunks(0);
      setCurrentRms(null);
      setPartialText('');
      setTranscriptItems([]);
      lastChunkTimeRef.current = null;
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
          case 'stt.connection': {
            const conn = msg as SttConnectionStatus;
            setSttConnected(conn.status === 'connected');
            if (conn.status === 'error') {
              console.error('[stt] error:', conn.message);
            }
            break;
          }
          case 'stt.transcript.delta': {
            const delta = msg as SttTranscriptDelta;
            setPartialText((prev) => prev + delta.text);
            break;
          }
          case 'stt.transcript.final': {
            const t = msg as SttTranscriptFinal;
            setTranscriptItems((prev) => [
              ...prev,
              {
                id: Date.now(),
                sourceText: t.text,
                translationStatus: 'pending',
              },
            ]);
            setPartialText('');
            break;
          }
          case 'translation.completed': {
            const tr = msg as TranslationCompleted;
            setTranscriptItems((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].sourceText === tr.sourceText && next[i].translationStatus === 'pending') {
                  next[i] = {
                    ...next[i],
                    en: tr.en,
                    zhHans: tr.zhHans,
                    zhHant: tr.zhHant,
                    translationStatus: 'completed',
                  };
                  break;
                }
              }
              return next;
            });
            break;
          }
          case 'translation.error': {
            const tr = msg as TranslationError;
            setTranscriptItems((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].sourceText === tr.sourceText && next[i].translationStatus === 'pending') {
                  next[i] = {
                    ...next[i],
                    translationStatus: 'error',
                    translationError: tr.message,
                  };
                  break;
                }
              }
              return next;
            });
            break;
          }
          case 'viewer.count': {
            setViewerCount(msg as ViewerCountUpdate);
            break;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        setSttConnected(false);
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
          const now = performance.now();
          const capturedAt = Date.now();
          const sizeBytes = pcm16.byteLength;

          setChunkCount(chunkIndex);
          setLatestChunkSize(sizeBytes);
          setCurrentRms(rms);

          if (lastChunkTimeRef.current !== null) {
            setChunkInterval(Math.round(now - lastChunkTimeRef.current));
          }
          lastChunkTimeRef.current = now;

          if (chunkIndex !== expectedIndexRef.current) {
            setSequenceOk(false);
          }
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
              sessionCode: SESSION_CODE,
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
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const [viewerUrl, setViewerUrl] = useState(`/watch/${SESSION_CODE}`);
  useEffect(() => {
    setViewerUrl(`${window.location.origin}/watch/${SESSION_CODE}`);
  }, []);

  const [copied, setCopied] = useState(false);
  const copyUrl = () => {
    navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [diagOpen, setDiagOpen] = useState(false);

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
              <p className="font-mono text-sm font-semibold">{SESSION_CODE}</p>
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
          <Badge active={sttConnected} label={sttConnected ? 'STT' : 'STT Off'} />
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

        {/* Viewer count */}
        <p className="mt-2 text-xs text-zinc-400">
          Viewers: {viewerCount
            ? `${viewerCount.total} (EN ${viewerCount.byLanguage.en} · 简 ${viewerCount.byLanguage.zhHans} · 繁 ${viewerCount.byLanguage.zhHant})`
            : '—'}
        </p>
      </section>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Transcript & Translation */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Transcript & Translation
        </h2>
        <div className="min-h-[120px]">
          {partialText && (
            <p className="mb-2 text-sm text-zinc-400 italic">{partialText}</p>
          )}

          {transcriptItems.length === 0 && !partialText ? (
            <p className="text-sm text-zinc-400">
              {sttConnected ? 'Waiting for speech...' : 'STT not connected'}
            </p>
          ) : (
            <div className="space-y-3">
              {transcriptItems.map((item, index) => (
                <div key={item.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                  <p className="mb-2 text-xs text-zinc-400">#{index + 1}</p>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-semibold">Korean</span>: {item.sourceText}
                    </p>
                    <p>
                      <span className="font-semibold">English</span>:{' '}
                      <span className={item.en ? '' : 'text-zinc-400 italic'}>
                        {item.en ?? 'Translating...'}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold">简体中文</span>:{' '}
                      <span className={item.zhHans ? '' : 'text-zinc-400 italic'}>
                        {item.zhHans ?? 'Translating...'}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold">繁體中文</span>:{' '}
                      <span className={item.zhHant ? '' : 'text-zinc-400 italic'}>
                        {item.zhHant ?? 'Translating...'}
                      </span>
                    </p>
                    {item.translationStatus === 'error' && (
                      <p className="text-red-500">
                        Translation failed: {item.translationError}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

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
                <Row
                  label="Chunk Count"
                  value={chunkCount > 0 ? String(chunkCount) : '—'}
                  highlight={chunkCount > 0}
                />
                <Row
                  label="Latest Chunk Size"
                  value={latestChunkSize !== null ? `${latestChunkSize} bytes` : '—'}
                  status={
                    latestChunkSize !== null
                      ? latestChunkSize === expectedSize ? 'ok' : 'warn'
                      : undefined
                  }
                />
                <Row
                  label="Sequence"
                  value={
                    chunkCount === 0
                      ? '—'
                      : sequenceOk ? `1 → ${chunkCount} OK` : 'SEQUENCE ERROR'
                  }
                  status={chunkCount === 0 ? undefined : sequenceOk ? 'ok' : 'error'}
                />
                <Row
                  label="Client → Server"
                  value={lastAckLatency !== null ? `${lastAckLatency}ms` : '—'}
                />
                <Row
                  label="Total Chunks"
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
  highlight,
  status,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  status?: 'ok' | 'warn' | 'error';
}) {
  let valueClass = 'text-zinc-900 dark:text-zinc-100';
  if (status === 'ok') valueClass = 'text-green-600 dark:text-green-400 font-medium';
  if (status === 'warn') valueClass = 'text-yellow-600 dark:text-yellow-400 font-medium';
  if (status === 'error') valueClass = 'text-red-600 dark:text-red-400 font-bold';
  if (highlight) valueClass += ' tabular-nums';

  return (
    <tr>
      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{label}</td>
      <td className={`px-4 py-3 text-right ${valueClass}`}>{value}</td>
    </tr>
  );
}
