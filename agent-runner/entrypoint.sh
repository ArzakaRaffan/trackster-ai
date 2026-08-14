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

echo "=== Menjalankan Aider (model: $AIDER_MODEL) ==="

MAX_ATTEMPTS="${MAX_AIDER_MESSAGES:-40}"
ATTEMPT=1
BUILD_OK=0

# Attempt pertama: eksekusi spec penuh
aider --model "$AIDER_MODEL" --yes-always --no-check-update \
  --message-file /tmp/prompt.txt 2>&1

# --- Loop verifikasi build, feed error balik ke Aider kalau gagal ---
while [ $ATTEMPT -le 3 ]; do
  echo "=== Verifikasi build (percobaan $ATTEMPT) ==="

  BUILD_LOG=""
  if [ -f "apps/backend/package.json" ]; then
    BUILD_LOG+=$(cd apps/backend && npm install --silent 2>&1 && npm run build 2>&1)
  fi
  if [ -f "apps/frontend/package.json" ]; then
    BUILD_LOG+=$(cd apps/frontend && npm install --silent 2>&1 && npx tsc --noEmit 2>&1)
  fi

  if [ $? -eq 0 ]; then
    echo "Build OK."
    BUILD_OK=1
    break
  fi

  echo "Build gagal, feed error balik ke Aider..."
  echo "$BUILD_LOG" > /tmp/build-error.txt
  aider --model "$AIDER_MODEL" --yes-always --no-check-update \
    --message "Build/typecheck gagal dengan error berikut, perbaiki: $(cat /tmp/build-error.txt | tail -100)" 2>&1

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
  echo "=== SELESAI DENGAN WARNING: build masih gagal setelah $MAX_ATTEMPTS percobaan, tapi progress sudah di-push ke branch ==="
  exit 1
fi
