"""
Live Dressing - Backend API Server
Provides high-performance REST endpoints for the 'Live Dressing' Chrome Extension.
"""

import base64
import io
import os
import time
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image  # type: ignore

from model_pipeline import (
    run_virtual_tryon,
    fetch_garment_image,
    get_system_status,
)

app = FastAPI(
    title="Live Dressing AI Engine",
    description="Virtual Try-On inference API for the Live Dressing browser extension",
    version="1.0.0",
)

# Allow CORS for Chrome Extension origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TryOnPayload(BaseModel):
    user_image: str = Field(..., description="Base64 data URI of the user photo / webcam frame")
    garment_url: str = Field(..., description="URL or base64 data URI of the clothing item")
    category: str = Field("upper_body", description="Garment category: 'upper_body', 'lower_body', or 'dress'")


@app.get("/")
def index():
    return {
        "service": "Live Dressing AI Engine",
        "version": "1.0.0",
        "docs": "/docs",
        "system": get_system_status(),
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "hardware": get_system_status(),
    }


@app.post("/api/tryon")
async def api_try_on(payload: TryOnPayload):
    start_time = time.time()

    # 1. Decode user image
    try:
        raw_b64 = payload.user_image
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]
        user_img_bytes = base64.b64decode(raw_b64)
        user_img = Image.open(io.BytesIO(user_img_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode user image: {str(e)}")

    # 2. Fetch garment image
    try:
        garment_img = fetch_garment_image(payload.garment_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch garment image: {str(e)}")

    # 3. Run Virtual Try-On Pipeline
    try:
        result_img = run_virtual_tryon(
            human_image=user_img,
            garment_image=garment_img,
            category=payload.category,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference error: {str(e)}")

    # 4. Encode result image to base64
    buffered = io.BytesIO()
    result_img.save(buffered, format="JPEG", quality=92)
    b64_output = base64.b64encode(buffered.getvalue()).decode("utf-8")
    data_uri = f"data:image/jpeg;base64,{b64_output}"

    elapsed_ms = round((time.time() - start_time) * 1000)

    return {
        "status": "success",
        "image": data_uri,
        "processing_time_ms": elapsed_ms,
        "device": get_system_status()["mode"],
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    uvicorn.run("app:app", host=host, port=port, reload=False)
