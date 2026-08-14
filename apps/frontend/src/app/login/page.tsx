'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/login', { username, password });
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="glass-card w-full max-w-md rounded-2xl p-6 shadow-2xl sm:p-8"
      >
        <div className="mb-6">
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-neutral-950">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v3m6.364-2.364l-2.121 2.121M21 12h-3m2.364 6.364l-2.121-2.121M12 21v-3m-6.364 2.364l2.121-2.121M3 12h3m-2.364-6.364l2.121 2.121"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">AI Trackster</h1>
          <p className="mt-1 text-sm text-neutral-400">Masuk buat lanjut</p>
        </div>

        <label className="mb-1 block text-sm font-medium text-neutral-300">
          Username
        </label>
        <input
          className="focus-ring mb-4 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-300">
          Password
        </label>
        <input
          type="password"
          className="focus-ring mb-4 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && (
          <p className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Masuk...' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
