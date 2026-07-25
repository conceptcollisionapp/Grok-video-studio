"""
Grok Video Studio backend.

POST /generate validates input, starts the pipeline in a background thread,
and returns {job_id} immediately (the work takes minutes — past proxy
timeouts). Clients poll GET /status/{job_id} for stage/elapsed/result.

Pipeline (per job — scenes are processed concurrently, then assembled):
  Character scenes: per-scene xAI TTS (duration measured) -> xAI Grok Imagine
     image-to-video sized to the speech -> Replicate sync/lipsync-2 with that
     scene's audio.
  B-roll scenes: per-scene TTS (skipped when dialogue is empty), then ffmpeg
     holds the still image for exactly the speech length. The generative video
     model is never involved, so graphs/text stay pixel-perfect.
  Assembly: each scene's audio is padded/trimmed to exactly its clip's length,
     so concatenated video and concatenated narration line up 1:1; ffmpeg
     concats both and muxes the narration over the whole video.
  Output: stored to S3 when configured (else local /static), URL via /status.
  Scene images arrive via POST /upload (same storage).

Every external call below is based on real, current docs:
  - xAI TTS:   POST https://api.x.ai/v1/tts   (raw audio bytes unless with_timestamps)
  - xAI video: POST https://api.x.ai/v1/videos/generations  ->  GET /v1/videos/{id}
  - Replicate: POST https://api.replicate.com/v1/models/sync/lipsync-2/predictions
               (handled via the `replicate` client for automatic file upload)
"""

import io
import json
import logging
import math
import os
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager

import requests
import replicate
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# Log through uvicorn's logger so lines show up in Railway's deploy logs.
logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_app):
    # One-time startup banner: makes the active storage mode obvious per deploy.
    if s3_enabled():
        try:
            _get_s3()  # warm client + resolve real bucket region for the log
        except Exception as e:  # noqa: BLE001 - never block startup on S3
            logger.warning("S3 client warmup failed: %s", e)
    summary = _storage_summary()
    if summary["mode"] == "s3":
        logger.info(
            "Storage: S3 bucket=%s region=%s uploads=%s outputs=%s urls=%s",
            summary["bucket"], summary["region"],
            summary["uploads_prefix"], summary["outputs_prefix"], summary["url_mode"],
        )
    else:
        logger.info("Storage: LOCAL /static (ephemeral — set S3_BUCKET to persist)")
    logger.info("Media tools: ffmpeg=%s ffprobe=%s", bool(FFMPEG), bool(FFPROBE))
    logger.info("Lip-sync model: %s", LIPSYNC_MODEL)
    threading.Thread(target=_reap_retained, daemon=True).start()   # 24h cleanup
    yield


app = FastAPI(title="Grok Video Backend", lifespan=lifespan)

# Only the real frontend (plus local dev) may call this API from a browser —
# a wildcard here would let any site push uploads into our S3 bucket.
# Override with a comma-separated CORS_ORIGINS env var if the domain changes.
CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS",
        "https://grok-video-studio-alpha.vercel.app,http://localhost:3000",
    ).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,   # no cookies/auth headers in use
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
WORK_DIR = os.path.join(BASE_DIR, "work")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(WORK_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

XAI_TTS_URL = "https://api.x.ai/v1/tts"
XAI_VIDEO_URL = "https://api.x.ai/v1/videos/generations"
XAI_VIDEO_STATUS_URL = "https://api.x.ai/v1/videos/{request_id}"
# Lip-sync model toggle for A/B testing (env-switchable, no code change):
#   sync/lipsync-2       — current default
#   bytedance/latentsync — alternative; explicitly supports animated characters
#                          (relevant for cartoon anchors like Pinky)
# Input schemas differ: both take {video, audio}, but sync_mode is
# lipsync-2-only — LatentSync has no such parameter (confirmed via Replicate
# schema mirrors; Replicate rejects unknown inputs).
LIPSYNC_MODEL = os.environ.get("LIPSYNC_MODEL", "sync/lipsync-2").strip()

# Resolve ffmpeg / ffprobe. In the Railway container the Dockerfile installs
# them on PATH, so shutil.which is all that runs. The winget fallback below is
# Windows-dev-only (fresh installs aren't on PATH until a new shell) — it's a
# no-op in the container because LOCALAPPDATA is unset.
def _resolve_binary(name):
    found = shutil.which(name)
    if found:
        return found
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        guess_root = os.path.join(local, "Microsoft", "WinGet", "Packages")
        if os.path.isdir(guess_root):
            for root, _dirs, files in os.walk(guess_root):
                if f"{name}.exe" in files:
                    return os.path.join(root, f"{name}.exe")
    return None


FFMPEG = _resolve_binary("ffmpeg")
FFPROBE = _resolve_binary("ffprobe")

RESOLUTION_DIMS = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
}

