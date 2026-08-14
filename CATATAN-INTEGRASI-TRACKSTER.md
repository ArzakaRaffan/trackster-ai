# Integrasi ke Nginx Trackster (WAJIB dibaca sebelum deploy)

VPS kamu sekarang cuma bisa punya **satu** proses yang bind port 80/443 di host — itu nginx punya Trackster. Jadi AI Trackster numpang di situ, bukan bikin nginx sendiri.

## Langkah-langkah (jalanin di VPS, urut)

### 1. Bikin shared network

```bash
docker network create shared-web-net
```

### 2. Tambahin nginx DAN postgres Trackster ke network ini

Di **repo Trackster** (`~/trackster/docker-compose.prod.yml`), tambahin network `shared-web-net` ke service `nginx` **dan** `postgres` (postgres perlu ini biar backend AI Trackster bisa connect ke situ, daripada bikin container Postgres baru yang boros RAM buat tabel yang kecil):

```yaml
services:
  postgres:
    # ... config yang sudah ada, jangan diubah ...
    networks:
      - default
      - shared-web-net

  nginx:
    # ... config yang sudah ada, jangan diubah ...
    networks:
      - default
      - shared-web-net

networks:
  shared-web-net:
    external: true
```

Restart: `docker compose -f docker-compose.prod.yml up -d`

### 2b. Bikin database baru di Postgres yang sama (bukan bikin container baru)

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U trackster -c "CREATE DATABASE ai_trackster;"
```

`DATABASE_URL` di `.env` AI Trackster nanti isinya: `postgresql://trackster:<password_postgres_trackster>@postgres:5432/ai_trackster` — host-nya `postgres` (nama container Trackster), bukan `localhost`, karena connect lewat `shared-web-net`.

### 2c. Expose port Postgres ke host (khusus buat worker, yang jalan di host bukan container)

Worker (`worker/poll-and-run.js`) jalan LANGSUNG di VPS host lewat systemd, bukan di dalam Docker network — jadi dia butuh akses Postgres lewat port yang di-expose ke host. **Bind ke `127.0.0.1` doang**, jangan `0.0.0.0`, biar Postgres nggak ke-expose ke internet:

Di `~/trackster/docker-compose.prod.yml`, tambahin ke service `postgres`:

```yaml
services:
  postgres:
    # ... config yang sudah ada ...
    ports:
      - '127.0.0.1:5432:5432'
```

Restart: `docker compose -f docker-compose.prod.yml up -d postgres`

Worker `.env` (`worker/.env`, beda dari `.env` utama) pakai `DATABASE_URL="postgresql://trackster:<password>@localhost:5432/ai_trackster"` — host-nya `localhost` di sini, karena worker akses dari luar Docker.

### 3. Tambah server block baru di nginx Trackster

Buat file baru `~/trackster/nginx/conf.d/ai-trackster.conf` (folder yang sama dengan `trackster.conf` yang sudah ada):

```nginx
# --- AI Trackster Frontend: ai.trackster.my.id ---
server {
    listen 80;
    server_name ai.trackster.my.id;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name ai.trackster.my.id;
    ssl_certificate /etc/letsencrypt/live/ai.trackster.my.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.trackster.my.id/privkey.pem;

    location / {
        proxy_pass http://frontend:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# --- AI Trackster Backend: api.ai.trackster.my.id ---
server {
    listen 80;
    server_name api.ai.trackster.my.id;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name api.ai.trackster.my.id;
    ssl_certificate /etc/letsencrypt/live/api.ai.trackster.my.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ai.trackster.my.id/privkey.pem;

    location / {
        proxy_pass http://backend:4100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Catatan penting:** `proxy_pass http://frontend:3100` dan `http://backend:4100` itu nama container AI Trackster — ini cuma bisa di-resolve nginx Trackster KALAU sudah join `shared-web-net` di langkah 2. Kalau belum, nginx bakal error "host not found in upstream".

### 4. DNS

Tambah 2 A record baru di Exabytes DNS Manager (sama seperti `track`/`api.track` dulu):
- `ai` → `43.157.208.202`
- `api.ai` → `43.157.208.202`

### 5. SSL Certificate

Karena certbot Trackster udah ada dan jalan, tinggal minta certificate baru buat 2 domain ini. SSH ke VPS:

```bash
cd ~/trackster
docker compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot \
  --email <email-kamu> -d ai.trackster.my.id --rsa-key-size 4096 --agree-tos --no-eff-email

docker compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot \
  --email <email-kamu> -d api.ai.trackster.my.id --rsa-key-size 4096 --agree-tos --no-eff-email

docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### 6. Baru deploy AI Trackster itu sendiri

```bash
cd ~/ai-trackster
cp .env.example .env
nano .env   # isi semua value
docker compose build backend
docker compose build frontend
docker compose up -d
```

Container `ai-trackster-backend-1` dan `ai-trackster-frontend-1` sekarang otomatis nyambung ke `shared-web-net`, dan nginx Trackster bisa nemuin mereka lewat nama container itu.
