'use client';

import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';

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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(30,215,96,0.14),transparent_38%)]" />
      <div className="pointer-events-none absolute right-[-8%] top-[-10%] h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute left-[-5%] bottom-[-5%] h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

      <header className="relative z-10 flex items-center justify-between gap-2 border-b border-white/5 bg-black/20 px-4 py-3 backdrop-blur-xl">
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Kembali</span>
        </Link>

        <h1 className="flex-1 text-center text-sm font-semibold tracking-tight text-foreground">
          Chat
        </h1>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Model
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="field focus-ring rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground"
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

      <main
        className="relative z-10 flex-1 overflow-y-auto px-3 py-5 sm:px-6"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-accent" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-accent shadow-sm shadow-black/30" />
            </div>
            <div>
              <p className="text-base font-bold text-white">Mulai ngobrol</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ketik ide atau pertanyaan apa aja.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const isStreamingPlaceholder =
            !isUser && i === messages.length - 1 && showStatus;

          return (
            <div
              key={i}
              className={`chat-bubble-enter mb-5 flex items-start gap-2 ${
                isUser ? 'justify-end' : 'justify-start'
              }`}
            >
              {!isUser && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[11px] font-black text-accent">
                  AI
                </div>
              )}

              <div
                className={`flex max-w-[85%] flex-col sm:max-w-[75%] ${
                  isUser ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`relative ${
                    isUser
                      ? 'rounded-2xl rounded-br-md bg-accent px-4 py-3 text-accent-foreground shadow-lg shadow-black/20'
                      : 'rounded-2xl rounded-bl-md border border-white/10 bg-[#1e1e1e]/90 px-4 py-3 text-foreground shadow-xl shadow-black/20'
                  } ${isStreamingPlaceholder ? 'min-w-[160px]' : ''}`}
                >
                  {isStreamingPlaceholder ? (
                    <div className="flex h-5 items-center gap-1.5">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content}
                    </p>
                  )}
                </div>

                {msg.content && !isStreamingPlaceholder && (
                  <div
                    className={`mt-1.5 flex items-center gap-2 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {msg.timestamp}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.content, i)}
                      className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      aria-label="Salin pesan"
                      title="Salin pesan"
                    >
                      {copiedIndex === i ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
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
          <p className="text-xs font-medium text-status-error" role="alert">
            {error}
          </p>
        )}
        <div ref={scrollRef} />
      </main>

      <footer className="relative z-10 border-t border-white/5 bg-black/20 px-3 py-3 backdrop-blur-xl sm:px-6 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-end gap-2">
          <textarea
            className="field focus-ring max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-text-disabled focus:outline-none disabled:opacity-60"
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
            className="btn btn-primary h-11 w-11 shrink-0 rounded-full p-0 focus-ring"
            aria-label="Kirim pesan"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
