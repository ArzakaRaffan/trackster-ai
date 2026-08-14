'use client';

import { useState } from 'react';

interface Props {
  title: string;
  onConfirm: (secret: string) => void;
  onCancel: () => void;
}

export default function AgentSecretPrompt({ title, onConfirm, onCancel }: Props) {
  const [secret, setSecret] = useState('');

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    onConfirm(secret);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-4 z-50">
      <form
        onSubmit={handleConfirm}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-xl p-5"
      >
        <h2 className="text-sm font-bold mb-1">{title}</h2>
        <p className="text-xs text-neutral-400 mb-4">
          Aksi ini bisa bikin agent beneran ngedit kode. Masukin password agent buat lanjut.
        </p>
        <input
          type="password"
          autoFocus
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm mb-4"
          placeholder="Password agent"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-neutral-700 rounded-lg py-2 text-sm"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!secret}
            className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Lanjut
          </button>
        </div>
      </form>
    </div>
  );
}
