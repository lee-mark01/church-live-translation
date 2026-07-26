'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerLanguage, ViewerMessage, ViewerSentence } from '@/lib/types/audio';
import { LANGUAGES, LANGUAGE_LABELS } from '@/lib/languages';

const WS_URL = 'ws://localhost:3001';

type FontSize = 'sm' | 'md' | 'lg';
const FONT_SIZE_CLASSES: Record<FontSize, string> = {
  sm: 'text-lg sm:text-xl leading-relaxed',
  md: 'text-2xl sm:text-3xl leading-relaxed',
  lg: 'text-3xl sm:text-4xl md:text-5xl leading-snug',
};

// --- Wake Lock hook ---
function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const acquire = async () => {
      if (!('wakeLock' in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch {}
    };

    acquire();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      wakeLockRef.current?.release();
    };
  }, []);
}

export default function SubtitleViewer({ sessionCode }: { sessionCode: string }) {
  const [language, setLanguage] = useState<ViewerLanguage>('en');
  const [connected, setConnected] = useState(false);
  const [sentences, setSentences] = useState<ViewerSentence[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [showControls, setShowControls] = useState(true);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [correctedIds, setCorrectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ sentenceId: string; text: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useWakeLock();

  // Auto-hide controls after 3 seconds
  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const toggleControls = useCallback(() => {
    setShowControls((prev) => {
      if (!prev) {
        scheduleHideControls();
        return true;
      }
      return false;
    });
  }, [scheduleHideControls]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sentences, streamingText, isAutoScroll]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setIsAutoScroll(isAtBottom);
  }, []);

  const jumpToLive = useCallback(() => {
    setIsAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const scrollToSentence = useCallback((sentenceId: string) => {
    const el = sentenceRefs.current.get(sentenceId);
    const container = scrollRef.current;
    if (el && container) {
      setIsAutoScroll(false);
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScroll = container.scrollTop + (elRect.top - containerRect.top) - container.clientHeight / 2 + el.offsetHeight / 2;
      container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
    setToast(null);
  }, []);

  const connect = useCallback((lang: ViewerLanguage) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({
        type: 'viewer.join',
        sessionCode,
        language: lang,
      }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ViewerMessage;
      switch (msg.type) {
        case 'subtitle.delta':
          setStreamingText((prev) => prev + msg.text);
          break;
        case 'subtitle.history':
          setSentences(msg.sentences);
          setStreamingText(msg.streamingText || '');
          break;
        case 'subtitle.correction': {
          setSentences((prev) =>
            prev.map((s) =>
              s.id === msg.sentenceId
                ? { ...s, text: msg.text, corrected: true }
                : s,
            ),
          );
          // Trigger highlight animation
          setCorrectedIds((prev) => new Set(prev).add(msg.sentenceId));
          setTimeout(() => {
            setCorrectedIds((prev) => {
              const next = new Set(prev);
              next.delete(msg.sentenceId);
              return next;
            });
          }, 3000);
          // Show toast
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast({ sentenceId: msg.sentenceId, text: msg.text });
          toastTimerRef.current = setTimeout(() => setToast(null), 5000);
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto reconnect after 2s
      setTimeout(() => {
        if (wsRef.current === ws) {
          connect(lang);
        }
      }, 2000);
    };
    ws.onerror = () => setConnected(false);
  }, [sessionCode]);

  useEffect(() => {
    connect(language);
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show controls initially, then auto-hide
  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [scheduleHideControls]);

  const changeLanguage = (lang: ViewerLanguage) => {
    setLanguage(lang);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'viewer.changeLanguage',
        language: lang,
      }));
    } else {
      connect(lang);
    }
    scheduleHideControls();
  };

  const cycleFontSize = () => {
    setFontSize((prev) => {
      if (prev === 'sm') return 'md';
      if (prev === 'md') return 'lg';
      return 'sm';
    });
    scheduleHideControls();
  };

  const hasContent = sentences.length > 0 || streamingText;

  return (
    <div
      className="relative flex h-dvh flex-col bg-black"
      onClick={toggleControls}
    >
      {/* Controls overlay — fades in/out */}
      <div
        className={`absolute inset-x-0 top-0 z-10 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <header className="flex items-center justify-between px-4 py-3 sm:px-6">
          {/* Left: connection status */}
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
            />
            <span className="text-[10px] tracking-wide text-zinc-600">{sessionCode}</span>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            {/* Font size toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); cycleFontSize(); }}
              className="rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {fontSize === 'sm' ? 'A' : fontSize === 'md' ? 'A+' : 'A++'}
            </button>

            {/* Language toggle */}
            {LANGUAGES.map(({ code: lang }) => (
              <button
                key={lang}
                onClick={(e) => { e.stopPropagation(); changeLanguage(lang); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all sm:text-sm ${
                  language === lang
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>
        </header>
      </div>

      {/* Subtitle area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col overflow-y-auto px-5 pb-12 pt-16 sm:px-8 md:px-12 lg:px-20"
      >
        {/* Spacer pushes content to bottom when short, disappears when content overflows */}
        <div className="flex-1" />
        {hasContent ? (
          <div className="space-y-4">
            {/* Finalized sentences */}
            {sentences.map((sentence) => (
              <p
                key={sentence.id}
                ref={(el) => {
                  if (el) sentenceRefs.current.set(sentence.id, el);
                  else sentenceRefs.current.delete(sentence.id);
                }}
                className={`${FONT_SIZE_CLASSES[fontSize]} font-medium transition-all duration-500 ${
                  correctedIds.has(sentence.id)
                    ? 'text-amber-300'
                    : sentence.corrected
                      ? 'text-amber-200/70'
                      : 'text-[#F5F0E8] opacity-50'
                }`}
              >
                {sentence.text}
              </p>
            ))}

            {/* Currently streaming text — full brightness */}
            {streamingText && (
              <p
                className={`${FONT_SIZE_CLASSES[fontSize]} font-medium text-[#F5F0E8]`}
              >
                {streamingText}
              </p>
            )}
          </div>
        ) : (
          <p className="text-center text-lg text-zinc-700">
            {connected ? 'Waiting for subtitles...' : 'Connecting...'}
          </p>
        )}
      </div>

      {/* Toast notification for corrections */}
      {toast && (
        <div
          onClick={(e) => { e.stopPropagation(); scrollToSentence(toast.sentenceId); }}
          className="absolute top-14 left-1/2 z-20 -translate-x-1/2 animate-slide-down cursor-pointer rounded-lg bg-amber-500/90 px-4 py-2.5 shadow-lg backdrop-blur transition-transform hover:scale-105"
          style={{ maxWidth: 'calc(100% - 2rem)' }}
        >
          <p className="text-xs font-medium text-black/70">Translation updated</p>
          <p className="mt-0.5 text-sm font-medium text-black line-clamp-2">{toast.text}</p>
        </div>
      )}

      {/* Jump to live button */}
      {!isAutoScroll && (
        <button
          onClick={(e) => { e.stopPropagation(); jumpToLive(); }}
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur transition-transform hover:scale-105"
        >
          ↓ Live
        </button>
      )}
    </div>
  );
}
