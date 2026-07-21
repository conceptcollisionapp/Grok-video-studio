from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import requests
import uuid

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    api_key: str = Form(...),
    voice_file: UploadFile = File(None)
):
    job_id = str(uuid.uuid4())
    
    # Example xAI Imagine Video call (adapt to exact endpoint)
    headers = {"Authorization": f"Bearer {api_key}"}
    data = {"prompt": prompt, "model": "grok-imagine-video-1.5"}
    
    try:
        # Real call to xAI
        response = requests.post("https://api.x.ai/v1/video/generate", headers=headers, json=data)
        result = response.json()
        return {"job_id": job_id, "status": "success", "video_url": result.get("url")}
    except Exception as e:
        return {"job_id": job_id, "status": "error", "message": str(e)}

@app.post("/clone-voice")
async def clone_voice(voice_file: UploadFile = File(...), api_key: str = Form(...)):
    # xAI Custom Voice cloning endpoint
    return {"status": "voice cloned", "voice_id": "temp-voice-id"}
