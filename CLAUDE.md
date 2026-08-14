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

Ada 2 mode per job (field `Job.mode`), dipilih user pas submit:

- **MANUAL** (default): `DRAFTING_PLAN` → (Claude generate spec) → `PLANNED` → (user review/edit, approve manual) → `QUEUED` → (worker pickup) → `RUNNING` → `DONE` (ada `branchName`) atau `FAILED`. Agent push ke branch baru, user WAJIB merge manual dari GitHub sendiri.
- **AUTO**: `DRAFTING_PLAN` → (Claude generate spec) → **skip `PLANNED`, auto-approve langsung `QUEUED`** → `RUNNING` → `DONE` → worker minta Claude review diff-nya → kalau `SAFE` DAN nggak nyentuh file sensitif, **worker auto-merge ke `main`** (`Job.merged = true`). Lihat bagian "Auto mode" di bawah buat detail lengkap.

Branch name sekarang deskriptif: `ai-agent/<branchSlug>-<id>` (slug dari Claude planner, field `BRANCH_SLUG:` di baris pertama response-nya sebelum spec) — fallback ke `ai-agent/job-<id>` polos kalau slug gagal ke-generate.

## Auth — 2 Lapis (jangan disederhanakan jadi 1 lapis lagi)

1. **Login biasa** (JWT cookie, `AuthGuard`) — 3 user di tabel `User` (`prisma/seed.js`), password di-hash bcrypt. Cukup buat akses chat dan **lihat** job.
2. **Password kedua** (`AgentSecretGuard`, header `x-agent-secret`) — dicek terhadap `AGENT_ACCESS_SECRET` di env, WAJIB di semua endpoint yang bisa trigger agent beneran ngedit kode: `POST /jobs`, `PUT /jobs/:id/plan`, `POST /jobs/:id/approve`, `DELETE /jobs/:id`. Dikirim ulang tiap aksi (bukan disimpan di sesi) — by design, biar akun lain (hamooy/zahara) bisa login & chat tapi nggak bisa trigger agent tanpa tau secret ini.
3. Kalau nambah endpoint baru yang bisa mutasi job/trigger eksekusi, PASANG `AgentSecretGuard` juga — jangan lupa, ini bukan opsional.

## Provider AI — jangan asal asumsi compatible

- **Planner** (generate spec dari ide) → Claude, via `mwapi.dev` (reseller). **mwapi.dev CUMA support Claude** (Opus/Sonnet/Haiku, Anthropic-compatible), TIDAK ADA DeepSeek/model lain di situ — sempat salah asumsi soal ini, jangan diulang.
- **mwapi.dev diam-diam nyuntik tool definitions ke SETIAP request**, walau kita nggak pernah kirim param `tools` (kelihatan dari `input_tokens` yang jauh lebih gede dari prompt asli, ~7000+ token buat prompt pendek). Kalau ide user nyebut path file spesifik, modelnya bisa nyoba "manggil" tool (misal `read_file`) alih-alih nulis spec teks, dan proxy-nya leak raw tool-call JSON sebagai text block biasa (`plan` jadi rusak, contoh nyata: cuma `read_file`). Fix di `planner.service.ts`: system prompt eksplisit larang tool use SAMA SEKALI, plus validasi tolak response yang kependekan/berbentuk JSON — jangan diamnya disimpan jadi plan yang rusak.
- **Eksekusi** (Aider beneran ngedit kode) → DeepSeek **resmi** (`platform.deepseek.com`, `https://api.deepseek.com`), BUKAN reseller. Model: `deepseek-v4-flash` (default, murah) atau `deepseek-v4-pro`. Nama model lama (`deepseek-chat`/`deepseek-reasoner`) sudah di-retire per 24 Juli 2026, jangan dipakai.
- **Chat biasa** → `kelontongai.my.id` (key terpisah, stakes rendah, banyak model). Env var `CHAT_API_KEY`/`CHAT_API_BASE_URL` ini SENGAJA beda dari `PLANNER_API_KEY` — jangan digabung, biar kalau satu key mati yang lain nggak ikut kena.

## Gotcha Teknis (sudah pernah ke-debug, jangan diulang)

