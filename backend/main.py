from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import uuid

app = FastAPI(title="Grok Video Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to your Vercel URL later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "Backend running - connect to xAI"}

@app.post("/generate")
async def generate(prompt: str = Form(...), api_key: str = Form(...)):
    # Here we will call xAI Imagine Video API
    job_id = str(uuid.uuid4())
    return {"job_id": job_id, "status": "started", "message": "Video generation in progress"}

# Add voice cloning and lip sync endpoints later
