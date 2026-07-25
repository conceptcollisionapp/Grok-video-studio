# Grok Video Studio

AI news-broadcast video generator. Users build a multi-scene video (each scene =
an image + dialogue + duration + character/b-roll flag); the backend turns it
into one video with continuous TTS narration and lip-synced character scenes.

- **Frontend:** React (Create React App), deployed on Vercel
- **Backend:** FastAPI, deployed on Railway via `backend/Dockerfile` (installs
  ffmpeg — required; a `nixpacks.toml` approach was silently ignored by
  Railway's builder, so don't reintroduce it)
- **Storage:** S3 for uploaded scene images (`uploads/`) and finished videos
  (`outputs/`); falls back to ephemeral local `/static` when S3 is unconfigured

## Pipeline

`POST /generate` validates and returns a `job_id` immediately; the work runs in
a background thread (poll `GET /status/{job_id}` for stage, elapsed time, and
the final video URL). Per job: xAI TTS narration (one continuous track from the
concatenated scene dialogue) → one xAI Grok Imagine image-to-video clip per
scene → Replicate `sync/lipsync-2` on character scenes (paired with their slice
of the narration) → ffmpeg concat + full-narration overlay → store + return URL.

API keys (xAI + Replicate) are supplied **per request by each user** from the
frontend (persisted only in their browser's localStorage) — never stored
server-side.

## Local development

Backend (Python 3.13, ffmpeg on PATH):

```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows (source .venv/bin/activate elsewhere)
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:

```
npm install
npm start
```

Note: `backendUrl` in `src/app.js` points at the production Railway URL —
change it to `http://127.0.0.1:8000` to test against a local backend, and add
your local origin to `CORS_ORIGINS` if it isn't `http://localhost:3000`.

## Backend environment variables (Railway)

| Variable | Purpose |
|---|---|
| `S3_BUCKET` | Enables S3 storage (the on-switch) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user scoped to `s3:PutObject`/`s3:GetObject` on the bucket |
| `AWS_REGION` | Hint only — the real bucket region is auto-detected |
| `S3_PUBLIC_BASE_URL` | If set, return stable public URLs (bucket policy must allow public read); otherwise 7-day presigned URLs |
| `S3_PREFIX` / `S3_OUTPUT_PREFIX` | Key prefixes (default `uploads` / `outputs`) |
| `CORS_ORIGINS` | Comma-separated allowed origins (defaults to the Vercel app + localhost:3000) |
| `MAX_UPLOAD_MB` | Upload size cap (default 10) |
