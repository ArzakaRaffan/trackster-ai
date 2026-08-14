'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Rocket,
  XCircle,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import AgentSecretPrompt from '@/components/AgentSecretPrompt';

interface Job {
  id: number;
  idea: string;
  status: 'DRAFTING_PLAN' | 'PLANNED' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  mode: 'MANUAL' | 'AUTO';
  branchName: string | null;
  merged: boolean;
  createdAt: string;
  plannerCostUsd: number | null;
  executionCostUsd: number | null;
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

function formatCost(value: number | null | undefined): string {
  if (value == null) return '';
  return `$${value.toFixed(4)}`;
}

function getJobCostText(job: Job): string | null {
  if (job.plannerCostUsd == null && job.executionCostUsd == null) return null;
  const total = (job.plannerCostUsd ?? 0) + (job.executionCostUsd ?? 0);
  return formatCost(total);
}

function JobSkeleton() {
  return (
    <div className="card-surface p-5">
      <div className="shimmer h-4 w-3/4 rounded" />
      <div className="mt-3 shimmer h-3 w-1/2 rounded" />
    </div>
  );
}

function ActiveJobCard({ job }: { job: Job }) {
  const status = STATUS_CONFIG[job.status];
  const StatusIcon = status.icon;
  const costText = job.status === 'DONE' || job.status === 'FAILED' ? getJobCostText(job) : null;

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-primary/20 bg-card p-6 shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-hover"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(30,215,96,0.18),transparent_45%)]" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 text-xl font-bold leading-snug tracking-tight text-white">
            {job.idea}
          </p>
          <span className={`badge shrink-0 ${status.className}`}>
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 text-xs">
          <span className="text-muted-foreground">
            Dibuat {new Date(job.createdAt).toLocaleDateString('id-ID')}
          </span>
          {costText && (
            <span className="font-semibold text-accent">{costText}</span>
          )}
          <span className="inline-flex items-center gap-1 font-semibold text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Lihat detail
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function HistoryJobRow({ job }: { job: Job }) {
  const status = STATUS_CONFIG[job.status];
  const StatusIcon = status.icon;
  const costText = getJobCostText(job);

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card/70 px-4 py-3 transition duration-200 hover:bg-hover"
    >
      <span className={`badge shrink-0 ${status.className}`}>
        <StatusIcon className="h-3 w-3" />
        {status.label}
      </span>
      {job.mode === 'AUTO' && (
        <span className="badge shrink-0 border border-accent/20 bg-accent/10 text-accent">
          <Zap className="h-3 w-3" />
          {job.merged ? 'Auto-merged' : 'Auto'}
        </span>
      )}
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
        {job.idea}
      </p>
      {costText && (
        <span className="shrink-0 text-xs font-semibold text-accent">{costText}</span>
      )}
      <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {new Date(job.createdAt).toLocaleDateString('id-ID')}
      </time>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-text-disabled transition-colors group-hover:text-accent" />
    </Link>
  );
}

export default function JobsDashboardPage() {
  const { data: jobs, error, isLoading, mutate } = useSWR('/jobs', fetcher, {
    refreshInterval: 5000,
  });

  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();

  const [idea, setIdea] = useState('');
  const [targetRepoKey, setTargetRepoKey] = useState<'trackster' | 'ai-trackster'>('trackster');
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [submitting, setSubmitting] = useState(false);
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.username !== 'arzaka') {
      router.replace('/');
    }
  }, [user, userLoading, router]);

  if (userLoading || !user || user.username !== 'arzaka') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Memuat...
      </div>
    );
  }

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
      await api.post('/jobs', { idea, targetRepoKey, mode }, secret);
      setIdea('');
      mutate();
    } catch (err: any) {
      setFormError(err.message || 'Gagal submit ide');
    } finally {
      setSubmitting(false);
    }
  };

  const jobList = jobs ?? [];
  const activeJobs = jobList.filter((job) =>
    ['DRAFTING_PLAN', 'PLANNED', 'QUEUED', 'RUNNING'].includes(job.status),
  );
  const pastJobs = jobList.filter((job) => ['DONE', 'FAILED'].includes(job.status));

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-6 sm:px-6 sm:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(30,215,96,0.14),transparent_38%)]" />
      <div className="pointer-events-none absolute right-[-8%] top-[-12%] h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute left-[-5%] top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 mx-auto w-full max-w-6xl space-y-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <span className="badge mb-3 border border-primary/20 bg-primary/10 text-accent">
              AI Workspace
            </span>
            <h1 className="text-4xl font-extrabold leading-none tracking-tight text-white sm:text-5xl">
              AI Trackster
            </h1>
            <p className="mt-3 max-w-xl text-base text-muted-foreground">
              Ketik ide besar kamu, biar dikerjain semaleman.
            </p>
          </div>
          <Link href="/" className="btn btn-ghost group">
            <MessageCircle className="h-4 w-4 transition-transform group-hover:scale-110" />
            Chat
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <form onSubmit={handleSubmitClick} className="gradient-card card-surface p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-accent">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Submit ide baru</h2>
                <p className="text-xs text-muted-foreground">Biar agent nyusun plan-nya dulu.</p>
              </div>
            </div>

            <textarea
              className="field focus-ring w-full min-h-28 resize-none rounded-xl px-4 py-3 text-sm leading-relaxed text-white placeholder:text-text-disabled focus:outline-none"
              placeholder="Contoh: tambahin fitur export data transaksi ke CSV di halaman Laporan"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />

            <div className="mt-4 space-y-1.5">
              <label className="text-label text-muted-foreground">Target repo</label>
              <select
                value={targetRepoKey}
                onChange={(e) => setTargetRepoKey(e.target.value as 'trackster' | 'ai-trackster')}
                className="field focus-ring block w-full rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="trackster">Trackster</option>
                <option value="ai-trackster">AI Trackster (self-edit)</option>
              </select>
              {targetRepoKey === 'ai-trackster' && (
                <p className="text-xs leading-relaxed text-status-warning">
                  ⚠️ Self-edit: agent bakal ngedit source code alat ini sendiri. Review branch-nya
                  ekstra hati-hati sebelum merge.
                </p>
              )}
            </div>

            <div className="mt-4 space-y-1.5">
              <label className="text-label text-muted-foreground">Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                    mode === 'manual'
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-card text-muted-foreground hover:bg-hover'
                  }`}
                >
                  Manual
                  <p className="mt-0.5 text-xs font-normal opacity-80">
                    Approve plan &amp; merge branch sendiri
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                    mode === 'auto'
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-card text-muted-foreground hover:bg-hover'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    Auto
                  </span>
                  <p className="mt-0.5 text-xs font-normal opacity-80">
                    Auto-approve, auto-merge kalau lolos review Claude
                  </p>
                </button>
              </div>
              {mode === 'auto' && (
                <p className="text-xs leading-relaxed text-status-warning">
                  ⚠️ Auto mode: TIDAK ADA approval/review manual dari kamu sama sekali. Claude
                  review diff sebelum merge, dan file sensitif (auth/deploy/CI) selalu fallback ke
                  manual apapun hasil review-nya — tapi tetap ada resiko sesuatu lolos yang harusnya
                  ketauan manusia.
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={submitting || idea.trim().length < 5}
                className="btn btn-primary min-w-[150px]"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {submitting ? 'Ngirim...' : 'Kirim Ide'}
              </button>
              {formError && (
                <span className="text-xs font-medium text-status-error">{formError}</span>
              )}
            </div>
          </form>

          <div className="card-surface border border-border/60 bg-card/70 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Sedang berjalan</h2>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {activeJobs.length} job aktif
              </span>
            </div>

            {isLoading && (
              <div className="space-y-3">
                <JobSkeleton />
                <JobSkeleton />
              </div>
            )}

            {!isLoading && error && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-status-error/20 bg-status-error/5 px-6 py-8 text-center">
                <AlertTriangle className="h-8 w-8 text-status-error" />
                <p className="text-sm text-status-error">Gagal memuat daftar job.</p>
                <button type="button" onClick={() => mutate()} className="btn btn-ghost">
                  <RefreshCw className="h-4 w-4" />
                  Coba lagi
                </button>
              </div>
            )}

            {!isLoading && !error && activeJobs.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
                <Inbox className="h-8 w-8 text-text-disabled" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Tidak ada job aktif saat ini.
                </p>
              </div>
            )}

            {!isLoading && !error && activeJobs.length > 0 && (
              <div className="space-y-4">
                {activeJobs.map((job) => (
                  <ActiveJobCard key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Riwayat job</h2>
            <span className="text-xs text-muted-foreground">
              Selesai &amp; gagal
            </span>
          </div>

          {isLoading && (
            <div className="space-y-3">
              <JobSkeleton />
              <JobSkeleton />
            </div>
          )}

          {!isLoading && !error && pastJobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center">
              <Inbox className="h-8 w-8 text-text-disabled" />
              <p className="text-sm text-muted-foreground">Belum ada job selesai.</p>
            </div>
          )}

          {!isLoading && !error && pastJobs.length > 0 && (
            <div className="space-y-2.5">
              {pastJobs.map((job) => (
                <HistoryJobRow key={job.id} job={job} />
              ))}
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
