'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerLanguage, ViewerMessage } from '@/lib/types/audio';
import { LANGUAGES, LANGUAGE_LABELS } from '@/lib/languages';

const WS_URL = 'ws://localhost:3001';

type FontSize = 'sm' | 'md' | 'lg';
const FONT_SIZE_CLASSES: Record<FontSize, string> = {
  sm: 'text-lg sm:text-xl leading-relaxed',
  md: 'text-2xl sm:text-3xl leading-relaxed',
  lg: 'text-3xl sm:text-4xl md:text-5xl leading-snug',
};

// Sentence boundary regex for Korean/English/Chinese
const SENTENCE_END = /[.!?。？！]\s*/;

function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_END);
  // Re-split with capturing the delimiters
  const segments: string[] = [];
  let remaining = text;
  for (const part of parts) {
    if (!part) continue;
    const idx = remaining.indexOf(part) + part.length;
    // Find the delimiter after this part
    const afterPart = remaining.slice(idx);
    const delimMatch = afterPart.match(/^[.!?。？！]\s*/);
    if (delimMatch) {
      segments.push(part + delimMatch[0]);
      remaining = remaining.slice(idx + delimMatch[0].length);
    } else {
      segments.push(part);
      remaining = remaining.slice(idx);
    }
  }
  return segments.filter((s) => s.trim());
}

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
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [showControls, setShowControls] = useState(true);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [text, isAutoScroll]);

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
      if (msg.type === 'subtitle.delta') {
        setText((prev) => prev + msg.text);
      } else if (msg.type === 'subtitle.history') {
        setText(msg.text);
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

  // Split text into sentences for display
  const sentences = splitSentences(text);
  const currentSentence = sentences.length > 0 ? sentences[sentences.length - 1] : '';
  const completedSentences = sentences.slice(0, -1);

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
        className="flex flex-1 flex-col justify-end overflow-y-auto px-5 pb-12 pt-16 sm:px-8 md:px-12 lg:px-20"
      >
        {text ? (
          <div className="space-y-4">
            {/* Completed sentences — faded */}
            {completedSentences.map((sentence, i) => (
              <p
                key={i}
                className={`${FONT_SIZE_CLASSES[fontSize]} font-medium text-[#F5F0E8] opacity-50 transition-opacity duration-200`}
              >
                {sentence}
              </p>
            ))}

            {/* Current sentence — full brightness */}
            {currentSentence && (
              <p
                className={`${FONT_SIZE_CLASSES[fontSize]} font-medium text-[#F5F0E8]`}
              >
                {currentSentence}
              </p>
            )}
          </div>
        ) : (
          <p className="text-center text-lg text-zinc-700">
            {connected ? 'Waiting for subtitles...' : 'Connecting...'}
          </p>
        )}
      </div>

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
