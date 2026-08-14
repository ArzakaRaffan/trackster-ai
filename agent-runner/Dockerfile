# Base Node image karena target repo (Trackster) itu Node/NestJS/Next.js — agent butuh npm/npx buat verifikasi kerjaannya.
FROM node:20-bookworm-slim

# Aider itu tool Python, jadi install Python + pip di atas base Node.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/aider-venv
ENV PATH="/opt/aider-venv/bin:$PATH"
RUN pip install --no-cache-dir aider-chat

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
