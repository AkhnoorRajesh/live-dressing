# 👗 Live Dressing - AI Virtual Try-On Chrome Extension

**Live Dressing** is a private, self-hosted AI Virtual Try-On browser extension that lets users preview clothing on themselves while shopping on any fashion website (Zara, Revolve, Uniqlo, ASOS, etc.).

---

## 🚀 Quick Start Guide

### 1. Start the Backend AI Server
Before testing the extension, start your local Python backend:

```powershell
python backend/app.py
```
- API Server runs at: `http://127.0.0.1:8000`
- Interactive API Docs: `http://127.0.0.1:8000/docs`
- Health Status: `http://127.0.0.1:8000/health`

*(Note: If you want to run high-end Diffusion models on a cloud GPU for free, check [`backend/FREE_GPU_COLAB.md`](backend/FREE_GPU_COLAB.md)).*

---

### 2. Load the Extension into Google Chrome

1. Open **Google Chrome** and navigate to:
   ```
   chrome://extensions
   ```
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. In the top-left corner, click **Load unpacked**.
4. Select this directory:
   ```
   c:\Users\NAWAB\OneDrive\Desktop\live_dressing
   ```
5. You will now see **Live Dressing - AI Virtual Try-On** pinned in your Chrome toolbar!

---

### 3. Using Live Dressing

1. Click the **Live Dressing** icon in your toolbar.
2. The popup will check your backend server status (green dot = **AI Ready**).
3. Visit any fashion product page (e.g. Zara, Uniqlo, Revolve).
4. Click **Open Fitting Room** to preview outfits!

---

## 🔒 Copyright & Privacy Compliance
- **Zero Third-Party Telemetry**: PostHog and Decart tracking endpoints have been removed.
- **Self-Hosted AI Pipeline**: All try-on transformations are handled by your own backend server.
- **Custom Branding**: Fully original branding and icons for Live Dressing.
