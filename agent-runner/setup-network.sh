#!/bin/bash
# Jalankan SEKALI di VPS sebelum pertama kali worker jalanin job.
# Network ini SENGAJA terisolasi dari network Trackster/AI-Trackster web app —
# container agent yang jalan di sini TIDAK BISA akses database production,
# TIDAK BISA akses container Trackster/AI-Trackster lainnya.

set -e

echo "=== Setup network terisolasi buat agent-runner ==="

if docker network inspect ai-trackster-agent-net >/dev/null 2>&1; then
  echo "Network 'ai-trackster-agent-net' sudah ada, skip."
else
  docker network create ai-trackster-agent-net
  echo "Network 'ai-trackster-agent-net' dibuat."
fi

echo ""
echo "=== Build image agent-runner ==="
cd "$(dirname "$0")"
docker build -t ai-trackster-agent-runner:latest .

echo ""
echo "=== Selesai. Cek image: ==="
docker images | grep ai-trackster-agent-runner
