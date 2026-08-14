'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { ArrowLeft, Loader2, Trash2, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
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

const STATUS_STYLES: Record<JobDetail['status'], { label: string; className: string; icon: typeof Clock }> = {
  DRAFTING_PLAN: { label: 'Nyusun plan...', className: 'bg-status-warning/10 text-status-warning border-status-warning/20', icon: Clock },
  PLANNED: { label: 'Plan siap', className: 'bg-status-info/10 text-status-info border-status-info/20', icon: CheckCircle2 },
  QUEUED: { label: 'Antri', className: 'bg-status-info/10 text-status-info border-status-info/20', icon: Clock },
  RUNNING: { label: 'Lagi dikerjain', className: 'bg-status-warning/10 text-status-warning border-status-warning/20', icon: Loader2 },
  DONE: { label: 'Selesai', className: 'bg-status-success/10 text-status-success border-status-success/20', icon: CheckCircle2 },
  FAILED: { label: 'Gagal', className: 'bg-status-error/10 text-status-error border-status-error/20', icon: AlertTriangle },
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
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-card border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Memuat...
        </div>
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

  const status = STATUS_STYLES[job.status];
  const StatusIcon = status.icon;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-6">
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-1 rounded-lg text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </Link>

        <div className="card-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground">{job.idea}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Repo: <span className="font-mono text-foreground">{job.targetRepo}</span>
              </p>
            </div>
            <span className={`badge ${status.className}`}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </span>
          </div>
        </div>

        {job.status === 'DRAFTING_PLAN' && (
          <div className="rounded-card border border-status-warning/20 bg-status-warning/5 p-4 text-sm text-status-warning">
            Lagi nyusun technical plan pakai Claude, tunggu sebentar...
          </div>
        )}

        {job.plan && (
          <div className="card-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Plan
            </h2>
            <textarea
              className="field focus-ring w-full min-h-64 rounded-xl px-3 py-2 font-mono text-sm leading-relaxed text-foreground disabled:opacity-60 focus:outline-none"
              value={planDraft}
              onChange={(e) => setPlanDraft(e.target.value)}
              disabled={job.status !== 'PLANNED'}
            />
            {job.status === 'PLANNED' && (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => setPendingAction('save-plan')}
                  disabled={saving}
                  className="btn btn-ghost"
                >
                  Simpan Edit
                </button>
                <button
                  onClick={() => setPendingAction('approve')}
                  disabled={saving}
                  className="btn btn-primary"
                >
                  Approve &amp; Jalankan
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-2 text-sm text-status-error">
            {error}
          </p>
        )}

        {job.status === 'QUEUED' && (
          <p className="rounded-card border border-status-info/20 bg-status-info/5 p-4 text-sm text-status-info">
            Nunggu worker pickup job ini...
          </p>
        )}

        {job.status === 'RUNNING' && (
          <p className="rounded-card border border-status-warning/20 bg-status-warning/5 p-4 text-sm text-status-warning">
            Lagi dikerjain di container, cek lagi beberapa saat...
          </p>
        )}

        {job.errorMessage && (
          <div className="rounded-card border border-status-error/20 bg-status-error/5 p-4">
            <p className="text-sm text-status-error">{job.errorMessage}</p>
          </div>
        )}

        {job.branchName && (
          <div className="rounded-card border border-status-success/20 bg-status-success/5 p-4">
            <p className="text-sm text-status-success">
              Selesai! Branch: <span className="font-mono">{job.branchName}</span>
            </p>
          </div>
        )}

        {job.logOutput && (
          <div className="card-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Log
            </h2>
            <pre className="max-h-96 overflow-y-auto rounded-xl bg-black p-4 text-xs leading-relaxed text-muted-foreground">
              {job.logOutput}
            </pre>
          </div>
        )}

        <button
          onClick={() => setPendingAction('delete')}
          className="inline-flex items-center gap-1 text-xs font-medium text-status-error transition hover:text-status-error/80"
        >
          <Trash2 className="h-3 w-3" />
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
    </div>
  );
}