# --------------------------------------------------------------------------- #
# Optional S3 storage for uploads (durable — survives Railway redeploys).
# Enabled only when S3_BUCKET is set; otherwise uploads fall back to local
# /static (ephemeral). Credentials come from the standard AWS env vars
# (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION), set on Railway.
# --------------------------------------------------------------------------- #
S3_BUCKET = os.environ.get("S3_BUCKET", "").strip()
S3_REGION = (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "").strip()
S3_PREFIX = os.environ.get("S3_PREFIX", "uploads").strip().strip("/")
# If the bucket/objects are public (or fronted by CloudFront/a custom domain),
# set S3_PUBLIC_BASE_URL to get stable, non-expiring URLs. Otherwise we return
# a presigned GET URL that works against a private bucket (valid up to 7 days).
S3_OUTPUT_PREFIX = os.environ.get("S3_OUTPUT_PREFIX", "outputs").strip().strip("/")
S3_PUBLIC_BASE_URL = os.environ.get("S3_PUBLIC_BASE_URL", "").strip()
S3_URL_EXPIRY = int(os.environ.get("S3_URL_EXPIRY", "604800"))  # 7d = SigV4 max

_s3_client = None
_s3_region_resolved = None


def s3_enabled():
    return bool(S3_BUCKET)


def _detect_bucket_region():
    """Return the bucket's real region. S3 echoes `x-amz-bucket-region` in the
    response headers even on a 301/403, so this works with only Put/Get perms
    and self-corrects a wrong AWS_REGION."""
    import boto3
    from botocore.config import Config

    probe = boto3.client(
        "s3", region_name=S3_REGION or "us-east-1",
        config=Config(signature_version="s3v4"),
    )
    try:
        resp = probe.head_bucket(Bucket=S3_BUCKET)
        hdrs = resp["ResponseMetadata"]["HTTPHeaders"]
    except Exception as e:  # noqa: BLE001 - region header is present even on error
        hdrs = getattr(e, "response", {}).get("ResponseMetadata", {}).get("HTTPHeaders", {})
    return hdrs.get("x-amz-bucket-region")


def _get_s3():
    global _s3_client, _s3_region_resolved
    if _s3_client is None:
        import boto3  # lazy: only needed when S3 is configured
        from botocore.config import Config

        # Sign the bucket's actual region with SigV4 (required by regions created
        # after 2014, e.g. us-east-2; also accepted everywhere else).
        _s3_region_resolved = _detect_bucket_region() or S3_REGION or "us-east-1"
        # Pin the REGIONAL endpoint explicitly. Otherwise boto3 may presign
        # against the global host (s3.amazonaws.com); S3 then 307-redirects to
        # the regional host, and the redirect fails signature validation because
        # the signed host no longer matches.
        _s3_client = boto3.client(
            "s3",
            region_name=_s3_region_resolved,
            endpoint_url=f"https://s3.{_s3_region_resolved}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
    return _s3_client


def _s3_put(fileobj, key, content_type):
    """Upload a file object to S3 under `key` and return a fetchable URL (stable
    if a public base is configured, otherwise a presigned GET URL)."""
    client = _get_s3()
    client.upload_fileobj(
        fileobj, S3_BUCKET, key, ExtraArgs={"ContentType": content_type}
    )
    if S3_PUBLIC_BASE_URL:
        return f"{S3_PUBLIC_BASE_URL.rstrip('/')}/{key}"
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=S3_URL_EXPIRY,
    )


def store_upload_s3(fileobj, name, content_type):
    """Store a user-uploaded image under the uploads prefix."""
    return _s3_put(fileobj, f"{S3_PREFIX}/{name}" if S3_PREFIX else name, content_type)


def store_output_s3(fileobj, name, content_type):
    """Store a generated video under the outputs prefix."""
    return _s3_put(
        fileobj, f"{S3_OUTPUT_PREFIX}/{name}" if S3_OUTPUT_PREFIX else name, content_type
    )


def _storage_summary():
    """Describe the active storage backend — used by both the startup log and
    the /health route so the mode + prefixes are always visible."""
    if s3_enabled():
        return {
            "mode": "s3",
            "bucket": S3_BUCKET,
            "region": _s3_region_resolved or S3_REGION or "default",
            "uploads_prefix": f"{S3_PREFIX}/" if S3_PREFIX else "(root)",
            "outputs_prefix": f"{S3_OUTPUT_PREFIX}/" if S3_OUTPUT_PREFIX else "(root)",
            "url_mode": "public" if S3_PUBLIC_BASE_URL else "presigned",
            "presigned_expiry_seconds": None if S3_PUBLIC_BASE_URL else S3_URL_EXPIRY,
            "public_base_url": S3_PUBLIC_BASE_URL or None,
        }
    return {
        "mode": "local",
        "note": "ephemeral /static — set S3_BUCKET to persist across redeploys",
    }


