'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerLanguage, SubtitleDelta } from '@/lib/types/audio';

const WS_URL = 'ws://localhost:3001';

const LANGUAGE_LABELS: Record<ViewerLanguage, string> = {
  en: 'English',
  zh: '中文',
};

export default function SubtitleViewer({ sessionCode }: { sessionCode: string }) {
  const [language, setLanguage] = useState<ViewerLanguage>('en');
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

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
      const msg = JSON.parse(e.data) as SubtitleDelta;
      if (msg.type === 'subtitle.delta') {
        setText((prev) => prev + msg.text);
      }
    };

    ws.onclose = () => setConnected(false);
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

  const changeLanguage = (lang: ViewerLanguage) => {
    setLanguage(lang);
    setText('');
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'viewer.changeLanguage',
        language: lang,
      }));
    } else {
      connect(lang);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-xs text-zinc-600">{sessionCode}</span>
        </div>

        <div className="flex gap-1">
          {(Object.keys(LANGUAGE_LABELS) as ViewerLanguage[]).map((lang) => (
            <button
              key={lang}
              onClick={() => changeLanguage(lang)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors sm:text-sm ${
                language === lang
                  ? 'bg-white text-black'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
        </div>
      </header>

      {/* Subtitle display */}
      <main className="flex flex-1 flex-col justify-end px-5 pb-10 sm:px-10 md:px-16 lg:px-24">
        {text ? (
          <p className="text-2xl font-medium leading-relaxed sm:text-3xl md:text-4xl lg:text-5xl">
            {text}
          </p>
        ) : (
          <p className={`text-xl sm:text-2xl ${connected ? 'text-zinc-700' : 'text-zinc-800'}`}>
            {connected ? 'Waiting for subtitles...' : 'Connecting...'}
          </p>
        )}
      </main>
    </div>
  );
}
