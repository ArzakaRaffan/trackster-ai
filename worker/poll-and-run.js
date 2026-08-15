/**
 * Worker script — jalan LANGSUNG di VPS host (via systemd), BUKAN di dalam container.
 * Ini sengaja: biar web app (yang exposed ke internet) nggak pernah pegang akses Docker socket.
 *
 * Alur:
 * 1. Polling database tiap beberapa detik, cari Job dengan status QUEUED
 * 2. Set status RUNNING, generate nama branch unik
 * 3. `docker run` container agent-runner (terisolasi network, resource-limited)
 * 4. Tunggu selesai, capture stdout/stderr
 * 5. Update Job jadi DONE (dengan branchName) atau FAILED (dengan errorMessage)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const prisma = new PrismaClient();

const POLL_INTERVAL_MS = 15_000;
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'ai-trackster-agent-runner:latest';
const AGENT_MEMORY_LIMIT = process.env.AGENT_MEMORY_LIMIT || '768m';
const AGENT_NETWORK = process.env.AGENT_NETWORK || 'ai-trackster-agent-net';
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '', 10) || 2 * 60 * 60 * 1000; // default 2 jam

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// --- Reconciliation: worker restart (misal ke-trigger CD sewaktu deploy push ke main)
// bisa motong proses PAS lagi nunggu container job selesai. Container-nya sendiri jalan
// independen dan biasanya tetap selesai & push branch-nya, tapi row Job di DB nyangkut
// RUNNING selamanya karena proses yang harusnya update DB udah mati duluan. Reconcile
// pas worker start: cek tiap job RUNNING, verifikasi ke remote apa branch-nya beneran
// udah ke-push -- kalau ada berarti sebenernya sukses (DONE), kalau nggak ada berarti
// beneran keputus di tengah jalan (FAILED, biar jelas alih-alih nyangkut diam-diam).
function branchExistsOnRemote(targetRepo, branchName, sshKeyContent) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trackster-reconcile-'));
    const keyPath = path.join(tmpDir, 'deploy_key');
    fs.writeFileSync(keyPath, (sshKeyContent || '').trimEnd() + '\n', { mode: 0o600 });

    const child = spawn(
      'git',
      ['ls-remote', '--exit-code', '--heads', targetRepo, `refs/heads/${branchName}`],
      {
        env: {
          ...process.env,
          GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
        },
      },
    );
    child.on('close', (code) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      resolve(code === 0);
    });
    child.on('error', () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      resolve(false);
    });
  });
}

async function reconcileOrphanedJobs() {
  const orphaned = await prisma.job.findMany({ where: { status: 'RUNNING' } });
  if (orphaned.length === 0) return;

  log(`Ketemu ${orphaned.length} job nyangkut RUNNING dari sebelum restart, reconcile dulu...`);

  for (const job of orphaned) {
    const branchName = buildBranchName(job);
    const isSelfEdit = process.env.SELF_REPO_URL && job.targetRepo === process.env.SELF_REPO_URL;
    const sshKeyContent = isSelfEdit ? process.env.GIT_SSH_KEY_SELF : process.env.GIT_SSH_KEY;

    const exists = await branchExistsOnRemote(job.targetRepo, branchName, sshKeyContent);

    if (exists) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'DONE', branchName, completedAt: new Date() },
      });
      log(`Job ${job.id}: branch ${branchName} ternyata udah ke-push, reconcile jadi DONE.`);
    } else {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Worker restart di tengah proses (kemungkinan ke-trigger CD deploy), job terputus sebelum sempat push branch.',
          completedAt: new Date(),
        },
      });
      log(`Job ${job.id}: branch ${branchName} nggak ketemu, reconcile jadi FAILED.`);
    }
  }
}

async function pickupNextJob() {
  // Pakai updateMany dengan kondisi status QUEUED sebagai "atomic claim" sederhana,
  // biar kalau ada >1 worker instance nggak keduanya ngerjain job yang sama.
  const queued = await prisma.job.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
  if (!queued) return null;

  const claimed = await prisma.job.updateMany({
    where: { id: queued.id, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  if (claimed.count === 0) return null; // keambil worker lain duluan
  return queued;
}

// Slug dari Claude (planner) dipakai buat nama branch yang deskriptif kalau ada,
// fallback ke "job-<id>" polos kalau slug-nya kosong/gagal ke-generate. Suffix id tetap
// disertakan biar unik walau ada 2 job dengan slug yang mirip.
function buildBranchName(job) {
  return job.branchSlug ? `ai-agent/${job.branchSlug}-${job.id}` : `ai-agent/job-${job.id}`;
}

function extractExecutionCostUsd(output) {
  if (!output) return null;

  const patterns = [
    /cost:\s*\$?([0-9]+(?:\.[0-9]+)?)/i,
    /total cost:\s*\$?([0-9]+(?:\.[0-9]+)?)/i,
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:total)?\s*cost/i,
    /tokens:\s*\d+\s*\([^)]*\).*?cost:\s*\$?([0-9]+(?:\.[0-9]+)?)/i,
    /\bcost\b[^\$]*\$([0-9]+(?:\.[0-9]+)?)/i,
  ];

  for (const re of patterns) {
    const match = output.match(re);
    if (match) {
      const cost = parseFloat(match[1]);
      if (!Number.isNaN(cost)) return cost;
    }
  }

  // Line-level fallback: find a line containing cost/pricing and a dollar amount.
  const lines = output.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('cost') || lower.includes('pricing')) {
      const dollarMatch = line.match(/\$([0-9]+(?:\.[0-9]+)?)/);
      if (dollarMatch) {
        const cost = parseFloat(dollarMatch[1]);
        if (!Number.isNaN(cost)) return cost;
      }
    }
  }

  return null;
}

function runAgentContainer(job, branchName, promptFilePath, envFilePath, sshKeyFilePath) {
  return new Promise((resolve, reject) => {
    const containerName = `ai-agent-job-${job.id}-${Date.now()}`;

    const args = [
      'run',
      '--rm',
      '--name', containerName,
      '--network', AGENT_NETWORK,
      '--memory', AGENT_MEMORY_LIMIT,
      '--env-file', envFilePath,
      '-e', `TARGET_REPO=${job.targetRepo}`,
      '-e', `BRANCH_NAME=${branchName}`,
      '-v', `${promptFilePath}:/tmp/prompt.txt:ro`,
      '-v', `${sshKeyFilePath}:/tmp/deploy_key:ro`,
      AGENT_IMAGE,
    ];

    log(`Menjalankan container: docker ${args.join(' ')}`);

    const child = spawn('docker', args);
    let output = '';
    let interval = null;

    // Start near-live log updates while container is still running.
    interval = setInterval(() => {
      if (!output) return;
      const current = output.slice(-50000);
      if (current) {
        prisma.job.update({
          where: { id: job.id },
          data: { logOutput: current },
        }).catch((err) => {
          log(`Job ${job.id}: gagal update logOutput periodik: ${err.message}`);
        });
      }
    }, 5000);

    const timeout = setTimeout(() => {
      log(`Job ${job.id} timeout setelah ${AGENT_TIMEOUT_MS}ms, kill container`);
      spawn('docker', ['kill', containerName]);
    }, AGENT_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      resolve({ exitCode: code, output });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      reject(err);
    });
  });
}

// --- Mode AUTO: setelah job selesai, review diff-nya pakai Claude (API yang sama dengan
// planner, mwapi.dev) SEBELUM auto-merge ke main. Baca diff jauh lebih murah tokennya
// dibanding generate, tapi ini TETAP bukan pengganti review manusia sepenuhnya -- makanya
// ada guardrail keras file sensitif yang nggak bisa di-override sama verdict Claude.
const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)entrypoint\.sh$/,
  /(^|\/)auth\.guard\.ts$/,
  /(^|\/)agent-secret\.guard\.ts$/,
  /docker-compose.*\.ya?ml$/,
  /^\.github\/workflows\//,
  /\.env(\..*)?$/,
  // worker/poll-and-run.js sendiri -- kalau job auto-edit file INI, dia bisa mengubah
  // logic auto-merge-nya sendiri tanpa ada yang ngecek. Selalu wajib manual.
  /(^|\/)poll-and-run\.js$/,
];

function matchesSensitivePattern(filePath) {
  return SENSITIVE_FILE_PATTERNS.some((re) => re.test(filePath));
}

function gitRun(cwd, env, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `git ${args.join(' ')} exit ${code}`));
    });
  });
}

// --- Safety net: setelah auto-merge, health check endpoint web app, kalau gagal
// lakukan revert dan update reviewReasoning. ---
async function checkEndpointHealth(url, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    // >=500 doang yang dianggap "server rusak". Endpoint kayak /auth/me atau /jobs
    // butuh login (AuthGuard) -- tanpa cookie session, response NORMAL-nya 401, itu
    // BUKTI server jalan benar (nolak request tanpa auth), bukan tanda server down.
    // Kalau syaratnya res.ok (200-299), 401 keanggep "gagal" dan auto-revert kepicu
    // di SETIAP auto-merge yang sukses sekalipun -- persis kebalikan dari tujuan check ini.
    if (res.status < 500) return { ok: true };
    return { ok: false, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

async function appendReviewReasoning(jobId, newText) {
  const fresh = await prisma.job.findUnique({ where: { id: jobId } });
  const existing = fresh?.reviewReasoning || '';
  const timestamp = new Date().toISOString();
  const updated = `${existing}${existing ? '\n' : ''}[${timestamp}] ${newText}`;
  await prisma.job.update({
    where: { id: jobId },
    data: { reviewReasoning: updated },
  });
}

async function runPostMergeHealthCheck(jobId) {
  // Worker jalan di HOST VPS, bukan di dalam container -- backend/frontend AI Trackster
  // cuma "expose" port ke container lain di shared-web-net (bukan "ports" ke host), jadi
  // 127.0.0.1:4100/3100 dari host itu connection refused SELALU. Cek lewat domain publik
  // (via nginx) yang beneran reachable dari mana saja, sama seperti user asli akses.
  const baseUrlBackend = process.env.BACKEND_HEALTH_URL || process.env.BACKEND_URL || 'https://api.ai.trackster.my.id';
  const baseUrlFrontend = process.env.FRONTEND_HEALTH_URL || process.env.FRONTEND_URL || 'https://ai.trackster.my.id';
  const endpoints = [
    { name: 'backend /auth/me', url: `${baseUrlBackend}/auth/me` },
    { name: 'backend /jobs', url: `${baseUrlBackend}/jobs` },
    { name: 'frontend /', url: `${baseUrlFrontend}/` },
    { name: 'frontend /jobs', url: `${baseUrlFrontend}/jobs` },
  ];

  const timeoutMs = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '7000', 10);
  const retries = parseInt(process.env.HEALTH_CHECK_RETRIES || '3', 10);
  const backoffMs = parseInt(process.env.HEALTH_CHECK_BACKOFF_MS || '2000', 10);
  let lastFailureSummary = '';

  for (let attempt = 1; attempt <= retries; attempt++) {
    const failures = [];
    for (const ep of endpoints) {
      const result = await checkEndpointHealth(ep.url, timeoutMs);
      if (!result.ok) {
        failures.push(`${ep.name} (${result.status || result.error || 'unknown'})`);
      }
    }

    if (failures.length === 0) {
      return { success: true };
    }

    lastFailureSummary = failures.join('; ');
    log(`Job ${jobId}: health check attempt ${attempt}/${retries} gagal: ${lastFailureSummary}`);

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }

  return { success: false, failureSummary: lastFailureSummary };
}

async function cloneForReview(targetRepo, branchName, sshKeyContent) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trackster-review-'));
  const keyPath = path.join(tmpDir, 'deploy_key');
  fs.writeFileSync(keyPath, (sshKeyContent || '').trimEnd() + '\n', { mode: 0o600 });
  const gitEnv = {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
  };
  const cloneDir = path.join(tmpDir, 'repo');

  await new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--quiet', targetRepo, cloneDir], { env: gitEnv });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git clone exit ${code}`))));
  });

  await gitRun(cloneDir, gitEnv, ['fetch', '--quiet', 'origin', branchName]);
  const changedFilesRaw = await gitRun(cloneDir, gitEnv, ['diff', '--name-only', `origin/main...origin/${branchName}`]);
  const diff = await gitRun(cloneDir, gitEnv, ['diff', `origin/main...origin/${branchName}`]);
  const changedFiles = changedFilesRaw.split('\n').map((l) => l.trim()).filter(Boolean);

  return { tmpDir, cloneDir, gitEnv, diff, changedFiles };
}

// mwapi.dev kadang balikin 429 "Upstream rate limit exceeded" -- limit di koneksi
// mwapi.dev sendiri ke Anthropic (bukan limit akun kita), transient, worth di-retry
// otomatis. Sama seperti PlannerService.fetchWithRetry di backend, dua-duanya pakai
// upstream yang sama jadi dua-duanya bisa kena.
async function fetchWithRetry(url, init, maxRetries = 3) {
  let lastRes;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;

    lastRes = res;
    if (attempt === maxRetries) break;

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const delayMs = !isNaN(retryAfterSec) ? retryAfterSec * 1000 : 2000 * 2 ** attempt;

    log(`Planner API 429 (attempt ${attempt + 1}/${maxRetries + 1}), retry dalam ${delayMs}ms...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return lastRes;
}

async function reviewDiffWithClaude(idea, diff) {
  const baseUrl = process.env.PLANNER_API_BASE_URL || 'https://api.anthropic.com';
  const apiKey = process.env.PLANNER_API_KEY;
  const model = process.env.PLANNER_MODEL || 'claude-sonnet-5';
  if (!apiKey) throw new Error('PLANNER_API_KEY belum di-set di worker/.env, auto-review nggak bisa jalan');

  const systemPrompt = `Kamu reviewer keamanan kode, mereview diff yang dibikin AI coding agent SEBELUM di-auto-merge ke branch main TANPA review manusia.

JANGAN PERNAH memanggil/menggunakan tool atau function apapun. Kamu TIDAK PUNYA akses baca file lain di luar diff yang dikasih -- cukup nilai dari diff itu sendiri.

Tugas kamu: nilai apakah diff ini AMAN buat di-merge otomatis. Bilang UNSAFE kalau:
- Ada perubahan mencurigakan/berbahaya (menghapus data, disable/melemahkan authentication atau authorization check, expose secret/credential, kirim data ke endpoint eksternal yang tidak diminta).
- Diff nggak nyambung sama sekali dengan task/ide yang diminta.
- Diff kosong/nyaris kosong padahal task-nya signifikan (tanda kerjaan nggak selesai).
- Ada tanda-tanda kode yang jelas rusak/nggak masuk akal secara sepintas (walau build/typecheck katanya lolos).

Bilang SAFE kalau diff terlihat masuk akal, sesuai task, dan nggak ada dari poin-poin di atas.

Jawab HANYA dalam format JSON PERSIS seperti ini, tanpa teks lain di luar JSON, dan jangan pernah output tool-call:
{"safe": true atau false, "reasoning": "penjelasan singkat 1-3 kalimat kenapa"}`;

  const userMessage = `Task/ide asli:\n${idea}\n\nDiff yang mau di-review (git diff main...branch):\n${diff.slice(0, 60_000)}`;

  const res = await fetchWithRetry(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Review API error (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((c) => c.type === 'text');
  if (!textBlock?.text) throw new Error('Response review tidak berisi teks yang valid');

  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Response review bukan JSON valid: ${raw.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return { safe: parsed.safe === true, reasoning: String(parsed.reasoning || '').slice(0, 2000) };
}

async function reviewAndMaybeMerge(job, branchName) {
  const isSelfEdit = process.env.SELF_REPO_URL && job.targetRepo === process.env.SELF_REPO_URL;
  const sshKeyContent = isSelfEdit ? process.env.GIT_SSH_KEY_SELF : process.env.GIT_SSH_KEY;

  log(`Job ${job.id}: mode AUTO, mulai review diff sebelum merge...`);

  let tmpDir;
  try {
    const { tmpDir: dir, cloneDir, gitEnv, diff, changedFiles } = await cloneForReview(
      job.targetRepo,
      branchName,
      sshKeyContent,
    );
    tmpDir = dir;

    const sensitiveHit = changedFiles.find(matchesSensitivePattern);
    if (sensitiveHit) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          reviewVerdict: 'SKIPPED_SENSITIVE_FILE',
          reviewReasoning: `Diff nyentuh file sensitif (${sensitiveHit}), auto-merge dibatalkan, fallback ke manual review.`,
        },
      });
      log(`Job ${job.id}: nyentuh file sensitif (${sensitiveHit}), skip auto-merge.`);
      return;
    }

    if (!diff.trim()) {
      await prisma.job.update({
        where: { id: job.id },
        data: { reviewVerdict: 'UNSAFE', reviewReasoning: 'Diff kosong, kemungkinan kerjaan gagal/tidak ada perubahan nyata.' },
      });
      log(`Job ${job.id}: diff kosong, skip auto-merge.`);
      return;
    }

    const verdict = await reviewDiffWithClaude(job.idea, diff);
    await prisma.job.update({
      where: { id: job.id },
      data: { reviewVerdict: verdict.safe ? 'SAFE' : 'UNSAFE', reviewReasoning: verdict.reasoning },
    });

    if (!verdict.safe) {
      log(`Job ${job.id}: Claude review bilang UNSAFE (${verdict.reasoning}), skip auto-merge.`);
      return;
    }

    await gitRun(cloneDir, gitEnv, ['checkout', 'main']);
    await gitRun(cloneDir, gitEnv, ['pull', '--quiet', 'origin', 'main']);
    await gitRun(cloneDir, gitEnv, [
      'merge', '--no-ff', `origin/${branchName}`,
      '-m', `Auto-merge job ${job.id} (Claude review: SAFE)\n\n${job.idea.slice(0, 200)}`,
    ]);
    await gitRun(cloneDir, gitEnv, ['push', '--quiet', 'origin', 'main']);

    await prisma.job.update({ where: { id: job.id }, data: { merged: true } });

    // --- Safety net: setelah auto-merge, health-check endpoint web app ---
    const waitMs = parseInt(process.env.POST_MERGE_HEALTH_WAIT_MS || '20000', 10);
    log(`Job ${job.id}: menunggu ${waitMs}ms propagasi deploy sebelum health check...`);
    await new Promise((r) => setTimeout(r, waitMs));

    const healthResult = await runPostMergeHealthCheck(job.id);
    if (!healthResult.success) {
      const failureSummary = healthResult.failureSummary || 'unknown error';
      const revertSummary = `Auto-revert dilakukan karena health check gagal: ${failureSummary}`;

      try {
        const mergeCommitHash = (await gitRun(cloneDir, gitEnv, ['rev-parse', 'HEAD'])).trim();
        const parentCountOutput = await gitRun(cloneDir, gitEnv, ['rev-list', '--parents', '-n', '1', mergeCommitHash]);
        const tokens = parentCountOutput.trim().split(/\s+/);
        const parentCount = tokens.length - 1;
        const revertArgs = parentCount > 1
          ? ['revert', '--no-edit', '-m', '1', mergeCommitHash]
          : ['revert', '--no-edit', mergeCommitHash];

        await gitRun(cloneDir, gitEnv, revertArgs);
        await gitRun(cloneDir, gitEnv, ['push', '--quiet', 'origin', 'main']);
        await appendReviewReasoning(job.id, revertSummary);
        log(`Job ${job.id}: ${revertSummary}`);
      } catch (revertErr) {
        const fallback = `Auto-revert GAGAL. Health check gagal: ${failureSummary}. Error revert: ${revertErr.message}`;
        await appendReviewReasoning(job.id, fallback);
        log(`Job ${job.id}: ${fallback}`);
      }
    } else {
      log(`Job ${job.id}: health check setelah auto-merge OK.`);
    }

    log(`Job ${job.id}: lolos review, auto-merged ke main.`);
  } catch (err) {
    // Konflik merge atau error lain -- jangan biarin nyangkut tanpa penjelasan, tapi
    // status job tetap DONE, branch-nya masih ada dan bisa direview/merge manual.
    await prisma.job.update({
      where: { id: job.id },
      data: { reviewReasoning: `Auto-merge gagal: ${err.message}` },
    });
    log(`Job ${job.id}: auto-merge gagal (${err.message}), fallback manual review.`);
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function processJob(job) {
  log(`Mulai proses job ${job.id}: "${job.idea.slice(0, 60)}..."`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trackster-'));
  const promptFilePath = path.join(tmpDir, 'prompt.txt');
  const envFilePath = path.join(tmpDir, 'agent.env');
  const sshKeyFilePath = path.join(tmpDir, 'deploy_key');

  fs.writeFileSync(promptFilePath, job.plan || job.idea);
  // SSH private key ditulis ke file terpisah (BUKAN env var) karena --env-file Docker
  // tidak mendukung value multi-baris dengan baik.
  // Job self-edit (targetRepo === SELF_REPO_URL) pakai key TERPISAH (GIT_SSH_KEY_SELF) --
  // GitHub nggak izinin satu public key yang sama jadi deploy key di 2 repo berbeda.
  const isSelfEdit = process.env.SELF_REPO_URL && job.targetRepo === process.env.SELF_REPO_URL;
  const rawKey = isSelfEdit ? process.env.GIT_SSH_KEY_SELF : process.env.GIT_SSH_KEY;
  const sshKey = (rawKey || '').trimEnd() + '\n';
  fs.writeFileSync(sshKeyFilePath, sshKey, { mode: 0o600 });
  fs.writeFileSync(
    envFilePath,
    [
      `DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY}`,
      `DEEPSEEK_BASE_URL=${process.env.DEEPSEEK_BASE_URL}`,
      `DEEPSEEK_MODEL=${process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'}`,
      `GIT_AUTHOR_NAME=${process.env.GIT_AUTHOR_NAME || 'AI Trackster Agent'}`,
      `GIT_AUTHOR_EMAIL=${process.env.GIT_AUTHOR_EMAIL || 'ai-agent@trackster.my.id'}`,
      `MAX_AIDER_MESSAGES=${process.env.MAX_AIDER_MESSAGES || '40'}`,
      `MAX_CONTINUATION_ROUNDS=${process.env.MAX_CONTINUATION_ROUNDS || '3'}`,
    ].join('\n'),
  );

  const branchName = buildBranchName(job);

  try {
    const { exitCode, output } = await runAgentContainer(job, branchName, promptFilePath, envFilePath, sshKeyFilePath);
    const executionCostUsd = extractExecutionCostUsd(output);

    if (exitCode === 0) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          branchName,
          logOutput: output.slice(-50_000),
          executionCostUsd,
          completedAt: new Date(),
        },
      });
      log(`Job ${job.id} selesai, branch: ${branchName}`);

      if (job.mode === 'AUTO') {
        try {
          await reviewAndMaybeMerge(job, branchName);
        } catch (err) {
          log(`Job ${job.id}: error pas auto-review/merge: ${err.message}`);
        }
      }
    } else {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: `Container exit code ${exitCode}`,
          logOutput: output.slice(-50_000),
          executionCostUsd,
          completedAt: new Date(),
        },
      });
      log(`Job ${job.id} gagal, exit code ${exitCode}`);
    }
  } catch (err) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
    });
    log(`Job ${job.id} error: ${err.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function pollLoop() {
  log('Worker dimulai, polling tiap ' + POLL_INTERVAL_MS / 1000 + ' detik...');
  try {
    await reconcileOrphanedJobs();
  } catch (err) {
    log(`Error saat reconcile job orphan: ${err.message}`);
  }
  while (true) {
    try {
      const job = await pickupNextJob();
      if (job) {
        await processJob(job);
      }
    } catch (err) {
      log(`Error di poll loop: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

pollLoop();