class PipelineError(Exception):
    """Raised for any user-facing failure; carries an HTTP status code."""

    def __init__(self, message, status_code=500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class JobCancelled(Exception):
    """Raised at cancellation checkpoints when the user has requested a stop.
    Not an error — the pipeline converts it into a 'stopped' job status."""


# --------------------------------------------------------------------------- #
# ffmpeg helpers
# --------------------------------------------------------------------------- #
def _run(cmd, timeout=300):
    """Run a subprocess, raising PipelineError with stderr on failure.

    The timeout stops a hung ffmpeg from wedging a job as 'processing' forever
    (and permanently eating one of the few worker slots)."""
    try:
        # stdin=DEVNULL: ffmpeg polls stdin for interactive commands and can
        # wedge when inherited from a non-interactive parent.
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise PipelineError(
            f"{os.path.basename(cmd[0])} timed out after {timeout}s"
        )
    if result.returncode != 0:
        raise PipelineError(
            f"Command failed ({os.path.basename(cmd[0])}): "
            f"{result.stderr.strip()[:400]}"
        )
    return result


def probe_duration(path):
    """Return media duration in seconds via ffprobe."""
    result = _run([
        FFPROBE, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ])
    try:
        return float(result.stdout.strip())
    except ValueError:
        raise PipelineError(f"Could not read duration of {os.path.basename(path)}")


def normalize_clip(src, dst, width, height):
    """Re-encode a clip to uniform codec/size/fps and STRIP audio, so clips from
    different sources (xAI + lipsync output) can be concatenated cleanly."""
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
    )
    _run([
        FFMPEG, "-y", "-i", src,
        "-an",                      # drop native (xAI) audio — we don't want it
        "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
        dst,
    ])


def still_to_video(image_path, dst, duration, width, height):
    """Hold a still image for `duration` seconds as a normalized video clip.
    Zero motion, no generative model — the original pixels, held. Output is
    already uniform (codec/size/fps) so it concats with normalized clips."""
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )
    _run([
        FFMPEG, "-y",
        "-loop", "1", "-i", image_path,
        "-t", f"{max(duration, 0.5):.3f}",
        "-vf", vf, "-r", "30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
        "-an", dst,
    ])


def fit_audio(src, dst, target_len):
    """Pad with silence (or trim) so the audio is exactly target_len seconds,
    normalized to pcm 24kHz mono so segments concat cleanly."""
    _run([
        FFMPEG, "-y", "-i", src,
        "-af", "apad",
        "-t", f"{max(target_len, 0.1):.3f}",
        "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1",
        dst,
    ])


def make_silence(dst, duration):
    """A silent wav of `duration` seconds (same format as fit_audio output)."""
    _run([
        FFMPEG, "-y",
        "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
        "-t", f"{max(duration, 0.1):.3f}",
        "-c:a", "pcm_s16le",
        dst,
    ])


def concat_clips(clip_paths, dst, work_dir):
    """Concatenate uniform clips (same codec/size/fps) with the concat demuxer.
    The list file goes in the job's work_dir so job cleanup removes it."""
    list_file = os.path.join(work_dir, f"concat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w") as fh:
        for p in clip_paths:
            # concat demuxer needs forward slashes / escaped paths
            fh.write(f"file '{p.replace(os.sep, '/')}'\n")
    _run([
        FFMPEG, "-y", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", dst,
    ])


def concat_audio(audio_paths, dst, work_dir):
    """Concatenate uniform wav segments (pcm 24kHz mono) into one narration."""
    list_file = os.path.join(work_dir, f"aconcat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w") as fh:
        for p in audio_paths:
            fh.write(f"file '{p.replace(os.sep, '/')}'\n")
    _run([
        FFMPEG, "-y", "-f", "concat", "-safe", "0",
        "-i", list_file,
        "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1",
        dst,
    ])


def overlay_audio(video_src, audio_src, dst):
    """Replace the video's audio with the full narration track (continuous audio).

    Deliberately NO -shortest: the full video must always survive. If narration
    is shorter than the combined video, audio simply ends early; -shortest would
    truncate trailing scenes to the narration's length.
    """
    _run([
        FFMPEG, "-y",
        "-i", video_src, "-i", audio_src,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        dst,
    ])


# --------------------------------------------------------------------------- #
# External API helpers
# --------------------------------------------------------------------------- #
def xai_tts(text, voice_id, api_key, dst):
    """Generate speech audio (mp3) via xAI TTS. Called once per scene with that
    scene's dialogue; the same voice_id keeps the voice consistent across calls.

    Docs: POST /v1/tts returns RAW audio bytes when with_timestamps is not set.
    """
    resp = requests.post(
        XAI_TTS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "text": text,                  # length validated in /generate (max 15,000)
            "language": "en",
            "voice_id": voice_id or "rex",
            "output_format": {"codec": "mp3", "sample_rate": 24000, "bit_rate": 128000},
        },
        timeout=120,
    )
    if not resp.ok:
        raise PipelineError(
            f"xAI TTS error ({resp.status_code}): {resp.text[:300]}",
            status_code=resp.status_code,
        )
    ctype = resp.headers.get("Content-Type", "")
    if "application/json" in ctype:
        # Only happens if the API returned an error envelope instead of audio.
        raise PipelineError(f"xAI TTS returned JSON, not audio: {resp.text[:300]}")
    with open(dst, "wb") as fh:
        fh.write(resp.content)
    return dst


