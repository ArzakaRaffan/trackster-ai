'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    try {
      const data = await api.post<{ reply: string }>('/chat', {
        messages: apiMessages,
        model,
      });

      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        const last = updated[lastIndex];

        if (last && last.role === 'assistant') {
          updated[lastIndex] = { ...last, content: data.reply };
        } else {
          // Should not happen, but keep the UI consistent if it does.
          updated.push({ role: 'assistant', content: data.reply });
        }

        return updated;
      });
    } catch (err: any) {
      setError(err?.message || 'Gagal kirim pesan');
    } finally {
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
  const showTyping = loading && lastAssistantMsg?.role === 'assistant' && lastAssistantMsg.content === '';

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

      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
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
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-neutral-900 border border-neutral-800'
              }`}
            >
              {msg.role === 'assistant' && showTyping && i === messages.length - 1 ? (
                <span className="flex space-x-1 items-center">
                  <span
                    className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </span>
              ) : (
                msg.content
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
