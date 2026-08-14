'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Sesuaikan daftar ini kalau model yang tersedia di reseller kamu berubah
const MODELS = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
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

    const newMessages: Message[] = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const res = await api.post<{ reply: string }>('/chat', { messages: newMessages, model });
      setMessages([...newMessages, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      setError(err.message || 'Gagal kirim pesan');
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

  return (
    <div className="flex flex-col h-screen -mx-4 -my-6 px-4 py-4">
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
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-neutral-900 border border-neutral-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && <p className="text-xs text-neutral-500">Mikir...</p>}
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
