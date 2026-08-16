const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message || `Request gagal (${res.status})`, res.status);
  }
  return res.json();
}

// agentSecret opsional -- dikirim sebagai header x-agent-secret, dipakai khusus buat
// endpoint yang bisa trigger agent beneran ngedit kode (create/approve/edit-plan/delete job)
export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, agentSecret?: string) =>
    request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: agentSecret ? { 'x-agent-secret': agentSecret } : undefined,
    }),
  put: <T>(path: string, body?: unknown, agentSecret?: string) =>
    request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers: agentSecret ? { 'x-agent-secret': agentSecret } : undefined,
    }),
  delete: <T>(path: string, agentSecret?: string) =>
    request<T>(path, {
      method: 'DELETE',
      headers: agentSecret ? { 'x-agent-secret': agentSecret } : undefined,
    }),
  // Chat session endpoints
  getSessions: () =>
    request<ChatSession[]>('/chat-sessions'),
  getSession: (id: number) =>
    request<ChatSessionDetail>(`/chat-sessions/${id}`),
  createSession: (title?: string) =>
    request<ChatSession>('/chat-sessions', {
      method: 'POST',
      body: title ? JSON.stringify({ title }) : undefined,
    }),
  deleteSession: (id: number) =>
    request<{ success: boolean }>(`/chat-sessions/${id}`, { method: 'DELETE' }),
  getMe: () =>
    request<{ user: { id: number; username: string } }>('/auth/me'),
};

export { API_URL, ApiError };

export interface ChatSession {
  id: number;
  title: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatSessionDetail extends ChatSession {
  messages: ChatMessage[];
}