- **SSH deploy key HARUS di-mount sebagai file** ke container agent (`-v key:/tmp/deploy_key:ro`), BUKAN lewat `--env-file` Docker — env-file nggak support value multi-baris, private key jadi rusak kalau dipaksa masuk situ.
- Semua gotcha Dockerfile dari Trackster juga berlaku di sini (project sama-sama NestJS/Next.js): OpenSSL eksplisit buat Prisma di Alpine, `NODE_ENV=production` di-set SETELAH `npm install`, `tsconfig.json` perlu `rootDir: "./src"` biar `dist/main.js` nggak nyasar ke `dist/src/main.js`, seed pakai plain JS bukan ts-node.
- Nginx & Postgres **numpang punya Trackster**, bukan bikin baru — VPS cuma 2GB RAM, dan cuma bisa ada satu proses yang bind port 80/443. Lihat `CATATAN-INTEGRASI-TRACKSTER.md` buat detail lengkap (shared network, database `ai_trackster` terpisah di Postgres yang sama, Postgres di-expose ke `127.0.0.1` doang buat diakses worker dari host).
- Worker connect ke Postgres via `localhost` (host-mapped port), tapi container backend/frontend connect via nama container `postgres` (Docker network) — DUA `DATABASE_URL` beda di dua tempat (`.env` root vs `worker/.env`), jangan disamain.
- **Service AI Trackster di `docker-compose.yml` WAJIB dinamai `ai-frontend`/`ai-backend`, JANGAN `frontend`/`backend` polos.** Trackster sendiri punya service bernama sama persis. Begitu nginx Trackster join `shared-web-net` (tempat container AI Trackster nempel juga), nama yang collide bikin DNS Docker ambigu — pernah kejadian nginx salah resolve dan trafik `track.trackster.my.id` sempat 502 karena nyasar ke container AI Trackster. Kalau nambah service baru di compose file ini, selalu prefix `ai-`.
- **Worker (`worker/poll-and-run.js`) baca `.env`-nya sendiri via `dotenv`**, BUKAN via systemd `EnvironmentFile=` — systemd nggak reliable buat parse value multi-baris (`GIT_SSH_KEY`). Jangan tambahin `EnvironmentFile=` balik ke `ai-trackster-worker.service`.
- **SSH deploy key WAJIB diakhiri newline setelah `-----END OPENSSH PRIVATE KEY-----`**, kalau nggak OpenSSL gagal parse (`error in libcrypto`) meskipun isinya kelihatan benar. `poll-and-run.js` udah handle ini otomatis (`.trimEnd() + '\n'`) pas nulis file key — jangan dihapus.
- `worker/` butuh `prisma/schema.prisma` sendiri (duplikat dari `apps/backend/prisma/schema.prisma`) plus `postinstall: prisma generate` di `package.json`, karena `@prisma/client` nggak otomatis generate tanpa schema dan tanpa itu worker crash loop (`did not initialize yet`).
- **PENTING BANGET, WAJIB DIBACA KALAU MAU UBAH `Job` MODEL**: karena schema di atas duplikat, **SETIAP kali nambah/ubah field di model `Job` (atau model apapun yang dipakai worker) di `apps/backend/prisma/schema.prisma`, WAJIB update `worker/prisma/schema.prisma` juga di commit yang SAMA.** Kalau lupa, worker punya field itu sebagai `undefined` (nggak error saat baca, cuma diam-diam salah) — dan kalau `poll-and-run.js` NULIS ke field itu (misal `prisma.job.update({ data: { fieldBaru: ... } })`), Prisma bakal throw `Unknown argument` dan JOB YANG LAGI DIKERJAIN GAGAL DI-SAVE (kerjaan agent-nya sendiri tetap sukses/branch ke-push, tapi row job-nya nyangkut/gagal, harus di-reconcile manual). Ini udah kejadian 2x (auto-mode fields, lalu cost-tracking fields) — kalau nambah field baru ke Job, CEK ULANG dua-duanya sebelum lapor selesai.
- Migration Prisma HARUS di-generate manual dan di-commit (`prisma migrate dev --name init` dari lokal ke DB temp) — `prisma migrate deploy` di CMD Docker itu no-op kalau folder `prisma/migrations` kosong/nggak ada, jadi database nggak ke-provision sama sekali padahal container jalan normal.
- Dockerfile frontend WAJIB set `ENV PORT=3100` (dan `HOSTNAME=0.0.0.0`) — Next.js standalone `server.js` default listen di port 3000 apapun isi `EXPOSE`, jadi kalau nggak di-set nginx bakal 502 connect refused ke port yang salah.
- **Pernah ketemu kasus Docker build cache nyangkut folder `prisma/migrations` yang lama** meski file di disk udah benar dan CD jalan normal (`docker compose build ai-backend` "sukses" tapi migration baru nggak ke-apply, backend log cuma bilang "2 migrations found" padahal ada 3 folder di git). Fix: `docker compose build --no-cache ai-backend`. **Selalu verifikasi migration beneran ke-apply setelah deploy yang nambah migration baru** (`docker exec trackster-postgres-1 psql -U trackster -d ai_trackster -c '\d "NamaTabel"'`), jangan cuma percaya CD "sukses" — biar nggak keulang insiden kolom hilang diam-diam.

