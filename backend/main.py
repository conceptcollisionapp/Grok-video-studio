"""
Grok Video Studio backend.

Pipeline (/generate):
  1. xAI TTS  -> one continuous narration audio file for the whole script.
  2. xAI Grok Imagine -> one image-to-video clip per scene.
  3. Character scenes -> Replicate sync/lipsync-2, each paired with its slice of
     the narration (trimmed by cumulative scene timestamps). B-roll scenes are
     left untouched (they still get pan/zoom motion from the video prompt).
  4. ffmpeg -> concatenate all clips in order, then overlay the FULL narration
     audio over the whole thing so audio stays continuous even under b-roll.
  5. Save to /static and return its public URL.

Every external call below is based on real, current docs:
  - xAI TTS:   POST https://api.x.ai/v1/tts   (raw audio bytes unless with_timestamps)
  - xAI video: POST https://api.x.ai/v1/videos/generations  ->  GET /v1/videos/{id}
  - Replicate: POST https://api.replicate.com/v1/models/sync/lipsync-2/predictions
               (handled via the `replicate` client for automatic file upload)
"""

import json
import os
import shutil
import subprocess
import time
import uuid

import requests
import replicate
from fastapi import FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Grok Video Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
REPLICATE_LIPSYNC_MODEL = "sync/lipsync-2"

# xAI forbids combining reference images with image-to-video ("Only one mode can
# be active per request"), so character_reference_urls is NOT sent to the video
# endpoint. Instead, keep the character consistent across scenes by prepending
# this fixed description to every character-scene prompt. EDIT THIS to match the
# actual on-camera character you want.
CHARACTER_DESCRIPTION = (
    "The same on-camera news anchor in every shot: a professional adult presenter "
    "with neat short dark hair, wearing a dark navy suit and tie, seated at a "
    "modern broadcast news desk."
)

# Resolve ffmpeg / ffprobe. winget installs them onto PATH after a shell restart;
# if this backend was started from an older shell they may not be visible yet, so
# we also probe the known winget install location before giving up.
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


