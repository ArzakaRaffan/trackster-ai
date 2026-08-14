'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const STATUS_TEXTS = [
  'Sedang berpikir...',
  'Menyusun jawaban...',
  'Sebentar ya...',
  'Mengumpulkan informasi...',
  'Hampir selesai...',
];

// Sesuaikan daftar ini kalau model yang tersedia di reseller kamu berubah
const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { value: 'glm-5.2', label: 'GLM 5.2' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { value: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code (Highspeed)' },
  { value: 'kimi-k3', label: 'Kimi K3' },
  { value: 'minimax-m3', label: 'MiniMax M3' },
];

const formatTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(MODELS[0].value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusIndex, setStatusIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const statusTimer = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (statusTimer.current) {
        clearInterval(statusTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hasStarted && statusTimer.current) {
      clearInterval(statusTimer.current);
      statusTimer.current = null;
    }
  }, [hasStarted]);

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      setError('Gagal menyalin teks');
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const timestamp = formatTime();
    const userMessage: Message = { role: 'user', content: input, timestamp };
    const assistantPlaceholder: Message = { role: 'assistant', content: '', timestamp };

    const displayMessages = [...messages, userMessage, assistantPlaceholder];
    const apiMessages = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: input },
    ];

    setMessages(displayMessages);
    setInput('');
    setError('');
    setLoading(true);
    setHasStarted(false);
    setStatusIndex(0);

    if (statusTimer.current) {
      clearInterval(statusTimer.current);
    }
    statusTimer.current = setInterval(() => {
      setStatusIndex((idx) => (idx + 1) % STATUS_TEXTS.length);
    }, 1500);

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
    const controller = new AbortController();

    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ messages: apiMessages, model }),
      });

      if (!response.ok || !response.body) {
        const errText = await response?.text().catch(() => '');
        throw new Error(errText || 'Gagal menghubungi server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const appendDelta = (delta: string) => {
        if (!delta) return;
        setHasStarted(true);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          const last = updated[lastIndex];

          if (last && last.role === 'assistant') {
            updated[lastIndex] = { ...last, content: last.content + delta };
          } else {
            updated.push({
              role: 'assistant',
              content: delta,
              timestamp: formatTime(),
            });
          }

          return updated;
        });
      };

      const handleRawEvent = (rawEvent: string) => {
        const lines = rawEvent.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));

        if (!dataLine) return;

        const data = dataLine.slice(6).trim();

        if (eventLine?.includes('error')) {
          try {
            const parsed = JSON.parse(data);
            setError(parsed?.message || 'Terjadi kesalahan dari server');
          } catch {
            setError('Terjadi kesalahan dari server');
          }
          return;
        }

        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.delta || parsed.choices?.[0]?.delta?.content;
          if (delta) appendDelta(delta);
        } catch {
          // ignore malformed JSON
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleRawEvent(rawEvent);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Gagal kirim pesan');
    } finally {
      if (statusTimer.current) {
        clearInterval(statusTimer.current);
        statusTimer.current = null;
      }
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastAssistantMsg = messages[messages.length - 1];
  const showStatus =
    loading &&
    lastAssistantMsg?.role === 'assistant' &&
    lastAssistantMsg.content === '' &&
    !hasStarted;

  return (
    <div className="flex flex-col h-screen -mx-4 -my-6 overflow-hidden bg-neutral-950 text-neutral-100">
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .chat-bubble-enter {
          animation: fadeInUp 0.2s ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-bubble-enter {
            animation: none;
          }
        }
      `}</style>

      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/60 px-4 py-3 backdrop-blur">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 rounded-md px-2 py-1"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">Kembali</span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-neutral-500 sm:inline">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            aria-label="Pilih model AI"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Messages */}
      <main
        className="flex-1 overflow-y-auto px-3 py-4 sm:px-4"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-neutral-500">
            Mulai ngobrol...
          </p>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={i}
              className={`chat-bubble-enter mb-4 flex items-end gap-2 ${
                isUser ? 'justify-end' : 'justify-start'
              }`}
            >
              {!isUser && (
                <div className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-900/50 text-[10px] font-bold text-emerald-200">
                  AI
                </div>
              )}
              <div
                className={`flex max-w-[85%] flex-col sm:max-w-[75%] ${
                  isUser ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                    isUser
                      ? 'rounded-br-md bg-emerald-600 text-white'
                      : 'rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-200'
                  }`}
                >
                  {showStatus && i === messages.length - 1 ? (
                    <span className="italic text-neutral-400">
                      {STATUS_TEXTS[statusIndex]}
                    </span>
                  ) : (
                    msg.content
                  )}
                </div>

                {msg.content && (
                  <div
                    className={`mt-1 flex items-center gap-2 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span className="text-[10px] text-neutral-500">
                      {msg.timestamp}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.content, i)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                      aria-label="Salin pesan"
                      title="Salin pesan"
                    >
                      {copiedIndex === i ? (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3"
                          />
                        </svg>
                      )}
                      {copiedIndex === i ? 'Tersalin' : 'Salin'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        <div ref={scrollRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-neutral-800 bg-neutral-900/70 px-3 py-3 backdrop-blur sm:px-4">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm leading-relaxed placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
            rows={1}
            placeholder="Tulis pesan..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Tulis pesan"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Kirim pesan"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
