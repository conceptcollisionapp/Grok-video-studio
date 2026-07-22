from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uuid
import time
import requests

app = FastAPI(title="Grok Video Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICE_DESCRIPTIONS = {
    "default": "",
    "male-news": "AUDIO: confident professional male news anchor voice, clear enunciation. ",
    "female-clear": "AUDIO: clear warm female narrator voice. ",
    "energetic": "AUDIO: upbeat energetic voice with enthusiasm. "
}

@app.get("/")
async def root():
    return {"status": "Grok Video Backend is running!"}

@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    api_key: str = Form(...),
    voice_id: str = Form('default'),
    resolution: str = Form('720p')
):
    job_id = str(uuid.uuid4())

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        full_prompt = VOICE_DESCRIPTIONS.get(voice_id, "") + prompt

        payload = {
            "model": "grok-imagine-video",
            "prompt": full_prompt,
            "resolution": resolution
        }

        start_resp = requests.post(
            "https://api.x.ai/v1/videos/generations",
            json=payload,
            headers=headers,
            timeout=60
        )

        if not start_resp.ok:
            return JSONResponse({
                "job_id": job_id,
                "status": "error",
                "message": f"xAI API error ({start_resp.status_code}): {start_resp.text[:200]}"
            }, status_code=start_resp.status_code)

        request_id = start_resp.json().get("request_id")

        for _ in range(20):  # up to ~100s
            time.sleep(5)
            poll_resp = requests.get(
                f"https://api.x.ai/v1/videos/{request_id}",
                headers=headers,
                timeout=30
            )
            poll_data = poll_resp.json()
            status = poll_data.get("status")

            if status == "done":
                return JSONResponse({
                    "job_id": job_id,
                    "status": "success",
                    "video_url": poll_data.get("video", {}).get("url"),
                    "message": "Video generated with Grok Imagine"
                })
            elif status in ("failed", "expired"):
                return JSONResponse({
                    "job_id": job_id,
                    "status": "error",
                    "message": f"Generation {status}"
                }, status_code=500)

        return JSONResponse({
            "job_id": job_id,
            "status": "error",
            "message": "Timed out waiting for video generation"
        }, status_code=504)

    except Exception as e:
        return JSONResponse({
            "job_id": job_id,
            "status": "error",
            "message": str(e)
        }, status_code=500)
