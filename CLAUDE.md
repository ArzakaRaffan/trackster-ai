# AI Trackster — Project Memory

Web interface buat submit "ide besar" yang otomatis di-plan (Claude) lalu dieksekusi beneran ke codebase (Aider + DeepSeek) di container terisolasi, jalan unattended di VPS — biar bisa ditinggal tidur, hasilnya di-review paginya.

**Bukan produk publik.** Solo/small-group tool (3 user: arzaka/hamooy/zahara), auth 2 lapis, jangan pernah dibuka tanpa login.

## Tech Stack

- Backend: NestJS + Prisma + PostgreSQL, di `apps/backend`
- Frontend: Next.js 14 App Router + Tailwind, di `apps/frontend`
- Worker: Node.js script polos (`worker/poll-and-run.js`), jalan LANGSUNG di VPS host via systemd — BUKAN di dalam container
- Agent runner: Docker image terisolasi (Node + Python/Aider), di-spawn on-demand oleh worker, bukan service yang nyala terus

## Arsitektur (3 komponen, jangan disatukan)

1. **Web app** (`docker-compose.yml`) — cuma nulis job ke database, TIDAK PERNAH pegang akses Docker socket. Ini yang exposed ke internet.
2. **Worker** (`worker/`) — jalan di host, polling job `QUEUED`, yang jalanin `docker run` buat agent. Alasan dipisah dari web app: kalau web app kena exploit, attacker tetap nggak dapet kontrol Docker.
3. **Agent runner** (`agent-runner/`) — container sekali-pakai per job (`--rm`), network terisolasi (`ai-trackster-agent-net`, terpisah dari network Trackster/web app), fresh git clone (bukan folder yang lagi aktif), env cuma isi DeepSeek key + git deploy key (BUKAN secret production Trackster).

## Job Lifecycle

`DRAFTING_PLAN` → (Claude generate spec) → `PLANNED` → (user review/edit, approve) → `QUEUED` → (worker pickup) → `RUNNING` → `DONE` (ada `branchName`) atau `FAILED`.

Agent SELALU push ke branch baru (`ai-agent/job-<id>`), **TIDAK PERNAH** ke `main` — user wajib review manual sebelum merge.

## Auth — 2 Lapis (jangan disederhanakan jadi 1 lapis lagi)

1. **Login biasa** (JWT cookie, `AuthGuard`) — 3 user di tabel `User` (`prisma/seed.js`), password di-hash bcrypt. Cukup buat akses chat dan **lihat** job.
2. **Password kedua** (`AgentSecretGuard`, header `x-agent-secret`) — dicek terhadap `AGENT_ACCESS_SECRET` di env, WAJIB di semua endpoint yang bisa trigger agent beneran ngedit kode: `POST /jobs`, `PUT /jobs/:id/plan`, `POST /jobs/:id/approve`, `DELETE /jobs/:id`. Dikirim ulang tiap aksi (bukan disimpan di sesi) — by design, biar akun lain (hamooy/zahara) bisa login & chat tapi nggak bisa trigger agent tanpa tau secret ini.
3. Kalau nambah endpoint baru yang bisa mutasi job/trigger eksekusi, PASANG `AgentSecretGuard` juga — jangan lupa, ini bukan opsional.

## Provider AI — jangan asal asumsi compatible

- **Planner** (generate spec dari ide) → Claude, via `mwapi.dev` (reseller). **mwapi.dev CUMA support Claude** (Opus/Sonnet/Haiku, Anthropic-compatible), TIDAK ADA DeepSeek/model lain di situ — sempat salah asumsi soal ini, jangan diulang.
- **Eksekusi** (Aider beneran ngedit kode) → DeepSeek **resmi** (`platform.deepseek.com`, `https://api.deepseek.com`), BUKAN reseller. Model: `deepseek-v4-flash` (default, murah) atau `deepseek-v4-pro`. Nama model lama (`deepseek-chat`/`deepseek-reasoner`) sudah di-retire per 24 Juli 2026, jangan dipakai.
- **Chat biasa** → `kelontongai.my.id` (key terpisah, stakes rendah, banyak model). Env var `CHAT_API_KEY`/`CHAT_API_BASE_URL` ini SENGAJA beda dari `PLANNER_API_KEY` — jangan digabung, biar kalau satu key mati yang lain nggak ikut kena.

## Gotcha Teknis (sudah pernah ke-debug, jangan diulang)

- **SSH deploy key HARUS di-mount sebagai file** ke container agent (`-v key:/tmp/deploy_key:ro`), BUKAN lewat `--env-file` Docker — env-file nggak support value multi-baris, private key jadi rusak kalau dipaksa masuk situ.
- Semua gotcha Dockerfile dari Trackster juga berlaku di sini (project sama-sama NestJS/Next.js): OpenSSL eksplisit buat Prisma di Alpine, `NODE_ENV=production` di-set SETELAH `npm install`, `tsconfig.json` perlu `rootDir: "./src"` biar `dist/main.js` nggak nyasar ke `dist/src/main.js`, seed pakai plain JS bukan ts-node.
- Nginx & Postgres **numpang punya Trackster**, bukan bikin baru — VPS cuma 2GB RAM, dan cuma bisa ada satu proses yang bind port 80/443. Lihat `CATATAN-INTEGRASI-TRACKSTER.md` buat detail lengkap (shared network, database `ai_trackster` terpisah di Postgres yang sama, Postgres di-expose ke `127.0.0.1` doang buat diakses worker dari host).
- Worker connect ke Postgres via `localhost` (host-mapped port), tapi container backend/frontend connect via nama container `postgres` (Docker network) — DUA `DATABASE_URL` beda di dua tempat (`.env` root vs `worker/.env`), jangan disamain.

## Fitur yang Belum Diimplementasi (kalau ditanya/diminta)

- **Self-edit**: `TARGET_REPO_URL` saat ini hardcoded ke satu repo (Trackster) di `.env`. Bisa diperluas jadi dropdown pilihan repo (termasuk repo AI Trackster sendiri) di halaman submit ide. Kalau ini dikerjain: HATI-HATI ekstra buat file sensitif (`entrypoint.sh`, `auth.guard.ts`, `agent-secret.guard.ts`) kalau target-nya self-edit — bug di situ bisa merusak alat yang dipakai buat perbaikannya sendiri. Tetap wajib review manual sebelum merge, jangan auto-merge apapun alasannya.
