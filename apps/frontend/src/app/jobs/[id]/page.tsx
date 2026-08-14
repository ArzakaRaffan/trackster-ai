'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { api } from '@/lib/api';
import AgentSecretPrompt from '@/components/AgentSecretPrompt';

interface JobDetail {
  id: number;
  idea: string;
  plan: string | null;
  status: 'DRAFTING_PLAN' | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  branchName: string | null;
  logOutput: string | null;
  errorMessage: string | null;
  targetRepo: string;
  createdAt: string;
}

type PendingAction = 'save-plan' | 'approve' | 'delete' | null;

const fetcher = (path: string) => api.get<JobDetail>(path);

const STATUS_STYLES: Record<JobDetail['status'], string> = {
  DRAFTING_PLAN: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  PLANNED: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  QUEUED: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
  RUNNING: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DONE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const { data: job, mutate } = useSWR(`/jobs/${id}`, fetcher, {
    refreshInterval: (data) =>
      data && ['RUNNING', 'QUEUED', 'DRAFTING_PLAN'].includes(data.status) ? 4000 : 0,
  });

  const [planDraft, setPlanDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (job?.plan) setPlanDraft(job.plan);
  }, [job?.plan]);

  if (!job) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center text-sm text-neutral-400">
        Memuat...
      </div>
    );
  }

  const runAction = async (secret: string) => {
    setError('');
    setSaving(true);
    try {
      if (pendingAction === 'save-plan') {
        await api.put(`/jobs/${id}/plan`, { plan: planDraft }, secret);
        mutate();
      } else if (pendingAction === 'approve') {
        await api.post(`/jobs/${id}/approve`, undefined, secret);
        mutate();
      } else if (pendingAction === 'delete') {
        await api.delete(`/jobs/${id}`, secret);
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'Aksi gagal');
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-1 rounded-lg text-sm text-neutral-400 transition hover:text-white"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Kembali
        </Link>

        <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white">{job.idea}</h1>
              <p className="mt-1 text-sm text-neutral-400">
                Repo: <span className="font-mono text-neutral-300">{job.targetRepo}</span>
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[job.status]}`}
            >
              {job.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {job.status === 'DRAFTING_PLAN' && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          Lagi nyusun technical plan pakai Claude, tunggu sebentar...
        </div>
      )}

      {job.plan && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Plan
          </h2>
          <textarea
            className="focus-ring w-full min-h-64 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm leading-relaxed text-neutral-100 disabled:opacity-60"
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            disabled={job.status !== 'PLANNED'}
          />
          {job.status === 'PLANNED' && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => setPendingAction('save-plan')}
                disabled={saving}
                className="focus-ring rounded-lg border border-neutral-700 bg-neutral-800/60 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Simpan Edit
              </button>
              <button
                onClick={() => setPendingAction('approve')}
                disabled={saving}
                className="focus-ring rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                Approve & Jalankan
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {job.status === 'QUEUED' && (
        <p className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-300">
          Nunggu worker pickup job ini...
        </p>
      )}

      {job.status === 'RUNNING' && (
        <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
          Lagi dikerjain di container, cek lagi beberapa saat...
        </p>
      )}

      {job.errorMessage && (
        <div className="rounded-2xl border border-red-900 bg-red-950/30 p-4">
          <p className="text-sm text-red-400">{job.errorMessage}</p>
        </div>
      )}

      {job.branchName && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-300">
            Selesai! Branch: <span className="font-mono">{job.branchName}</span>
          </p>
        </div>
      )}

      {job.logOutput && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Log
          </h2>
          <pre className="max-h-96 overflow-y-auto rounded-xl bg-black p-4 text-xs leading-relaxed text-neutral-300">
            {job.logOutput}
          </pre>
        </div>
      )}

      <button
        onClick={() => setPendingAction('delete')}
        className="focus-ring text-xs font-medium text-red-400 transition hover:text-red-300"
      >
        Hapus job
      </button>

      {pendingAction && (
        <AgentSecretPrompt
          title={
            pendingAction === 'approve'
              ? 'Konfirmasi jalankan agent'
              : pendingAction === 'delete'
                ? 'Konfirmasi hapus job'
                : 'Konfirmasi simpan plan'
          }
          onConfirm={runAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
