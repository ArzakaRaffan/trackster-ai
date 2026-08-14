#!/bin/bash
set -uo pipefail
# Sengaja TIDAK pakai `set -e` di top-level — kita mau tetep push branch & kasih log
# meskipun ada langkah yang gagal, biar user tetep bisa review progress paginya.

echo "=== AI Trackster Agent Runner ==="
echo "Target repo: $TARGET_REPO"
echo "Branch: $BRANCH_NAME"

# --- Setup SSH key buat akses git (di-mount sebagai file, bukan env var, karena private key multi-baris) ---
if [ -f /tmp/deploy_key ] && [ -s /tmp/deploy_key ]; then
  mkdir -p ~/.ssh
  cp /tmp/deploy_key ~/.ssh/id_ed25519
  chmod 600 ~/.ssh/id_ed25519
  ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
fi

git config --global user.name "${GIT_AUTHOR_NAME:-AI Trackster Agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-ai-agent@trackster.my.id}"
git config --global init.defaultBranch main

# --- Clone fresh, JANGAN pernah kerja di folder yang di-mount dari host ---
echo "=== Cloning $TARGET_REPO ==="
git clone "$TARGET_REPO" /workspace/repo
if [ $? -ne 0 ]; then
  echo "FATAL: git clone gagal"
  exit 1
fi
cd /workspace/repo

git checkout -b "$BRANCH_NAME"

# --- Map env var DeepSeek ke format yang dipahami Aider (litellm-based, OpenAI-compatible) ---
export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
export OPENAI_API_BASE="$DEEPSEEK_BASE_URL"
AIDER_MODEL="openai/${DEEPSEEK_MODEL:-deepseek-v4-flash}"

# --- Kumpulkan source file yang boleh diedit Aider, dan kasih SEMUANYA sebagai
# argumen posisional di awal. Aider CUMA mengedit file yang eksplisit "ditambahkan
# ke chat" — kalau prompt cuma menyebut sebagian file (apalagi dengan bahasa
# hedge kayak "misalnya app/page.tsx atau setara"), Aider yang taat aturan bakal
# menolak menyentuh file lain dan malah nulis "tolong tambahkan file itu ke chat"
# di outputnya. Run ini non-interaktif (--message-file, sekali jalan) jadi TIDAK
# ADA yang bisa menjawab permintaan itu — build tetap lolos (karena Aider cuma
# berhasil edit token/config yang "ketemu"), job dilaporkan DONE, padahal
# hampir tidak ada perubahan nyata. Fix: jangan andalkan Aider menebak file dari
# teks prompt, kasih daftar file lengkap secara eksplisit di command line.
mapfile -t EDITABLE_FILES < <(find apps -type f \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.css" -o -name "*.json" \) \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" \
  -not -name "package-lock.json" \
  2>/dev/null)

# --- Guardrail schema drift & smoke test (Task 1 & 3) ---

collect_changed_files() {
  {
    git diff --name-only "origin/main...HEAD"
    git diff --name-only
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } | sort -u
}

run_schema_drift_check() {
  local changed
  changed=$(collect_changed_files)

  if printf '%s\n' "$changed" | grep -qx 'apps/backend/prisma/schema.prisma'; then
    if ! printf '%s\n' "$changed" | grep -qx 'worker/prisma/schema.prisma'; then
      echo "SCHEMA_DRIFT_CHECK_FAILED: apps/backend/prisma/schema.prisma berubah, tapi worker/prisma/schema.prisma TIDAK ikut berubah. Kedua file Prisma schema harus disinkronkan dalam commit yang sama." >&2
      return 1
    fi
  fi

  return 0
}

smoke_cleanup() {
  local pid="$1"
  if [ -n "$pid" ]; then
    if kill -0 "$pid" 2>/dev/null; then
      local pgid
      pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
      if [ -n "$pgid" ]; then
        kill -- -"$pgid" 2>/dev/null
      fi
      kill "$pid" 2>/dev/null
    fi
  fi
}

