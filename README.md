# Grok Video Studio

Full React + FastAPI app for Grok Imagine Video 1.5 with editing, audio, lip-sync.

## Setup
1. Backend: `pip install fastapi uvicorn python-multipart`
2. `uvicorn main:app --reload`
3. Frontend: `npm install && npm start`

Integrate xAI API key. Use FFmpeg for processing, MuseTalk for advanced lip-sync.
