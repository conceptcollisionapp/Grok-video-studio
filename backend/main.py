from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uuid
import requests

app = FastAPI(title="Grok Video Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "prompt": prompt,
            "model": "grok-imagine-video-1.5",
            "resolution": resolution,
            "voice_id": voice_id
        }
        
        response = requests.post("https://api.x.ai/v1/video/generate", json=payload, headers=headers, timeout=60)
        
        if not response.ok:
            return JSONResponse({
                "job_id": job_id,
                "status": "error",
                "message": f"xAI API error ({response.status_code}): {response.text[:200]}"
            }, status_code=response.status_code)
        
        result = response.json()
        return JSONResponse({
            "job_id": job_id,
            "status": "success",
            "video_url": result.get("url"),
            "message": "Video generated with Grok Imagine 1.5"
        })
    except Exception as e:
        return JSONResponse({
            "job_id": job_id,
            "status": "error",
            "message": str(e)
        }, status_code=500)        }
        
        response = requests.post("https://api.x.ai/v1/video/generate", json=payload, headers=headers, timeout=60)
        
        if response.status_code != 200:
            return JSONResponse({
                "job_id": job_id,
                "status": "error",
                "message": f"xAI API error: {response.text}"
            }, status_code=response.status_code)
        
        result = response.json()
        return JSONResponse({
            "job_id": job_id,
            "status": "success",
            "video_url": result.get("url"),
            "message": "Video generated with Grok Imagine 1.5"
        })
    except Exception as e:
        return JSONResponse({
            "job_id": job_id,
            "status": "error",
            "message": str(e)
        }, status_code=500)            "voice_id": voice_id
        }
        
        response = requests.post("https://api.x.ai/v1/video/generate", json=payload, headers=headers, timeout=60)
        result = response.json()
        
        return JSONResponse({
            "job_id": job_id,
            "status": "success",
            "video_url": result.get("url"),
            "message": "Video generated with Grok Imagine 1.5"
        })
    except Exception as e:
        return JSONResponse({"job_id": job_id, "status": "error", "message": str(e)}, status_code=500)

# Add voice cloning endpoint later
