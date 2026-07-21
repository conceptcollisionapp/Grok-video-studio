from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uuid
import requests

app = FastAPI(title="Grok Video Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "Backend running"}

@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    api_key: str = Form(...),
    voice_id: str = Form('default'),
    resolution: str = Form('720p')
):
    job_id = str(uuid.uuid4())
    try:
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "prompt": prompt,
            "model": "grok-imagine-video-1.5",
            "resolution": resolution,
            "voice_id": voice_id
        }
        response = requests.post("https://api.x.ai/v1/video/generate", json=payload, headers=headers, timeout=60)
        result = response.json()
        return JSONResponse({
            "job_id": job_id,
            "status": "success",
            "video_url": result.get("url"),
            "message": "Video generated"
        })
    except Exception as e:
        return JSONResponse({"job_id": job_id, "status": "error", "message": str(e)}, status_code=500)
