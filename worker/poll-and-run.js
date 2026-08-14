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

function runAgentContainer(job, promptFilePath, envFilePath, sshKeyFilePath) {
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
      '-e', `BRANCH_NAME=ai-agent/job-${job.id}`,
      '-v', `${promptFilePath}:/tmp/prompt.txt:ro`,
      '-v', `${sshKeyFilePath}:/tmp/deploy_key:ro`,
      AGENT_IMAGE,
    ];

    log(`Menjalankan container: docker ${args.join(' ')}`);

    const child = spawn('docker', args);
    let output = '';

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
      resolve({ exitCode: code, output });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
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
  fs.writeFileSync(sshKeyFilePath, process.env.GIT_SSH_KEY || '', { mode: 0o600 });
  fs.writeFileSync(
    envFilePath,
    [
      `DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY}`,
      `DEEPSEEK_BASE_URL=${process.env.DEEPSEEK_BASE_URL}`,
      `DEEPSEEK_MODEL=${process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'}`,
      `GIT_AUTHOR_NAME=${process.env.GIT_AUTHOR_NAME || 'AI Trackster Agent'}`,
      `GIT_AUTHOR_EMAIL=${process.env.GIT_AUTHOR_EMAIL || 'ai-agent@trackster.my.id'}`,
      `MAX_AIDER_MESSAGES=${process.env.MAX_AIDER_MESSAGES || '40'}`,
    ].join('\n'),
  );

  try {
    const { exitCode, output } = await runAgentContainer(job, promptFilePath, envFilePath, sshKeyFilePath);
    const branchName = `ai-agent/job-${job.id}`;

    if (exitCode === 0) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          branchName,
          logOutput: output.slice(-50_000), // batasi biar nggak bengkak, ambil 50k karakter terakhir
          completedAt: new Date(),
        },
      });
      log(`Job ${job.id} selesai, branch: ${branchName}`);
    } else {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: `Container exit code ${exitCode}`,
          logOutput: output.slice(-50_000),
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
