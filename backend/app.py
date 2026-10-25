"""
Live Dressing - Backend API Server
Provides high-performance REST endpoints for the 'Live Dressing' Chrome Extension.
"""

import base64
from datetime import datetime, timezone
import io
import os
import time
import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image, ImageFile  # type: ignore

ImageFile.LOAD_TRUNCATED_IMAGES = True


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


# ==========================================
# Extension Session & Token Endpoints
# ==========================================

@app.api_route("/api/tokens", methods=["GET", "POST"])
async def get_tokens(request: Request):
    """
    Session token dispenser for Live Dressing Chrome Extension.
    Called by widget.bundle.js fetchDecartToken().
    """
    now = time.time()
    issued_at = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
    # 7-day expiration so the session stays active
    expires_at = datetime.fromtimestamp(now + 86400 * 7, tz=timezone.utc).isoformat()

    return {
        "apiKey": f"ld_live_session_{int(now)}",
        "expiresAt": expires_at,
        "issuedAt": issued_at,
        "modelName": "live-dressing-v1",
        "webrtcConnectTimeoutSeconds": 60,
        "decartQueueSilenceTimeoutSeconds": 60,
        "sessionInactivitySeconds": 300,
        "firstAiFrameTimeoutSeconds": 15,
        "billing_enabled": False,
        "status": "active",
    }


@app.api_route("/api/queue/join", methods=["GET", "POST"])
async def queue_join(request: Request):
    """
    Direct admission queue: bypasses waiting rooms with immediate active status.
    """
    now = time.time()
    issued_at = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
    expires_at = datetime.fromtimestamp(now + 86400 * 7, tz=timezone.utc).isoformat()

    return {
        "status": "active",
        "ticket_id": f"ld_ticket_{int(now)}",
        "position": 0,
        "poll_ms": 1000,
        "token": {
            "apiKey": f"ld_live_session_{int(now)}",
            "expiresAt": expires_at,
            "issuedAt": issued_at,
            "modelName": "live-dressing-v1",
        },
    }


@app.api_route("/api/queue/status", methods=["GET", "POST"])
def queue_status():
    return {"status": "active", "position": 0}


@app.api_route("/api/queue/heartbeat", methods=["GET", "POST"])
def queue_heartbeat():
    return {"status": "ok"}


@app.api_route("/api/queue/leave", methods=["GET", "POST"])
def queue_leave():
    return {"status": "ok"}


# ==========================================
# Image Proxy Endpoint
# ==========================================

@app.get("/api/proxy-image")
def proxy_image(url: str = ""):
    """
    CORS proxy for product images from Zara, Uniqlo, etc.
    Allows clothing textures to be processed without browser canvas tainting.
    """
    if not url:
        raise HTTPException(status_code=400, detail="Missing image url parameter")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        resp = requests.get(url, headers=headers, timeout=12)
        content_type = resp.headers.get("content-type", "image/jpeg")
        return Response(
            content=resp.content,
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=86400",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image proxy error: {str(e)}")


# ==========================================
# Free Tier & Billing Shield Endpoints
# ==========================================

@app.api_route("/api/consumer-billing/status", methods=["GET", "POST"])
def billing_status():
    return {
        "status": "active",
        "billing_enabled": False,
        "unlimited": True,
        "subscribed": True,
        "free_pass_available": 9999,
        "free_pass_remaining": 9999,
        "tryon_sessions": 9999,
    }


@app.api_route("/api/consumer-billing/heartbeat", methods=["GET", "POST"])
def billing_heartbeat():
    return {"status": "active", "billing_enabled": False}


@app.api_route("/api/log", methods=["GET", "POST"])
def api_log():
    return {"status": "ok"}


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
        tryon_result = run_virtual_tryon(
            human_image=user_img,
            garment_image=garment_img,
            category=payload.category,
        )
        result_img = tryon_result["composite"]
        clean_garment = tryon_result["garment_png"]
        pos_info = tryon_result["position"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference error: {str(e)}")

    # 4. Encode result image to base64
    buffered = io.BytesIO()
    result_img.save(buffered, format="JPEG", quality=92)
    b64_output = base64.b64encode(buffered.getvalue()).decode("utf-8")
    data_uri = f"data:image/jpeg;base64,{b64_output}"

    # 5. Encode clean garment transparent PNG to base64
    g_buffered = io.BytesIO()
    clean_garment.save(g_buffered, format="PNG")
    b64_garment = base64.b64encode(g_buffered.getvalue()).decode("utf-8")
    garment_uri = f"data:image/png;base64,{b64_garment}"

    elapsed_ms = round((time.time() - start_time) * 1000)

    return {
        "status": "success",
        "image": data_uri,
        "garment_png": garment_uri,
        "position": pos_info,
        "processing_time_ms": elapsed_ms,
        "device": get_system_status()["mode"],
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    uvicorn.run("app:app", host=host, port=port, reload=False)
