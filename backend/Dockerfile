# Deterministic backend image for Railway.
#
# A Dockerfile takes precedence over Railway's auto-builders (Nixpacks AND
# Railpack), so ffmpeg is guaranteed regardless of which builder the service
# would otherwise use. The nixpacks.toml aptPkgs/nixPkgs approach was silently
# ignored by this service (ffmpeg stayed absent across two deploys).
#
# Build context is the `backend/` folder (Railway service Root Directory =
# backend), so `COPY requirements.txt .` resolves to backend/requirements.txt.
#
# The Debian `ffmpeg` package provides both `ffmpeg` and `ffprobe`, which the
# /generate pipeline shells out to (strip audio, trim, concat, overlay).
FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects $PORT at runtime; bind 0.0.0.0 so the container is reachable.
# --proxy-headers + trusting forwarded IPs makes request.base_url reflect the
# real public https:// host (Railway terminates TLS at its proxy), so the URLs
# returned by /upload and /generate are publicly fetchable by xAI.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
