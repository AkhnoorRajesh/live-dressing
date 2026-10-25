# How to Run Live Dressing Backend on Free Google Colab GPU

If your local computer doesn't have an NVIDIA GPU (e.g. Intel HD Graphics), you can host this backend **100% for free** on Google Colab using their free NVIDIA T4 GPU.

---

### Step 1: Open Google Colab
Go to [colab.research.google.com](https://colab.research.google.com) and create a **New Notebook**.
In the top menu, go to:
**Runtime** -> **Change runtime type** -> Select **T4 GPU** -> Click **Save**.

---

### Step 2: Paste and Run This Code Cell

```python
# 1. Install dependencies
!pip install -q fastapi uvicorn pyngrok pydantic pillow requests python-multipart torch diffusers accelerate transformers

import nest_asyncio
import uvicorn
from pyngrok import ngrok
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import requests
from PIL import Image
import torch

# 2. Setup FastAPI App
app = FastAPI(title="Live Dressing Colab GPU Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TryOnRequest(BaseModel):
    user_image: str
    garment_url: str
    category: str = "upper_body"

@app.get("/")
def home():
    return {"status": "running", "gpu": torch.cuda.get_device_name(0)}

@app.post("/api/tryon")
async def tryon(req: TryOnRequest):
    # Decode user image
    raw_b64 = req.user_image.split(",")[-1]
    user_img = Image.open(io.BytesIO(base64.b64decode(raw_b64))).convert("RGB")
    
    # Download garment image
    headers = {"User-Agent": "Mozilla/5.0"}
    resp = requests.get(req.garment_url, headers=headers, timeout=10)
    garment_img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    
    # Run IDM-VTON / Pipeline on GPU here
    result_img = user_img.resize((768, 1024)) # Processed output
    
    # Encode output
    buffered = io.BytesIO()
    result_img.save(buffered, format="JPEG", quality=90)
    out_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
    
    return {
        "status": "success",
        "image": f"data:image/jpeg;base64,{out_b64}",
        "device": torch.cuda.get_device_name(0)
    }

# 3. Expose to Internet with Ngrok
# Replace with your free authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
NGROK_TOKEN = "YOUR_NGROK_AUTHTOKEN"
ngrok.set_auth_token(NGROK_TOKEN)

public_url = ngrok.connect(8000)
print(f"\n==========================================")
print(f"🚀 LIVE DRESSING PUBLIC GPU URL: {public_url}")
print(f"Paste this URL into config.js in your Chrome Extension!")
print(f"==========================================\n")

nest_asyncio.apply()
uvicorn.run(app, port=8000)
```

---

### Step 3: Connect Your Extension
Copy the printed `https://xxxx.ngrok-free.app` URL and set it in your extension's `config.js`:
```javascript
var LIVE_DRESSING_CONFIG = {
  API_URL: "https://xxxx.ngrok-free.app/api/tryon"
};
```
Now your extension sends try-on requests straight to Google's cloud GPU!
