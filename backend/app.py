"""
Live Dressing - Backend API Entry Point
Re-exports the complete FastAPI app from server.py (with MediaPipe Pose skeletal warping,
multi-point exclusion masks, ambient lighting matching, and WebSocket streaming /ws/tryon).
"""
import sys
sys.dont_write_bytecode = True
import os
import uvicorn
from server import (
    app,
    pose_tracker,
    isolate_garment_alpha,
    warp_and_blend_garment,
    fetch_garment_image,
    TryOnPayload,
)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    uvicorn.run("app:app", host=host, port=port, reload=False)