run_smoke_test() {
  local backend_pid=""
  local frontend_pid=""
  local backend_ready=0
  local frontend_ready=0
  local failed_endpoints=""
  local max_retries=15
  local attempt

  # Start backend dan frontend sebagai background process.
  # Smoke test ini best-effort: hanya memastikan proses bisa serve HTTP dan
  # endpoint tidak langsung return 5xx/connection refused. Ini bukan pengganti
  # automated test suite yang sesungguhnya.
  (cd apps/backend && npm run start > /tmp/backend-smoke.log 2>&1) &
  backend_pid=$!

  (cd apps/frontend && npm run dev > /tmp/frontend-smoke.log 2>&1) &
  frontend_pid=$!

  local backend_port="${BACKEND_PORT:-4100}"
  local frontend_port="${FRONTEND_PORT:-3100}"

  for attempt in $(seq 1 $max_retries); do
    if kill -0 "$backend_pid" 2>/dev/null && (exec 3<>/dev/tcp/127.0.0.1/$backend_port) 2>/dev/null; then
      backend_ready=1
      break
    fi
    if ! kill -0 "$backend_pid" 2>/dev/null; then
      failed_endpoints+="backend proses mati sebelum siap; "
      break
    fi
    sleep 2
  done

  for attempt in $(seq 1 $max_retries); do
    if kill -0 "$frontend_pid" 2>/dev/null && (exec 3<>/dev/tcp/127.0.0.1/$frontend_port) 2>/dev/null; then
      frontend_ready=1
      break
    fi
    if ! kill -0 "$frontend_pid" 2>/dev/null; then
      failed_endpoints+="frontend proses mati sebelum siap; "
      break
    fi
    sleep 2
  done

  if [ "$backend_ready" -eq 1 ] && [ "$frontend_ready" -eq 1 ]; then
    check_url() {
      local url="$1"
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url" 2>/dev/null)
      if [ -z "$code" ]; then
        failed_endpoints+="timeout/connection refused: $url; "
        return 1
      fi
      case "$code" in
        5*)
          failed_endpoints+="HTTP $code: $url; "
          return 1
          ;;
        *)
          return 0
          ;;
      esac
    }

    check_url "http://127.0.0.1:${backend_port}/auth/me"
    check_url "http://127.0.0.1:${backend_port}/jobs"
    check_url "http://127.0.0.1:${frontend_port}/"
    check_url "http://127.0.0.1:${frontend_port}/jobs"
  else
    failed_endpoints+="backend_ready=$backend_ready frontend_ready=$frontend_ready; "
  fi

  smoke_cleanup "$backend_pid"
  smoke_cleanup "$frontend_pid"

  if [ -n "$failed_endpoints" ]; then
    echo "SMOKE_TEST_FAILED: $failed_endpoints"
    return 1
  fi

  return 0
}

echo "=== Menjalankan Aider (model: $AIDER_MODEL, ${#EDITABLE_FILES[@]} file di-add ke chat) ==="

MAX_BUILD_RETRIES=3
ATTEMPT=1
BUILD_OK=0

# Attempt pertama: eksekusi spec penuh
AIDER_OUTPUT=$(aider --model "$AIDER_MODEL" --yes-always --no-check-update \
  --message-file /tmp/prompt.txt "${EDITABLE_FILES[@]}" 2>&1)
echo "$AIDER_OUTPUT"

# --- Loop lanjutan: spec besar/multi-bagian sering cuma SEBAGIAN dikerjain dalam
# satu turn (model berhenti setelah 1 chunk logis, build tetap lolos karena chunk
# itu sendiri valid, job dilaporkan selesai padahal scope-nya jauh dari lengkap —
# kejadian nyata: spec redesign 2 halaman, yang beneran dikerjain cuma token
# setup). Build-fix loop di bawah CUMA jalan kalau build GAGAL, jadi tidak
# menangkap kasus "build sukses tapi belum selesai". Minta Aider eksplisit lapor
# TASK_COMPLETE kalau semua bagian spec sudah tercover, ulangi kalau belum,
# dibatasi MAX_CONTINUATION_ROUNDS biar tidak muter tanpa henti/boros API call.
MAX_CONTINUATION_ROUNDS="${MAX_CONTINUATION_ROUNDS:-3}"
ROUND=1
while [ $ROUND -le $MAX_CONTINUATION_ROUNDS ]; do
  if echo "$AIDER_OUTPUT" | grep -q "TASK_COMPLETE"; then
    echo "=== Agent lapor implementasi spec sudah lengkap (round $ROUND) ==="
    break
  fi
  echo "=== Lanjutan implementasi spec (round $ROUND/$MAX_CONTINUATION_ROUNDS) ==="
  AIDER_OUTPUT=$(aider --model "$AIDER_MODEL" --yes-always --no-check-update \
    --message "Cek ulang spec lengkap di /tmp/prompt.txt dari awal. Kalau ada bagian yang BELUM kamu implementasikan (misal masih ada section/checklist yang belum disentuh sama sekali), lanjutkan kerjain SEKARANG -- jangan berhenti di tengah scope. Kalau SEMUA bagian di spec itu sudah lengkap diimplementasikan, balas dengan kata TASK_COMPLETE di akhir pesan kamu dan jangan ubah file apapun lagi." \
    "${EDITABLE_FILES[@]}" 2>&1)
  echo "$AIDER_OUTPUT"
  ROUND=$((ROUND + 1))
