'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldAlert } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <form
        onSubmit={handleConfirm}
        className="shadow-dialog w-full max-w-sm rounded-2xl border border-white/10 bg-[#1b1b1b] p-6"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <ShieldAlert className="h-6 w-6 text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Aksi ini bisa bikin agent beneran ngedit kode. Masukin password agent buat lanjut.
            </p>
          </div>
        </div>

        <input
          type="password"
          autoFocus
          className="field focus-ring mt-5 w-full rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-text-disabled focus:outline-none"
          placeholder="Password agent"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost flex-1"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!secret}
            className="btn btn-primary flex-1"
          >
            Lanjut
          </button>
        </div>
      </form>
    </div>
  );
}