## Self-edit (repo AI Trackster sendiri sebagai target)

Halaman submit ide punya dropdown "Target repo": `Trackster` (default) atau `AI Trackster (self-edit)`. Backend resolve pilihan ini ke `TARGET_REPO_URL` atau `SELF_REPO_URL` di env — **client TIDAK PERNAH kirim url mentah**, cuma key `'trackster' | 'ai-trackster'`, biar job nggak bisa diarahkan clone/push ke repo sembarangan lewat request yang dimanipulasi.

Syarat biar opsi self-edit beneran jalan: public key `ai-trackster-deploy-key.pub` yang sama (yang udah didaftarin ke repo Trackster) HARUS didaftarin juga sebagai Deploy Key (Allow write access) di repo `trackster-ai` sendiri, dan `SELF_REPO_URL` diisi di `.env`. Kalau belum, opsi ini muncul di UI tapi bakal error pas job dieksekusi.

**HATI-HATI ekstra kalau review branch hasil self-edit**, terutama perubahan di `entrypoint.sh`, `auth.guard.ts`, `agent-secret.guard.ts` — bug di situ bisa merusak alat yang dipakai buat perbaikannya sendiri. Di mode MANUAL tetap wajib review manual sebelum merge. Di mode AUTO, file-file ini (plus `docker-compose*`, `.github/workflows/*`, `.env*`, `worker/poll-and-run.js`) masuk hard guardrail sensitive-file — **selalu** fallback ke manual review apapun verdict Claude-nya, lihat bagian "Auto mode" di bawah.

## Auto mode (auto-approve + auto-merge tanpa persetujuan user)

Selain mode MANUAL (default), job bisa disubmit dengan mode **AUTO** — plan auto-approve begitu jadi (skip nunggu user klik Approve), dan begitu agent selesai kerja, **worker sendiri** (`worker/poll-and-run.js`, fungsi `reviewAndMaybeMerge`) yang mutusin apa branch-nya di-auto-merge ke `main` atau nggak, TANPA user diminta approve apapun. Alurnya:

1. Worker clone repo, ambil diff `main...ai-agent/<branch>`.
2. **Hard guardrail dulu, sebelum Claude sempat baca apapun**: kalau diff nyentuh file di `SENSITIVE_FILE_PATTERNS` (`entrypoint.sh`, `auth.guard.ts`, `agent-secret.guard.ts`, `docker-compose*.yml`, `.github/workflows/*`, `.env*`, atau `worker/poll-and-run.js` itu sendiri), auto-merge otomatis DIBATALKAN — `reviewVerdict` diisi `SKIPPED_SENSITIVE_FILE`, job tetap `DONE` nunggu review manual. Claude nggak punya wewenang override guardrail ini.
3. Kalau lolos guardrail, worker kirim diff ke Claude (API sama dengan planner, `mwapi.dev`) minta verdict `SAFE`/`UNSAFE` + alasan singkat — disimpan di `Job.reviewVerdict`/`reviewReasoning`, ditampilkan di UI buat transparansi meski nggak ada approval gate.
4. Kalau `SAFE`: worker langsung `git merge --no-ff` + `push origin main` pakai deploy key yang sama (SELF atau non-SELF tergantung target repo), set `Job.merged = true`.
5. Kalau `UNSAFE` atau merge gagal (misal conflict): branch dibiarin apa adanya, `DONE` tanpa `merged`, user review manual seperti biasa.

**PENTING soal batas kemampuan review ini**: Claude-review-diff itu SATU pass otomatis yang murah (baca doang, bukan generate), BUKAN pengganti penuh review manusia yang udah kejadian berkali-kali di session pengembangan tool ini nyelametin dari bug nyata (chat 405 karena fetch URL salah, job yang "selesai" tapi cuma ngerjain 1 dari 3 file yang diminta) — otomasi ini nurunin frekuensi manual review, bukan menghilangkan resiko-nya. `PLANNER_API_KEY` dkk WAJIB ada juga di `worker/.env` (duplikat dari root `.env`) biar fungsi review ini bisa jalan — worker proses Node terpisah dari backend, nggak bisa import langsung.