def xai_generate_clip(image_url, prompt, duration, resolution, api_key,
                      cancel_check=None):
    """Kick off one image-to-video generation, poll to completion, return video URL.
    `cancel_check` (optional callable) is invoked each poll tick and may raise
    JobCancelled to abandon polling — the xAI generation itself continues
    server-side (credits are committed once started)."""
    payload = {
        "model": "grok-imagine-video",
        "prompt": prompt,
        # xAI expects an ImageUrl struct, not a bare string:
        # {"url": "..."} — sending the string raises "expected struct ImageUrl".
        "image": {"url": image_url},
        "duration": max(1, min(int(duration), 15)),
        "resolution": resolution,
    }
    start = requests.post(
        XAI_VIDEO_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    if not start.ok:
        raise PipelineError(
            f"xAI video error ({start.status_code}): {start.text[:300]}",
            status_code=start.status_code,
        )
    request_id = start.json().get("request_id")
    if not request_id:
        raise PipelineError(f"xAI video: no request_id in response: {start.text[:300]}")

    consecutive_failures = 0
    for _ in range(60):                        # up to ~5 min per clip
        if cancel_check:
            cancel_check()
        time.sleep(5)
        # Transient network blips / proxy errors / non-JSON bodies shouldn't
        # kill a multi-minute job — retry a few times before giving up.
        try:
            poll = requests.get(
                XAI_VIDEO_STATUS_URL.format(request_id=request_id),
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=30,
            )
        except requests.RequestException as e:
            consecutive_failures += 1
            if consecutive_failures >= 5:
                raise PipelineError(f"Lost contact with xAI while polling: {e}")
            continue
        if poll.status_code in (401, 403):
            # Auth won't fix itself — fail fast instead of spinning 5 minutes.
            raise PipelineError(
                f"xAI rejected the API key while polling ({poll.status_code})",
                status_code=poll.status_code,
            )
        try:
            data = poll.json()
        except ValueError:
            consecutive_failures += 1
            if consecutive_failures >= 5:
                raise PipelineError(
                    f"xAI poll kept returning non-JSON (HTTP {poll.status_code})"
                )
            continue
        consecutive_failures = 0
        status = data.get("status")
        if status == "done":
            url = (data.get("video") or {}).get("url")
            if not url:
                raise PipelineError("xAI video finished but returned no video.url")
            return url
        if status in ("failed", "expired"):
            raise PipelineError(f"xAI video generation {status}")
    raise PipelineError("Timed out waiting for xAI video generation", status_code=504)


def _resolve_lipsync_ref(client):
    """Return the ref to hand client.run().

    Official models (sync/lipsync-2) run by bare 'owner/name' via the
    /v1/models/{owner}/{name}/predictions endpoint. Community models
    (bytedance/latentsync) 404 on that endpoint and must be called with a
    version hash via /v1/predictions — so resolve the latest version at
    runtime for anything that isn't the official default. Set LIPSYNC_MODEL to
    'owner/name:version' to pin a specific version instead.
    """
    if ":" in LIPSYNC_MODEL:
        return LIPSYNC_MODEL                     # version explicitly pinned
    if LIPSYNC_MODEL == "sync/lipsync-2":
        return LIPSYNC_MODEL                     # official — bare name works
    try:
        model = client.models.get(LIPSYNC_MODEL)
        version_id = getattr(getattr(model, "latest_version", None), "id", None)
    except Exception as e:  # noqa: BLE001 - surface a clear lookup failure
        raise PipelineError(f"Could not look up '{LIPSYNC_MODEL}' on Replicate: {e}")
    if not version_id:
        raise PipelineError(
            f"Replicate model '{LIPSYNC_MODEL}' has no resolvable version."
        )
    return f"{LIPSYNC_MODEL}:{version_id}"


def replicate_lipsync(video_path, audio_path, replicate_api_key, out_dir):
    """Run the configured lip-sync model on Replicate. The client uploads the
    local files for us. The output lands in the job's out_dir so job cleanup
    removes it.

    Inputs are built per model — the two schemas are NOT identical:
      sync/lipsync-2: {video, audio, sync_mode} (sync_mode='silence' preserves
        the video length by padding the shorter track)
      bytedance/latentsync: {video, audio} only (no sync_mode; passing unknown
        inputs would be rejected)
    """
    client = replicate.Client(api_token=replicate_api_key)
    ref = _resolve_lipsync_ref(client)   # bare name for official, +version for community
    with open(video_path, "rb") as vf, open(audio_path, "rb") as af:
        if LIPSYNC_MODEL == "bytedance/latentsync":
            model_input = {"video": vf, "audio": af}
        else:  # sync/lipsync-2 (default) — existing path, unchanged
            model_input = {"video": vf, "audio": af, "sync_mode": "silence"}
        output = client.run(ref, input=model_input)
    if isinstance(output, list):
        output = output[0] if output else None
    if output is None:
        raise PipelineError("Replicate lipsync returned no output")

    dst = os.path.join(out_dir, f"lipsync_{uuid.uuid4().hex}.mp4")
    # replicate>=1.0 returns a FileOutput (has .read()); older/raw may be a URL str.
    if hasattr(output, "read"):
        with open(dst, "wb") as fh:
            fh.write(output.read())
    else:
        _download(str(output), dst)
    return dst


def _download(url, dst):
    resp = requests.get(url, timeout=300, stream=True)
    if not resp.ok:
        raise PipelineError(f"Failed to download {url[:120]} ({resp.status_code})")
    with open(dst, "wb") as fh:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            fh.write(chunk)
    return dst


def _ext_from_url(url):
    """Best-effort image extension from a URL path (ffmpeg probes content
    anyway; this just keeps filenames sensible)."""
    path = url.split("?", 1)[0]
    ext = os.path.splitext(path)[1].lower()
    return ext if ext in ALLOWED_IMAGE_EXTS else ".png"


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/")
@app.get("/health")
async def root():
    return {
        "status": "Grok Video Backend is running!",
        "ffmpeg": bool(FFMPEG),
        "ffprobe": bool(FFPROBE),
        "s3": s3_enabled(),
        "storage": _storage_summary(),
        "lipsync_model": LIPSYNC_MODEL,
    }


ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
MIME_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
}
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024


