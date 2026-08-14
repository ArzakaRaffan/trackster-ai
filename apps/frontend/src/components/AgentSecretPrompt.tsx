'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

interface Props {
  title: string;
  onConfirm: (secret: string) => void;
  onCancel: () => void;
}

export default function AgentSecretPrompt({ title, onConfirm, onCancel }: Props) {
  const [secret, setSecret] = useState('');

  const handleConfirm = (e: FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    onConfirm(secret);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form
        onSubmit={handleConfirm}
        className="glass-card w-full max-w-sm rounded-2xl p-6 shadow-2xl"
      >
        <h2 className="text-base font-bold text-white">{title}</h2>
        <p className="mt-2 text-sm text-neutral-400">
          Aksi ini bisa bikin agent beneran ngedit kode. Masukin password agent buat lanjut.
        </p>

        <input
          type="password"
          autoFocus
          className="focus-ring mt-4 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          placeholder="Password agent"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring flex-1 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!secret}
            className="focus-ring flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Lanjut
          </button>
        </div>
      </form>
    </div>
  );
}
