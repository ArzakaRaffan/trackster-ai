'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDown,
  Briefcase,
  Check,
  Copy,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, ChatSession, ChatMessage } from '@/lib/api';
import ModelSelector from '@/components/ModelSelector';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Session extends ChatSession {
  title: string;
}

const STATUS_TEXTS = [
  'Sedang berpikir...',
  'Menyusun jawaban...',
  'Sebentar ya...',
  'Mengumpulkan informasi...',
  'Hampir selesai...',
];

const MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', disabled: false },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', disabled: false },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', disabled: false },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', disabled: true },
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', disabled: false },
  { value: 'glm-5.2', label: 'GLM 5.2', disabled: false },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', disabled: true },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', disabled: true },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', disabled: true },
  { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', disabled: false },
  { value: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code (Highspeed)', disabled: true },
  { value: 'kimi-k3', label: 'Kimi K3', disabled: false },
  { value: 'minimax-m3', label: 'MiniMax M3', disabled: false },
];

const DEFAULT_MODEL = MODELS[0].value;
const MODEL_STORAGE_KEY = 'ai-trackster-selected-model';

const formatTime = (date?: string | Date) => {
  if (date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatRelative = (iso: string | null) => {
  if (!iso) return 'Belum ada pesan';
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID');
};

const renderEmphasis = (text: string) => {
  const parts = text.split(
    /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*)/g,
  );

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith('***') && part.endsWith('***') && part.length >= 6) {
      const inner = part.slice(3, -3);
      return (
        <strong key={index}>
          <em>{inner}</em>
        </strong>
      );
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const inner = part.slice(2, -2);
      return <strong key={index}>{inner}</strong>;
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const inner = part.slice(1, -1);
      return <em key={index}>{inner}</em>;
    }

    return part;
  });
};