done

# --- Loop verifikasi build, tambahan schema drift guardrail, dan smoke test ---
while [ $ATTEMPT -le $MAX_BUILD_RETRIES ]; do
  echo "=== Verifikasi build & smoke test (percobaan $ATTEMPT) ==="

  BUILD_LOG=""
  BUILD_FAILED=0

  if [ -f "apps/backend/package.json" ]; then
    BACKEND_LOG=$(cd apps/backend && npm install --silent 2>&1 && npm run build 2>&1)
    BACKEND_STATUS=$?
    BUILD_LOG+="$BACKEND_LOG"
    [ $BACKEND_STATUS -ne 0 ] && BUILD_FAILED=1
  fi
  if [ -f "apps/frontend/package.json" ]; then
    FRONTEND_LOG=$(cd apps/frontend && npm install --silent 2>&1 && npx tsc --noEmit 2>&1)
    FRONTEND_STATUS=$?
    BUILD_LOG+="$FRONTEND_LOG"
    [ $FRONTEND_STATUS -ne 0 ] && BUILD_FAILED=1
  fi

  if [ $BUILD_FAILED -eq 0 ]; then
    echo "Build/typecheck OK. Menjalankan schema drift guardrail..."
    if ! run_schema_drift_check; then
      BUILD_FAILED=1
      BUILD_LOG+="\nSCHEMA_DRIFT_CHECK_FAILED: apps/backend/prisma/schema.prisma berubah, tapi worker/prisma/schema.prisma TIDAK ikut berubah. Kedua file Prisma schema harus disinkronkan dalam commit yang sama."
    fi
  fi

  if [ $BUILD_FAILED -eq 0 ]; then
    echo "Schema drift OK. Menjalankan smoke test..."
    if ! SMOKE_OUTPUT=$(run_smoke_test 2>&1); then
      BUILD_FAILED=1
      BUILD_LOG+="\nSMOKE_TEST_FAILED:\n$SMOKE_OUTPUT"
    fi
  fi

  if [ $BUILD_FAILED -eq 0 ]; then
    echo "Build, guardrail, dan smoke test OK."
    BUILD_OK=1
    break
  fi

  echo "Verifikasi gagal, feed error balik ke Aider..."
  echo "$BUILD_LOG" > /tmp/build-error.txt
  aider --model "$AIDER_MODEL" --yes-always --no-check-update \
    --message "Build/typecheck/guardrail/smoke test gagal dengan error berikut, perbaiki: $(cat /tmp/build-error.txt | tail -100)" \
    "${EDITABLE_FILES[@]}" 2>&1

  ATTEMPT=$((ATTEMPT + 1))
done

# --- Commit & push apapun hasilnya, biar user bisa review progress ---
echo "=== Commit & push ==="
git add -A
git commit -m "AI Trackster agent: auto-implementasi dari job (build_ok=$BUILD_OK)" || echo "Nothing to commit"
git push origin "$BRANCH_NAME"
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  echo "FATAL: git push gagal"
  exit 1
fi

if [ $BUILD_OK -eq 1 ]; then
  echo "=== SELESAI: build lolos ==="
  exit 0
else
  echo "=== SELESAI DENGAN WARNING: build masih gagal setelah $MAX_BUILD_RETRIES percobaan, tapi progress sudah di-push ke branch ==="
  exit 1
fi
