const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
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
};

export { API_URL, ApiError };
