'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { api } from '@/lib/api';
import AgentSecretPrompt from '@/components/AgentSecretPrompt';

interface Job {
  id: number;
  idea: string;
  status: 'DRAFTING_PLAN' | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  branchName: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<Job['status'], string> = {
  DRAFTING_PLAN: 'Nyusun plan...',
  PLANNED: 'Plan siap, nunggu approve',
  QUEUED: 'Antri dieksekusi',
  RUNNING: 'Lagi dikerjain',
  DONE: 'Selesai',
  FAILED: 'Gagal',
};

const STATUS_COLOR: Record<Job['status'], string> = {
  DRAFTING_PLAN: 'text-neutral-400',
  PLANNED: 'text-amber-400',
  QUEUED: 'text-blue-400',
  RUNNING: 'text-blue-400',
  DONE: 'text-emerald-400',
  FAILED: 'text-red-400',
};

const fetcher = (path: string) => api.get<Job[]>(path);

export default function HomePage() {
  const { data: jobs, mutate } = useSWR('/jobs', fetcher, { refreshInterval: 5000 });
  const [idea, setIdea] = useState('');
  const [targetRepoKey, setTargetRepoKey] = useState<'trackster' | 'ai-trackster'>('trackster');
  const [submitting, setSubmitting] = useState(false);
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [error, setError] = useState('');

  const handleSubmitClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (idea.trim().length < 5) return;
    setShowSecretPrompt(true);
  };

  const handleConfirmSubmit = async (secret: string) => {
    setShowSecretPrompt(false);
    setSubmitting(true);
    setError('');
    try {
      await api.post('/jobs', { idea, targetRepoKey }, secret);
      setIdea('');
      mutate();
    } catch (err: any) {
      setError(err.message || 'Gagal submit ide');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI Trackster</h1>
          <p className="text-sm text-neutral-400">Ketik ide besar kamu, biar dikerjain semaleman.</p>
        </div>
        <Link href="/chat" className="text-sm border border-neutral-800 rounded-lg px-3 py-1.5 hover:border-neutral-700">
          💬 Chat
        </Link>
      </div>

      <form onSubmit={handleSubmitClick} className="space-y-2">
        <textarea
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm min-h-24"
          placeholder="Contoh: tambahin fitur export data transaksi ke CSV di halaman Laporan"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />

        <div className="space-y-1">
          <label className="text-xs text-neutral-400">Target repo</label>
          <select
            value={targetRepoKey}
            onChange={(e) => setTargetRepoKey(e.target.value as 'trackster' | 'ai-trackster')}
            className="bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-sm block"
          >
            <option value="trackster">Trackster</option>
            <option value="ai-trackster">AI Trackster (self-edit)</option>
          </select>
          {targetRepoKey === 'ai-trackster' && (
            <p className="text-xs text-amber-400">
              ⚠️ Self-edit: agent bakal ngedit source code alat ini sendiri. Review branch-nya
              ekstra hati-hati sebelum merge, terutama file terkait auth/deploy.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || idea.trim().length < 5}
          className="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {submitting ? 'Ngirim...' : 'Kirim Ide'}
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </form>

      {showSecretPrompt && (
        <AgentSecretPrompt
          title="Konfirmasi submit ide"
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowSecretPrompt(false)}
        />
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-400">Riwayat Job</h2>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">Belum ada job.</p>
        ) : (
          jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="block bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 hover:border-neutral-700"
            >
              <p className="text-sm line-clamp-1">{job.idea}</p>
              <p className={`text-xs mt-1 ${STATUS_COLOR[job.status]}`}>{STATUS_LABEL[job.status]}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
