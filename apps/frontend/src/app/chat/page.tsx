'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

    const userMessage: Message = { role: 'user', content: input };
    const assistantPlaceholder: Message = { role: 'assistant', content: '' };

    const displayMessages = [...messages, userMessage, assistantPlaceholder];
    const apiMessages = [...messages, userMessage];

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
            updated.push({ role: 'assistant', content: delta });
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
    <div className="flex flex-col h-screen -mx-4 -my-6 px-4 py-4">
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

      <div className="flex items-center justify-between mb-3">
        <Link href="/" className="text-sm text-neutral-400">
          ← Kembali
        </Link>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1 text-xs"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-3">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500 text-center mt-10">Mulai ngobrol...</p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex chat-bubble-enter ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <span className="text-xs text-neutral-400 mb-1">
                {msg.role === 'user' ? 'Kamu' : 'AI'}
              </span>

              <div
                className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-neutral-900 border border-neutral-800'
                }`}
              >
                {showStatus && i === messages.length - 1 ? (
                  <span className="text-neutral-400">{STATUS_TEXTS[statusIndex]}</span>
                ) : (
                  msg.content
                )}
              </div>

              {msg.content && (
                <button
                  onClick={() => handleCopy(msg.content, i)}
                  className="mt-1 text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none"
                  aria-label="Salin pesan"
                  title="Salin pesan"
                >
                  {copiedIndex === i ? '✓ Tersalin' : '📋 Salin'}
                </button>
              )}
            </div>
          </div>
        ))}

        {error && <p className="text-xs text-red-400">{error}</p>}
        <div ref={scrollRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm resize-none"
          rows={1}
          placeholder="Ketik pesan..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="bg-emerald-600 text-white rounded-lg px-4 text-sm font-medium disabled:opacity-40"
        >
          Kirim
        </button>
      </div>
    </div>
  );
}
