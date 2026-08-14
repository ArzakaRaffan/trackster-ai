# AI Trackster

Web interface buat kasih "ide besar" ke AI agent, yang otomatis:
1. **Plan** — ide singkat kamu diubah jadi technical spec detail (pakai Claude, via mwapi.dev)
2. **Execute** — spec itu dieksekusi beneran ke codebase target (pakai Aider + DeepSeek, jalan di container terisolasi di VPS)
3. Hasilnya di-push ke branch baru (bukan `main`) — kamu review paginya, merge manual kalau oke

## Arsitektur

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  ai.trackster.my.id │────▶│   PostgreSQL      │◀────│  worker (host VPS,  │
│  (Next.js + Nest)   │     │   (job queue di   │     │  bukan container)   │
│  - submit ide        │     │   tabel Job)      │     │  - polling job baru │
│  - review plan        │    └──────────────────┘     │  - docker run agent │
│  - lihat hasil/log    │                              └──────────┬──────────┘
└─────────────────────┘                                            │
                                                                     ▼
                                                        ┌────────────────────────┐
                                                        │  agent-runner (Docker)  │
                                                        │  - network terisolasi   │
                                                        │  - fresh git clone      │
                                                        │  - Aider + DeepSeek     │
                                                        │  - push ke branch baru  │
                                                        └────────────────────────┘
```

## Kenapa worker terpisah dari web app?

Web app (`apps/backend`) **tidak pernah** pegang akses Docker socket langsung — dia cuma nulis job ke database. Worker script (`worker/poll-and-run.js`) jalan langsung di VPS host (via systemd), polling job baru, dan dia yang jalanin `docker run`. Ini mengurangi permukaan serangan: kalau web app yang exposed ke internet kena exploit, attacker tetap tidak dapat kontrol Docker.

## Setup

Lihat `worker/README.md` dan `agent-runner/README.md` untuk detail masing-masing komponen.

## Urutan Setup (Dari Nol)

1. **Integrasi ke Trackster dulu** — baca `CATATAN-INTEGRASI-TRACKSTER.md`, ikuti langkah 1-2c (shared network, database baru, expose Postgres ke host)
2. **DNS** — tambah `ai` dan `api.ai` di Exabytes, arahkan ke IP VPS
3. **SSL** — langkah 5 di `CATATAN-INTEGRASI-TRACKSTER.md`
4. **Deploy web app**: `cp .env.example .env`, isi semua value, `docker compose build backend && docker compose build frontend && docker compose up -d`
5. **Setup agent-runner**: `cd agent-runner && ./setup-network.sh` (bikin network terisolasi + build image)
6. **Setup worker**: `cd worker && npm install && cp .env.example .env`, isi semua value (termasuk DeepSeek key resmi dari platform.deepseek.com, dan SSH deploy key khusus)
7. **Daftarin systemd service**: `sudo cp worker/ai-trackster-worker.service /etc/systemd/system/`, `sudo systemctl daemon-reload`, `sudo systemctl enable --now ai-trackster-worker`
8. Cek jalan: `sudo systemctl status ai-trackster-worker`, buka `https://ai.trackster.my.id`, login pakai `ACCESS_SECRET`, coba submit ide kecil dulu buat tes end-to-end

## Keamanan (WAJIB dipahami sebelum pakai)

- Container agent jalan dengan `bypassPermissions`-style otomatis (Aider `--yes-always`) — TANPA supervisi manusia. Makanya semua isolasi (network terpisah, fresh clone, secret terbatas, push ke branch bukan main) itu bukan opsional.
- `TARGET_REPO_URL` sebaiknya pakai SSH deploy key yang **cuma** akses ke repo itu, bukan personal access token yang bisa akses semua repo kamu.
- Selalu review branch hasil kerja agent sebelum merge ke `main` — jangan auto-merge.

