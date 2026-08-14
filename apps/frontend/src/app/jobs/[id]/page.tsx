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

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const { data: job, mutate } = useSWR(`/jobs/${id}`, fetcher, {
    refreshInterval: (data) => (data && ['RUNNING', 'QUEUED', 'DRAFTING_PLAN'].includes(data.status) ? 4000 : 0),
  });

  const [planDraft, setPlanDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (job?.plan) setPlanDraft(job.plan);
  }, [job?.plan]);

  if (!job) return <p className="text-neutral-400 text-sm">Memuat...</p>;

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
      <Link href="/" className="text-sm text-neutral-400">
        ← Kembali
      </Link>

      <div>
        <h1 className="text-lg font-bold">{job.idea}</h1>
        <p className="text-xs text-neutral-500 mt-1">
          Status: <span className="font-medium">{job.status}</span> · Repo: {job.targetRepo}
        </p>
      </div>

      {job.status === 'DRAFTING_PLAN' && (
        <p className="text-sm text-neutral-400">Lagi nyusun technical plan pakai Claude, tunggu sebentar...</p>
      )}

      {job.plan && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-400">Plan</h2>
          <textarea
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm min-h-64 font-mono"
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            disabled={job.status !== 'PLANNED'}
          />
          {job.status === 'PLANNED' && (
            <div className="flex gap-2">
              <button
                onClick={() => setPendingAction('save-plan')}
                disabled={saving}
                className="border border-neutral-700 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Simpan Edit
              </button>
              <button
                onClick={() => setPendingAction('approve')}
                disabled={saving}
                className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Approve & Jalankan
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {job.status === 'QUEUED' && <p className="text-sm text-blue-400">Nunggu worker pickup job ini...</p>}
      {job.status === 'RUNNING' && (
        <p className="text-sm text-blue-400">Lagi dikerjain di container, cek lagi beberapa saat...</p>
      )}

      {job.errorMessage && (
        <div className="bg-red-950 border border-red-900 rounded-lg p-3">
          <p className="text-sm text-red-400">{job.errorMessage}</p>
        </div>
      )}

      {job.branchName && (
        <div className="bg-emerald-950 border border-emerald-900 rounded-lg p-3">
          <p className="text-sm text-emerald-400">
            Selesai! Branch: <span className="font-mono">{job.branchName}</span>
          </p>
        </div>
      )}

      {job.logOutput && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-400">Log</h2>
          <pre className="bg-black border border-neutral-800 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {job.logOutput}
          </pre>
        </div>
      )}

      <button onClick={() => setPendingAction('delete')} className="text-xs text-red-500">
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
