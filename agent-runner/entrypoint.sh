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

# --- Loop verifikasi build, feed error balik ke Aider kalau gagal ---
while [ $ATTEMPT -le $MAX_BUILD_RETRIES ]; do
  echo "=== Verifikasi build (percobaan $ATTEMPT) ==="

  # PENTING: tangkap exit code masing-masing build LANGSUNG setelah command-nya
  # jalan, jangan andalkan `$?` di akhir — kalau kedua project ada (seperti di
  # repo ini), `$?` cuma bakal reflect if-block TERAKHIR (frontend), jadi
  # backend build yang gagal bisa lolos tanpa ketahuan dan ke-push begitu saja.
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
    echo "Build OK."
    BUILD_OK=1
    break
  fi

  echo "Build gagal, feed error balik ke Aider..."
  echo "$BUILD_LOG" > /tmp/build-error.txt
  aider --model "$AIDER_MODEL" --yes-always --no-check-update \
    --message "Build/typecheck gagal dengan error berikut, perbaiki: $(cat /tmp/build-error.txt | tail -100)" \
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