@app.post("/upload")
def upload(request: Request, file: UploadFile = File(...)):
    """Store an uploaded image and return a publicly fetchable URL.

    Uses S3 when configured (durable, survives redeploys); otherwise falls back
    to local /static (ephemeral). The frontend calls this on scene-image
    selection so /generate receives a real URL — xAI cannot fetch browser blob:.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        return JSONResponse(
            {"status": "error",
             "message": f"Unsupported image type '{ext}'. Allowed: "
                        f"{', '.join(sorted(ALLOWED_IMAGE_EXTS))}"},
            status_code=400,
        )

    # Enforce the size cap by reading at most cap+1 bytes — never trust the
    # client's Content-Length. Cap is small enough to buffer in memory.
    try:
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        file.file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {"status": "error",
             "message": f"Image too large — max {MAX_UPLOAD_MB} MB."},
            status_code=413,
        )

    name = f"upload_{uuid.uuid4().hex}{ext}"
    content_type = MIME_BY_EXT.get(ext, "application/octet-stream")
    try:
        if s3_enabled():
            url = store_upload_s3(io.BytesIO(data), name, content_type)
            storage = "s3"
        else:
            dst = os.path.join(STATIC_DIR, name)
            with open(dst, "wb") as fh:
                fh.write(data)
            url = f"{str(request.base_url).rstrip('/')}/static/{name}"
            storage = "local"
    except Exception as e:  # noqa: BLE001 - surface storage failures clearly
        return JSONResponse(
            {"status": "error", "message": f"Upload storage failed: {e}"},
            status_code=502,
        )

    return {"status": "success", "url": url, "filename": name, "storage": storage}


# --------------------------------------------------------------------------- #
# Async job store — /generate starts a background worker and returns a job_id
# immediately; the client polls /status/{job_id}. The full pipeline takes
# minutes, well past Railway/Vercel proxy timeouts for a single request.
# In-memory dict is fine for one instance (no DB yet); jobs reset on restart.
# --------------------------------------------------------------------------- #
JOBS = {}
_jobs_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2)

# Failed jobs keep their work dir (completed scene clips + audio) so a retry can
# resume from where it died instead of re-paying for succeeded xAI/Replicate
# calls. Retained for RETENTION_SECONDS, then reaped. Note: this is local disk,
# so a Railway redeploy/restart wipes it — retry then falls back to full regen.
# Keys are NEVER retained (re-supplied on retry); only non-sensitive inputs are.
RETENTION_SECONDS = 24 * 3600
RETAINED = {}   # job_id -> {job_work, failed_at, scene_list, voice_id, resolution, character_description}


def _set_job(jid, **fields):
    with _jobs_lock:
        JOBS.setdefault(jid, {}).update(fields)


def _get_job(job_id):
    with _jobs_lock:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def _retain_failed(job_id, job_work, scene_list, voice_id, resolution,
                   character_description):
    with _jobs_lock:
        RETAINED[job_id] = {
            "job_work": job_work, "failed_at": time.time(),
            "scene_list": scene_list, "voice_id": voice_id,
            "resolution": resolution, "character_description": character_description,
        }


def _reap_retained():
    """Background sweep: drop retained failed-job work dirs past the window."""
    while True:
        time.sleep(3600)
        cutoff = time.time() - RETENTION_SECONDS
        with _jobs_lock:
            expired = [(jid, r["job_work"]) for jid, r in RETAINED.items()
                       if r["failed_at"] < cutoff]
            for jid, _ in expired:
                RETAINED.pop(jid, None)
        for _, work in expired:
            shutil.rmtree(work, ignore_errors=True)


def _is_cancelled(jid):
    return bool((_get_job(jid) or {}).get("cancel_requested"))


def _check_cancel(jid):
    """Cooperative cancellation checkpoint — threads can't be killed, so the
    pipeline calls this between steps and lets in-flight API calls drain."""
    if _is_cancelled(jid):
        raise JobCancelled()


def _valid_media(path):
    """True if a file exists and ffprobe reads a positive duration — guards
    against partial/corrupt files left by a crashed run when reusing on retry."""
    try:
        return os.path.exists(path) and probe_duration(path) > 0
    except PipelineError:
        return False


def _process_scene(job_id, idx, scene, job_work, width, height, resolution,
                   api_key, replicate_api_key, voice_id, character_description,
                   reuse=False):
    """Produce a normalized clip + exactly-matching audio wav for one scene.

    Character scenes: per-scene TTS (measured) -> xAI image-to-video sized to
    the speech -> Replicate lip-sync with that scene's audio.
    B-roll scenes: the still image held for exactly the speech length via
    ffmpeg — the generative model is never involved, so graphs/text stay
    pixel-perfect. Runs concurrently with other scenes (all independent).

    reuse=True (retry): skip any step whose output already exists and is valid,
    so already-paid xAI TTS/video results are not regenerated.
    """
    norm = os.path.join(job_work, f"scene{idx}_norm.mp4")
    seg = os.path.join(job_work, f"scene{idx}_audio.wav")
    speech = os.path.join(job_work, f"scene{idx}_speech.mp3")
    raw_clip = os.path.join(job_work, f"scene{idx}_raw.mp4")

    # Fully finished last time — nothing to redo, no credits spent.
    if reuse and _valid_media(norm) and _valid_media(seg):
        return {"idx": idx, "clip": norm, "audio": seg}

    _check_cancel(job_id)   # don't start work for a stopped job
    dialogue = (scene.get("dialogue") or "").strip()
    is_char = bool(scene.get("isCharacterScene"))

    # --- speech for this scene (reused if already generated) --------------- #
    speech_len = 0.0
    if dialogue:
        if not (reuse and _valid_media(speech)):
            xai_tts(dialogue, voice_id, api_key, speech)
        speech_len = probe_duration(speech)

    if is_char:
        if dialogue and speech_len > 15.0:
            raise PipelineError(
                f"Scene {idx + 1}: dialogue runs {speech_len:.1f}s of speech, "
                "but character clips are capped at 15s (xAI limit). Split the "
                "dialogue across two scenes."
            )
        # Reuse the already-generated xAI clip if present (skip straight to
        # lip-sync); otherwise generate it.
        if not (reuse and _valid_media(raw_clip)):
            clip_secs = math.ceil(speech_len) if dialogue else scene.get("duration", 8)
            desc = (character_description or "").strip()
            prompt = (
                (f"{desc} " if desc else "")
                + "A character speaking naturally to camera, subtle head and "
                "body motion, professional demeanor."
            )
            _check_cancel(job_id)   # about to spend an xAI video generation
            clip_url = xai_generate_clip(
                scene["image_url"], prompt, clip_secs, resolution, api_key,
                cancel_check=lambda: _check_cancel(job_id),
            )
            _download(clip_url, raw_clip)
        if dialogue:
            _check_cancel(job_id)   # about to spend a Replicate lip-sync run
            source = replicate_lipsync(raw_clip, speech, replicate_api_key, job_work)
        else:
            source = raw_clip
        normalize_clip(source, norm, width, height)
    else:
        # B-roll: hold the original image — zero motion, no regeneration.
        img = os.path.join(job_work, f"scene{idx}_img{_ext_from_url(scene['image_url'])}")
        if not (reuse and os.path.exists(img)):
            _download(scene["image_url"], img)
        hold = speech_len if dialogue else max(1.0, min(60.0, float(scene.get("duration") or 8)))
        still_to_video(img, norm, hold, width, height)

    # --- audio segment fitted to EXACTLY the clip's length ----------------- #
    # This is what keeps concatenated narration and video aligned 1:1.
    clip_len = probe_duration(norm)
    if dialogue:
        fit_audio(speech, seg, clip_len)
    else:
        make_silence(seg, clip_len)
    return {"idx": idx, "clip": norm, "audio": seg}


def _run_pipeline(job_id, base_url, api_key, replicate_api_key,
                  scene_list, voice_id, resolution, character_description,
                  reuse=False):
    """Concurrent per-scene processing -> assembly -> upload.
    Runs in a background thread; progress + result are written to JOBS.
    reuse=True resumes a retried job from its retained work dir."""
    job_work = os.path.join(WORK_DIR, job_id)
    n = len(scene_list)
    retain = False   # keep work dir for retry when the job fails

    # Elapsed / per-stage timing. t0 anchors to started_at (set at submission)
    # so total elapsed includes any queue wait; each `stage()` closes out the
    # previous stage's duration into `timings`.
    t0 = (_get_job(job_id) or {}).get("started_at") or time.time()
    timings = []
    _cur = {"name": None, "t": t0}

    def stage(name):
        now = time.time()
        if _cur["name"]:
            timings.append({"stage": _cur["name"], "seconds": round(now - _cur["t"], 1)})
        _cur["name"] = name
        _cur["t"] = now
        _set_job(job_id, stage=name, elapsed_seconds=round(now - t0, 1),
                 stage_timings=list(timings))

    def close_last_stage():
        now = time.time()
        if _cur["name"]:
            timings.append({"stage": _cur["name"], "seconds": round(now - _cur["t"], 1)})
            _cur["name"] = None

    try:
        os.makedirs(job_work, exist_ok=True)
        width, height = RESOLUTION_DIMS.get(resolution, RESOLUTION_DIMS["720p"])

        # --- 1. process all scenes concurrently (they're independent) ------- #
        # Character scenes: TTS -> xAI video -> lip-sync. B-roll: TTS + a held
        # still (no generative model). Each returns a clip + matching audio.
        stage(f"Processing {n} scene{'s' if n != 1 else ''} (speech, clips, lip-sync)")
        results = [None] * n
        done_count = 0
        cancelled = False
        with ThreadPoolExecutor(max_workers=3) as scene_pool:
            futures = {
                scene_pool.submit(
                    _process_scene, job_id, idx, scene, job_work, width, height,
                    resolution, api_key, replicate_api_key, voice_id,
                    character_description, reuse,
                ): idx
                for idx, scene in enumerate(scene_list)
            }
            for fut in as_completed(futures):
                try:
                    res = fut.result()
                except (JobCancelled, CancelledError):
                    cancelled = True
                    continue          # keep draining in-flight scenes
                except Exception:
                    for f in futures:
                        f.cancel()   # skip scenes that haven't started yet
                    raise
                results[res["idx"]] = res
                done_count += 1
                # Progress label only — not a new timing stage.
                _set_job(job_id, stage=f"Processing scenes ({done_count}/{n} done)")
                if _is_cancelled(job_id):
                    cancelled = True
                    for f in futures:
                        f.cancel()   # unstarted scenes never run

        if cancelled or _is_cancelled(job_id):
            close_last_stage()
            _set_job(
                job_id, status="stopped", stage="Stopped",
                scenes_completed=done_count, scene_count=n,
                elapsed_seconds=round(time.time() - t0, 1),
                stage_timings=list(timings),
                message=f"Stopped — {done_count} of {n} scenes had completed.",
            )
            return

        # --- 2. assemble: video concat + narration concat ------------------- #
        # Each scene's audio was fitted to exactly its clip's length, so the
        # concatenated narration lines up with the concatenated video 1:1.
        stage("Combining clips + narration")
        combined_silent = os.path.join(job_work, "combined_silent.mp4")
        concat_clips([r["clip"] for r in results], combined_silent, job_work)
        narration = os.path.join(job_work, "narration.wav")
        concat_audio([r["audio"] for r in results], narration, job_work)
        narration_len = probe_duration(narration)

        final_name = f"{job_id}.mp4"
        if s3_enabled():
            # Render into work dir, upload to S3 (durable), let finally clean up.
            stage("Uploading final video")
            final_path = os.path.join(job_work, final_name)
            overlay_audio(combined_silent, narration, final_path)
            with open(final_path, "rb") as fh:
                video_url = store_output_s3(fh, final_name, "video/mp4")
            storage = "s3"
        else:
            # Ephemeral: served from /static until the container restarts.
            final_path = os.path.join(STATIC_DIR, final_name)
            overlay_audio(combined_silent, narration, final_path)
            video_url = f"{base_url.rstrip('/')}/static/{final_name}"
            storage = "local"

        close_last_stage()
        with _jobs_lock:
            RETAINED.pop(job_id, None)   # a prior retained failure is now resolved
        _set_job(
            job_id, status="done", stage="Done", video_url=video_url,
            storage=storage, narration_seconds=round(narration_len, 2),
            scene_count=n, elapsed_seconds=round(time.time() - t0, 1),
            stage_timings=list(timings),
            message="Video generated with continuous narration + lip-sync",
        )
    except JobCancelled:
        close_last_stage()
        _set_job(job_id, status="stopped", stage="Stopped", message="Stopped.",
                 elapsed_seconds=round(time.time() - t0, 1), stage_timings=list(timings))
    except PipelineError as e:
        failed_stage = _cur["name"] or (timings[-1]["stage"] if timings else "Unknown")
        close_last_stage()   # record the failing stage's duration too
        _set_job(job_id, status="error", stage="Error", message=e.message,
                 failed_stage=failed_stage,
                 elapsed_seconds=round(time.time() - t0, 1), stage_timings=list(timings))
        _retain_failed(job_id, job_work, scene_list, voice_id, resolution,
                       character_description)
        retain = True
    except Exception as e:  # noqa: BLE001 - surface anything unexpected clearly
        failed_stage = _cur["name"] or (timings[-1]["stage"] if timings else "Unknown")
        close_last_stage()
        _set_job(job_id, status="error", stage="Error", message=f"Unexpected error: {e}",
                 failed_stage=failed_stage,
                 elapsed_seconds=round(time.time() - t0, 1), stage_timings=list(timings))
        _retain_failed(job_id, job_work, scene_list, voice_id, resolution,
                       character_description)
        retain = True
    finally:
        # Keep the work dir only for a failed job (so retry can resume); the
        # reaper drops it after RETENTION_SECONDS. Success/stop clean up now
        # (the final video is already in /static or S3).
        if not retain:
            shutil.rmtree(job_work, ignore_errors=True)


@app.post("/generate")
def generate(
    request: Request,
    script: str = Form(""),   # legacy — narration now comes from per-scene dialogue
    api_key: str = Form(...),
    replicate_api_key: str = Form(...),
    scenes: str = Form(...),
    voice_id: str = Form("rex"),
    resolution: str = Form("720p"),
    character_description: str = Form(""),
):
    """Validate input, start the pipeline in the background, return a job_id.
    The heavy work runs for minutes (past proxy timeouts), so the client polls
    /status/{job_id} rather than waiting on this request."""
    # --- fast synchronous validation: immediate error on bad input --------- #
    if not FFMPEG or not FFPROBE:
        return JSONResponse(
            {"status": "error", "message": "ffmpeg/ffprobe not found on the server."},
            status_code=500,
        )
    try:
        scene_list = json.loads(scenes)
    except json.JSONDecodeError:
        return JSONResponse(
            {"status": "error", "message": "`scenes` was not valid JSON"},
            status_code=400,
        )
    if not isinstance(scene_list, list) or not scene_list:
        return JSONResponse(
            {"status": "error", "message": "`scenes` must be a non-empty array"},
            status_code=400,
        )
    has_character = any(s.get("isCharacterScene") for s in scene_list)
    if has_character and not (replicate_api_key or "").strip():
        return JSONResponse(
            {"status": "error",
             "message": "Replicate API key is required for character lip-sync scenes."},
            status_code=400,
        )
    missing_images = [i for i, s in enumerate(scene_list) if not s.get("image_url")]
    if missing_images:
        return JSONResponse(
            {"status": "error",
             "message": f"Scenes {missing_images} have no image_url. Each scene "
                        "needs a publicly reachable image URL."},
            status_code=400,
        )
    # Narration is generated per scene from its dialogue — reject jobs with no
    # spoken dialogue at all, and any single dialogue over the TTS call limit.
    dialogues = [(s.get("dialogue") or "").strip() for s in scene_list]
    if not any(dialogues):
        return JSONResponse(
            {"status": "error",
             "message": "No dialogue provided. Add dialogue to at least one "
                        "scene — narration is generated from scene dialogue."},
            status_code=400,
        )
    too_long = [i + 1 for i, d in enumerate(dialogues) if len(d) > 15000]
    if too_long:
        return JSONResponse(
            {"status": "error",
             "message": f"Dialogue too long in scene(s) {too_long} — max "
                        "15,000 chars per scene (xAI TTS limit)."},
            status_code=400,
        )

    # --- start the background pipeline, return the job handle -------------- #
    job_id = str(uuid.uuid4())
    _set_job(job_id, job_id=job_id, status="processing", stage="Queued",
             started_at=time.time(), elapsed_seconds=0.0)
    _executor.submit(
        _run_pipeline, job_id, str(request.base_url), api_key,
        replicate_api_key, scene_list, voice_id, resolution, character_description,
    )
    return JSONResponse({"job_id": job_id, "status": "processing"})


@app.post("/generate/{job_id}/retry")
def retry_job(
    request: Request,
    job_id: str,
    api_key: str = Form(...),
    replicate_api_key: str = Form(...),
):
    """Resume a failed job from where it died, reusing its already-completed
    scene clips/audio so succeeded xAI/Replicate calls aren't re-paid.

    Keys are re-supplied (never stored server-side). If the retained work is
    gone (past the 24h window, or wiped by a restart), returns 410 with
    recoverable=false so the client falls back to a full regeneration.
    """
    with _jobs_lock:
        retained = dict(RETAINED.get(job_id) or {})

    recoverable = bool(
        retained
        and os.path.isdir(retained.get("job_work", ""))
        and (time.time() - retained.get("failed_at", 0)) <= RETENTION_SECONDS
    )
    if not recoverable:
        return JSONResponse(
            {"status": "error", "recoverable": False,
             "message": "Previous work couldn't be recovered — this will "
                        "regenerate everything from scratch and use new credits."},
            status_code=410,
        )

    scene_list = retained["scene_list"]
    if any(s.get("isCharacterScene") for s in scene_list) and not (replicate_api_key or "").strip():
        return JSONResponse(
            {"status": "error",
             "message": "Replicate API key is required for character lip-sync scenes."},
            status_code=400,
        )

    # Reuse the SAME job_id + work dir; reset run state and resume.
    _set_job(job_id, status="processing", stage="Retrying — reusing completed work…",
             started_at=time.time(), elapsed_seconds=0.0, cancel_requested=False)
    with _jobs_lock:
        RETAINED.pop(job_id, None)   # re-added by _run_pipeline if it fails again
    _executor.submit(
        _run_pipeline, job_id, str(request.base_url), api_key, replicate_api_key,
        scene_list, retained["voice_id"], retained["resolution"],
        retained["character_description"], True,   # reuse=True
    )
    return JSONResponse({"job_id": job_id, "status": "processing", "recoverable": True})


@app.post("/cancel/{job_id}")
def cancel_job(job_id: str):
    """Request a cooperative stop. No new scene work starts after this;
    in-flight API calls drain (threads can't be killed), then /status flips
    to 'stopped' with a scenes-completed count."""
    job = _get_job(job_id)
    if job is None:
        return JSONResponse(
            {"status": "error", "message": "Unknown job_id"}, status_code=404
        )
    if job.get("status") != "processing":
        return {"status": job.get("status"), "message": "Job is not running."}
    _set_job(job_id, cancel_requested=True,
             stage="Stopping — finishing in-flight work…")
    return {"status": "cancelling",
            "message": "Stop requested — finishing in-flight work."}


@app.get("/status/{job_id}")
def job_status(job_id: str):
    """Poll a generation job: processing / done (video_url) / error (message).

    For a still-running job, elapsed_seconds is computed live so it keeps
    ticking up even during a long stage; for done/error it's the frozen total.
    """
    job = _get_job(job_id)
    if job is None:
        # Jobs live in memory, so a restart/redeploy mid-job loses them.
        return JSONResponse(
            {"status": "error",
             "message": "Job not found — the server may have restarted and "
                        "lost in-progress jobs. Please generate again."},
            status_code=404,
        )
    if job.get("status") == "processing" and job.get("started_at"):
        job["elapsed_seconds"] = round(time.time() - job["started_at"], 1)
    job.pop("started_at", None)   # internal timestamp; not useful to the client
    return job