function MessageBubble({
  msg,
  isUser,
  isStreamingPlaceholder,
  statusText,
  copiedIndex,
  index,
  onCopy,
}: {
  msg: Message;
  isUser: boolean;
  isStreamingPlaceholder: boolean;
  statusText: string;
  copiedIndex: number | null;
  index: number;
  onCopy: (text: string, index: number) => void;
}) {
  return (
    <div className={`chat-bubble-enter mb-5 flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[11px] font-black text-accent">
          AI
        </div>
      )}

      <div className={`flex max-w-[85%] flex-col sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`relative ${
            isUser
              ? 'rounded-2xl rounded-br-md bg-accent px-4 py-3 text-accent-foreground shadow-lg shadow-black/20'
              : 'rounded-2xl rounded-bl-md border-[1.5px] border-border bg-[#1e1e1e]/90 px-4 py-3 text-foreground shadow-xl shadow-black/20'
          } ${isStreamingPlaceholder ? 'min-w-[160px]' : ''}`}
        >
          {isStreamingPlaceholder ? (
            <div className="flex items-center gap-2">
              <div className="flex h-5 items-center gap-1.5">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
              <span className="text-xs text-muted-foreground">{statusText}</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{renderEmphasis(msg.content)}</p>
          )}
        </div>

        {msg.content && !isStreamingPlaceholder && (
          <div className={`mt-1.5 flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] tabular-nums text-muted-foreground">{msg.timestamp}</span>
            <button
              type="button"
              onClick={() => onCopy(msg.content, index)}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Salin pesan"
              title="Salin pesan"
            >
              {copiedIndex === index ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedIndex === index ? 'Tersalin' : 'Salin'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatHomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusIndex, setStatusIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [lastFailedInput, setLastFailedInput] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [fetchingMessages, setFetchingMessages] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const statusTimer = useRef<any>(null);

  const { user, loading: userLoading } = useCurrentUser();

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowScrollButton(false);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      const data = await api.getSessions();
      const normalized = data.map((s) => ({
        ...s,
        title: s.title || 'New Chat',
      }));
      setSessions(normalized);
      if (normalized.length > 0 && !activeSessionId) {
        setActiveSessionId(normalized[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Gagal memuat daftar chat');
    } finally {
      setSessionsLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (activeSessionId === null) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setFetchingMessages(true);
    api.getSession(activeSessionId)
      .then((detail) => {
        if (cancelled) return;
        const msgs = detail.messages.map((m: ChatMessage) => ({
          role: m.role,
          content: m.content,
          timestamp: formatTime(m.createdAt),
        }));
        setMessages(msgs);
        requestAnimationFrame(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Gagal memuat pesan');
      })
      .finally(() => {
        if (!cancelled) setFetchingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const handleNewChat = async () => {
    try {
      const newSession = await api.createSession();
      const normalized: Session = { ...newSession, title: newSession.title || 'New Chat' };
      setSessions((prev) => [normalized, ...prev.filter((s) => s.id !== normalized.id)]);
      setActiveSessionId(normalized.id);
      setMessages([]);
      setError('');
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err: any) {
      setError(err.message || 'Gagal membuat chat baru');
    }
  };

  const handleSelectSession = (id: number) => {
    if (id === activeSessionId) return;
    setActiveSessionId(id);
    setError('');
  };

  const handleDeleteClick = (id: number) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (pendingDeleteId === null) return;

    try {
      await api.deleteSession(pendingDeleteId);
      setSessions((prev) => prev.filter((s) => s.id !== pendingDeleteId));

      if (activeSessionId === pendingDeleteId) {
        const remaining = sessions.filter((s) => s.id !== pendingDeleteId);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Gagal menghapus chat');
    } finally {
      setPendingDeleteId(null);
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading) return;

    let sessionId = activeSessionId;
    if (sessionId === null) {
      try {
        const newSession = await api.createSession();
        setSessions((prev) => [
          { ...newSession, title: newSession.title || 'New Chat' },
          ...prev.filter((s) => s.id !== newSession.id),
        ]);
        setActiveSessionId(newSession.id);
        sessionId = newSession.id;
      } catch (err: any) {
        setError(err.message || 'Gagal membuat sesi chat');
        return;
      }
    }

    const timestamp = formatTime();
    const userMessage: Message = { role: 'user', content: content.trim(), timestamp };
    const assistantPlaceholder: Message = { role: 'assistant', content: '', timestamp };

    const displayMessages = [...messages, userMessage, assistantPlaceholder];
    const apiMessages = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: content.trim() },
    ];

    setMessages(displayMessages);
    setLastFailedInput(content);
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
        body: JSON.stringify({ messages: apiMessages, model, sessionId }),
      });

      if (!response.ok || !response.body) {
        const errText = await response?.text().catch(() => '');
        throw new Error(errText || 'Gagal menghubungi server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;

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
            streamError = parsed?.message || 'Terjadi kesalahan dari server';
          } catch {
            streamError = 'Terjadi kesalahan dari server';
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

      if (streamError) {
        throw new Error(streamError);
      }

      await loadSessions();
    } catch (err: any) {
      setError(err?.message || 'Gagal kirim pesan');
      setMessages((prev) => {
        const updated = [...prev];
        if (
          updated.length > 0 &&
          updated[updated.length - 1].role === 'assistant' &&
          updated[updated.length - 1].content === ''
        ) {
          updated.pop();
        }
        return updated;
      });
    } finally {
      if (statusTimer.current) {
        clearInterval(statusTimer.current);
        statusTimer.current = null;
      }
      setLoading(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        autoResize();
      });
    }
  };

  const handleSend = () => {
    if (!input.trim() || loading) return;
    const content = input.trim();
    setInput('');
    sendMessage(content);
  };

  const handleRetry = () => {
    if (lastFailedInput) {
      sendMessage(lastFailedInput);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      setError('Gagal menyalin teks');
    }
  };

  const lastAssistantMsg = messages[messages.length - 1];
  const showStatus =
    loading &&
    lastAssistantMsg?.role === 'assistant' &&
    lastAssistantMsg.content === '' &&
    !hasStarted;

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="w-72 shrink-0 border-r-[1.5px] border-border bg-black/20 flex flex-col">
        <div className="p-4 border-b border-border">
          <button
            type="button"
            onClick={handleNewChat}
            className="btn btn-primary w-full"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          {sessionsLoading && (
            <div className="px-4 py-3 text-sm text-muted-foreground">Memuat...</div>
          )}

          {!sessionsLoading && sessions.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Belum ada chat
            </div>
          )}

          {!sessionsLoading &&
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group mb-1 flex items-center gap-1 rounded-lg border border-border px-2 py-2 ${
                  activeSessionId === session.id
                    ? 'bg-white/10'
                    : 'hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectSession(session.id)}
                  className="flex-1 min-w-0 text-left px-2 py-1 rounded-md"
                >
                  <div className="truncate text-sm font-medium text-white">
                    {session.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelative(session.lastMessageAt)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteClick(session.id)}
                  className="p-1 rounded text-muted-foreground hover:text-status-error opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Hapus chat"
                  title="Hapus chat"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(30,215,96,0.14),transparent_38%)]" />
        <div className="pointer-events-none absolute right-[-8%] top-[-10%] h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute left-[-5%] bottom-[-5%] h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

        <header className="relative z-10 flex items-center justify-between gap-2 border-b-[1.5px] border-border bg-black/20 px-4 py-3 backdrop-blur-xl">
          {user?.username === 'arzaka' && (
            <Link
              href="/jobs"
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground transition hover:bg-hover hover:text-foreground"
            >
              <Briefcase className="h-4 w-4" />
              <span className="hidden sm:inline">Jobs</span>
            </Link>
          )}

          <h1 className="flex-1 text-center text-sm font-semibold tracking-tight text-foreground">
            Chat
          </h1>

          <div className="flex items-center gap-2">
            <label className="hidden text-xs font-medium text-muted-foreground sm:inline">
              Model
            </label>
            <ModelSelector value={model} onChange={setModel} options={MODELS} />
          </div>
        </header>

        <main
          ref={messagesContainerRef}
          className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 py-5 sm:px-6"
          role="log"
          aria-live="polite"
        >
          {fetchingMessages && (
            <div className="mb-4 rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
              Memuat pesan...
            </div>
          )}

          {!fetchingMessages && messages.length === 0 && (
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

          {!fetchingMessages &&
            messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isStreamingPlaceholder =
                !isUser && i === messages.length - 1 && showStatus;

              return (
                <MessageBubble
                  key={i}
                  msg={msg}
                  isUser={isUser}
                  isStreamingPlaceholder={isStreamingPlaceholder}
                  statusText={STATUS_TEXTS[statusIndex]}
                  copiedIndex={copiedIndex}
                  index={i}
                  onCopy={handleCopy}
                />
              );
            })}

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-status-error/20 bg-status-error/5 px-4 py-3" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-error" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-status-error">{error}</p>
                {lastFailedInput && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-status-error hover:text-status-error/80"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Coba lagi
                  </button>
                )}
              </div>
            </div>
          )}

          {showScrollButton && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-24 right-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/80 text-muted-foreground shadow-lg shadow-black/40 transition hover:bg-black hover:text-foreground focus-ring"
              aria-label="Scroll ke bawah"
              title="Scroll ke bawah"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </main>

        <footer className="relative z-10 border-t-[1.5px] border-border bg-black/20 px-3 py-3 backdrop-blur-xl sm:px-6 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="field focus-ring max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-text-disabled focus:outline-none disabled:opacity-60"
              rows={1}
              placeholder="Tulis pesan..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
              disabled={loading || fetchingMessages}
              aria-label="Tulis pesan"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || !input.trim() || fetchingMessages}
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

        {pendingDeleteId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
            <div className="shadow-dialog w-full max-w-sm rounded-2xl border border-white/10 bg-[#1b1b1b] p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-danger/10">
                  <AlertTriangle className="h-6 w-6 text-status-error" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white">Hapus chat ini?</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Tindakan ini tidak bisa dibatalkan dari sini.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  className="btn btn-ghost flex-1"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="btn btn-primary flex-1"
                >
                  Hapus
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