class PipelineError(Exception):
    """Raised for any user-facing failure; carries an HTTP status code."""

    def __init__(self, message, status_code=500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# --------------------------------------------------------------------------- #
# ffmpeg helpers
# --------------------------------------------------------------------------- #
def _run(cmd):
    """Run a subprocess, raising PipelineError with stderr on failure."""
    result = subprocess.run(cmd, capture_output=True, text=True)
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


def slice_audio(src, start, duration, dst):
    """Cut [start, start+duration] from the narration into its own wav file."""
    _run([
        FFMPEG, "-y",
        "-i", src,
        "-ss", f"{start:.3f}", "-t", f"{max(duration, 0.1):.3f}",
        "-c:a", "pcm_s16le", "-ar", "24000",
        dst,
    ])


def concat_clips(clip_paths, dst):
    """Concatenate uniform clips (same codec/size/fps) with the concat demuxer."""
    list_file = os.path.join(WORK_DIR, f"concat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w") as fh:
        for p in clip_paths:
            # concat demuxer needs forward slashes / escaped paths
            fh.write(f"file '{p.replace(os.sep, '/')}'\n")
    _run([
        FFMPEG, "-y", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", dst,
    ])


def overlay_audio(video_src, audio_src, dst):
    """Replace the video's audio with the full narration track (continuous audio)."""
    _run([
        FFMPEG, "-y",
        "-i", video_src, "-i", audio_src,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        dst,
    ])


# --------------------------------------------------------------------------- #
# External API helpers
# --------------------------------------------------------------------------- #
def xai_tts(text, voice_id, api_key, dst):
    """Generate one continuous narration mp3 via xAI TTS. Returns dst on success.

    Docs: POST /v1/tts returns RAW audio bytes when with_timestamps is not set.
    """
    resp = requests.post(
        XAI_TTS_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "text": text[:15000],          # documented max length
            "language": "en",
            "voice_id": voice_id or "eve",
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


def xai_generate_clip(image_url, prompt, duration, resolution, api_key):
    """Kick off one image-to-video generation, poll to completion, return video URL."""
    payload = {
        "model": "grok-imagine-video",
        "prompt": prompt,
        "image": image_url,                    # image-to-video source (URL string)
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

    for _ in range(60):                        # up to ~5 min per clip
        time.sleep(5)
        poll = requests.get(
            XAI_VIDEO_STATUS_URL.format(request_id=request_id),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        data = poll.json()
        status = data.get("status")
        if status == "done":
            url = (data.get("video") or {}).get("url")
            if not url:
                raise PipelineError("xAI video finished but returned no video.url")
            return url
        if status in ("failed", "expired"):
            raise PipelineError(f"xAI video generation {status}")
    raise PipelineError("Timed out waiting for xAI video generation", status_code=504)


def replicate_lipsync(video_path, audio_path, replicate_api_key):
    """Run sync/lipsync-2 on Replicate. The client uploads the local files for us.

    sync_mode='silence' preserves the video length (pads the shorter track),
    so a scene clip keeps its duration even if its audio slice is a bit short.
    """
    client = replicate.Client(api_token=replicate_api_key)
    with open(video_path, "rb") as vf, open(audio_path, "rb") as af:
        output = client.run(
            REPLICATE_LIPSYNC_MODEL,
            input={"video": vf, "audio": af, "sync_mode": "silence"},
        )
    if isinstance(output, list):
        output = output[0] if output else None
    if output is None:
        raise PipelineError("Replicate lipsync returned no output")

    dst = os.path.join(WORK_DIR, f"lipsync_{uuid.uuid4().hex}.mp4")
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


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/")
async def root():
    return {
        "status": "Grok Video Backend is running!",
        "ffmpeg": bool(FFMPEG),
        "ffprobe": bool(FFPROBE),
    }


@app.post("/generate")
def generate(
    request: Request,
    script: str = Form(...),
    api_key: str = Form(...),
    replicate_api_key: str = Form(...),
    scenes: str = Form(...),
    voice_id: str = Form("eve"),
    resolution: str = Form("720p"),
    character_reference_urls: str = Form("[]"),
):
    job_id = str(uuid.uuid4())
    job_work = os.path.join(WORK_DIR, job_id)

    try:
        # --- preconditions ------------------------------------------------- #
        if not FFMPEG or not FFPROBE:
            raise PipelineError(
                "ffmpeg/ffprobe not found on the server. Install ffmpeg and ensure "
                "it is on PATH (restart the backend from a fresh shell after install).",
                status_code=500,
            )

        try:
            scene_list = json.loads(scenes)
        except json.JSONDecodeError:
            raise PipelineError("`scenes` was not valid JSON", status_code=400)
        if not isinstance(scene_list, list) or not scene_list:
            raise PipelineError("`scenes` must be a non-empty array", status_code=400)

        has_character = any(s.get("isCharacterScene") for s in scene_list)
        if has_character and not (replicate_api_key or "").strip():
            raise PipelineError(
                "Replicate API key is required for character lip-sync scenes.",
                status_code=400,
            )

        missing_images = [i for i, s in enumerate(scene_list) if not s.get("image_url")]
        if missing_images:
            raise PipelineError(
                f"Scenes {missing_images} have no image_url. The pipeline needs a "
                "publicly reachable image URL per scene (blob: URLs from the browser "
                "are not reachable by xAI's servers).",
                status_code=400,
            )

        os.makedirs(job_work, exist_ok=True)
        width, height = RESOLUTION_DIMS.get(resolution, RESOLUTION_DIMS["720p"])

        # --- 1. one continuous narration track ----------------------------- #
        narration = os.path.join(job_work, "narration.mp3")
        xai_tts(script, voice_id, api_key, narration)
        narration_len = probe_duration(narration)

        # --- 2..3. per-scene clip generation + lip-sync -------------------- #
        final_clips = []
        cursor = 0.0                           # running offset into the narration
        for idx, scene in enumerate(scene_list):
            is_char = bool(scene.get("isCharacterScene"))
            if is_char:
                # Prepend the fixed character description for cross-scene consistency
                # (reference images aren't allowed with image-to-video).
                prompt = (
                    f"{CHARACTER_DESCRIPTION} A character speaking naturally to "
                    "camera, subtle head and body motion, professional demeanor."
                )
            else:
                prompt = (
                    "Smooth subtle camera pan/zoom over this image, professional "
                    "broadcast b-roll style."
                )
            clip_url = xai_generate_clip(
                scene["image_url"], prompt, scene.get("duration", 8), resolution, api_key
            )
            raw_clip = os.path.join(job_work, f"scene{idx}_raw.mp4")
            _download(clip_url, raw_clip)
            clip_len = probe_duration(raw_clip)

            if is_char:
                # Pair this clip with its slice of the narration and lip-sync it.
                seg = os.path.join(job_work, f"scene{idx}_audio.wav")
                slice_audio(narration, cursor, clip_len, seg)
                synced = replicate_lipsync(raw_clip, seg, replicate_api_key)
                source_clip = synced
            else:
                source_clip = raw_clip           # b-roll: motion only, no lip-sync

            norm = os.path.join(job_work, f"scene{idx}_norm.mp4")
            normalize_clip(source_clip, norm, width, height)
            final_clips.append(norm)
            cursor += clip_len

        # --- 4. concat + overlay the FULL narration ------------------------ #
        combined_silent = os.path.join(job_work, "combined_silent.mp4")
        concat_clips(final_clips, combined_silent)

        final_name = f"{job_id}.mp4"
        final_path = os.path.join(STATIC_DIR, final_name)
        overlay_audio(combined_silent, narration, final_path)

        # --- 5. respond ---------------------------------------------------- #
        base = str(request.base_url).rstrip("/")
        return JSONResponse({
            "job_id": job_id,
            "status": "success",
            "video_url": f"{base}/static/{final_name}",
            "narration_seconds": round(narration_len, 2),
            "scene_count": len(scene_list),
            "message": "Video generated with continuous narration + lip-sync",
        })

    except PipelineError as e:
        return JSONResponse(
            {"job_id": job_id, "status": "error", "message": e.message},
            status_code=e.status_code,
        )
    except Exception as e:  # noqa: BLE001 - surface anything unexpected clearly
        return JSONResponse(
            {"job_id": job_id, "status": "error", "message": f"Unexpected error: {e}"},
            status_code=500,
        )
    finally:
        # keep /static output, drop intermediate work
        shutil.rmtree(job_work, ignore_errors=True)
