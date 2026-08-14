'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import AgentSecretPrompt from '@/components/AgentSecretPrompt';

interface Job {
  id: number;
  idea: string;
  status: 'DRAFTING_PLAN' | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  branchName: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<
  Job['status'],
  { label: string; icon: typeof Clock; className: string }
> = {
  DRAFTING_PLAN: {
    label: 'Nyusun plan...',
    icon: Clock,
    className: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  },
  PLANNED: {
    label: 'Plan siap, nunggu approve',
    icon: Rocket,
    className: 'bg-status-info/10 text-status-info border-status-info/20',
  },
  QUEUED: {
    label: 'Antri dieksekusi',
    icon: Clock,
    className: 'bg-status-info/10 text-status-info border-status-info/20',
  },
  RUNNING: {
    label: 'Lagi dikerjain',
    icon: Loader2,
    className: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  },
  DONE: {
    label: 'Selesai',
    icon: CheckCircle2,
    className: 'bg-status-success/10 text-status-success border-status-success/20',
  },
  FAILED: {
    label: 'Gagal',
    icon: XCircle,
    className: 'bg-status-error/10 text-status-error border-status-error/20',
  },
};

const fetcher = (path: string) => api.get<Job[]>(path);

function JobSkeleton() {
  return (
    <div className="card-surface p-5">
      <div className="shimmer h-4 w-3/4 rounded" />
      <div className="mt-3 shimmer h-3 w-1/2 rounded" />
    </div>
  );
}

export default function HomePage() {
  const {
    data: jobs,
    error,
    isLoading,
    mutate,
  } = useSWR('/jobs', fetcher, { refreshInterval: 5000 });

  const [idea, setIdea] = useState('');
  const [targetRepoKey, setTargetRepoKey] = useState<'trackster' | 'ai-trackster'>('trackster');
  const [submitting, setSubmitting] = useState(false);
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmitClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (idea.trim().length < 5) return;
    setShowSecretPrompt(true);
  };

  const handleConfirmSubmit = async (secret: string) => {
    setShowSecretPrompt(false);
    setSubmitting(true);
    setFormError('');
    try {
      await api.post('/jobs', { idea, targetRepoKey }, secret);
      setIdea('');
      mutate();
    } catch (err: any) {
      setFormError(err.message || 'Gagal submit ide');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-title font-bold text-white">AI Trackster</h1>
            <p className="mt-1 text-caption text-muted-foreground">
              Ketik ide besar kamu, biar dikerjain semaleman.
            </p>
          </div>
          <Link
            href="/chat"
            className="btn btn-ghost"
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </Link>
        </header>

        <form onSubmit={handleSubmitClick} className="card-surface p-5">
          <textarea
            className="field focus-ring w-full min-h-24 resize-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-disabled focus:outline-none"
            placeholder="Contoh: tambahin fitur export data transaksi ke CSV di halaman Laporan"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
          />

          <div className="mt-4 space-y-1">
            <label className="text-label text-muted-foreground">Target repo</label>
            <select
              value={targetRepoKey}
              onChange={(e) => setTargetRepoKey(e.target.value as 'trackster' | 'ai-trackster')}
              className="field focus-ring block w-full rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="trackster">Trackster</option>
              <option value="ai-trackster">AI Trackster (self-edit)</option>
            </select>
            {targetRepoKey === 'ai-trackster' && (
              <p className="text-xs text-status-warning">
                ⚠️ Self-edit: agent bakal ngedit source code alat ini sendiri. Review branch-nya
                ekstra hati-hati sebelum merge.
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || idea.trim().length < 5}
              className="btn btn-primary"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {submitting ? 'Ngirim...' : 'Kirim Ide'}
            </button>
            {formError && (
              <span className="text-xs text-status-error">{formError}</span>
            )}
          </div>
        </form>

        <section>
          <h2 className="text-section-heading font-semibold text-white">Riwayat Job</h2>

          {isLoading && (
            <div className="mt-4 space-y-3">
              <JobSkeleton />
              <JobSkeleton />
              <JobSkeleton />
            </div>
          )}

          {!isLoading && error && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-card border border-status-error/20 bg-status-error/5 px-6 py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-status-error" />
              <p className="text-sm text-status-error">Gagal memuat daftar job.</p>
              <button type="button" onClick={() => mutate()} className="btn btn-ghost">
                <RefreshCw className="h-4 w-4" />
                Coba lagi
              </button>
            </div>
          )}

          {!isLoading && !error && jobs && jobs.length === 0 && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-card border border-border bg-card px-6 py-10 text-center">
              <Inbox className="h-8 w-8 text-text-disabled" />
              <p className="text-sm text-muted-foreground">Belum ada job.</p>
            </div>
          )}

          {!isLoading && !error && jobs && jobs.length > 0 && (
            <div className="mt-4 space-y-3">
              {jobs.map((job) => {
                const status = STATUS_CONFIG[job.status];
                const StatusIcon = status.icon;
                return (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="card-surface block p-5 transition-colors duration-200 hover:bg-hover"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-body font-semibold text-white">{job.idea}</p>
                        <p className="mt-1 text-caption text-muted-foreground">
                          Dibuat {new Date(job.createdAt).toLocaleDateString('id-ID')}
                        </p>
                      </div>
                      <span className={`badge ${status.className}`}>
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {showSecretPrompt && (
        <AgentSecretPrompt
          title="Konfirmasi submit ide"
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowSecretPrompt(false)}
        />
      )}
    </div>
  );
}

function MessageCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}
