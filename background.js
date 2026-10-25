/**
 * Live Dressing - Background Service Worker
 * Clean room service worker without third-party tracking or telemetry.
 */

// Installation & Startup
chrome.runtime.onInstalled.addListener(function(details) {
  console.log("[Live Dressing] Extension installed or updated:", details.reason);
  if (details.reason === "install") {
    // Set default config
    chrome.storage.local.set({
      backend_url: "http://127.0.0.1:8000",
      installed_at: Date.now(),
    });
  }
});

// Runtime Message Dispatcher
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || !message.type) return;

  // Open a new tab
  if (message.type === "DECART_OPEN_TAB" || message.type === "LIVE_DRESSING_OPEN_TAB") {
    if (message.url) {
      chrome.tabs.create({ url: message.url });
    }
    return false;
  }

  // Open Popup Window
  if (message.type === "DECART_OPEN_POPUP" || message.type === "LIVE_DRESSING_OPEN_POPUP") {
    if (message.url) {
      chrome.windows.create({ url: message.url, type: "popup", width: 480, height: 780 });
    }
    return false;
  }

  // Popup open request to active tab
  if (message.type === "DECART_POPUP_OPEN_TAB" || message.type === "LIVE_DRESSING_POPUP_OPEN_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs && tabs[0];
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { type: "DECART_POPUP_OPEN" });
      }
    });
    return false;
  }

  // Fetch Image Helper (bypasses CORS using extension background privileges)
  if (message.type === "DECART_FETCH_IMAGE" || message.type === "LIVE_DRESSING_FETCH_IMAGE") {
    (async function() {
      try {
        const resp = await fetch(message.url);
        if (!resp.ok) return sendResponse({ error: "Fetch failed" });
        const blob = await resp.blob();
        if (blob.size > 15 * 1024 * 1024) return sendResponse({ error: "Image too large" });

        const reader = new FileReader();
        reader.onload = () => sendResponse({ dataUrl: reader.result });
        reader.onerror = () => sendResponse({ error: "Conversion error" });
        reader.readAsDataURL(blob);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Image Hashing Helper
  if (message.type === "DECART_HASH_IMAGE" || message.type === "LIVE_DRESSING_HASH_IMAGE") {
    (async function() {
      try {
        const resp = await fetch(message.url);
        const bmp = await createImageBitmap(await resp.blob(), {
          resizeWidth: 9,
          resizeHeight: 8,
          resizeQuality: "low",
        });
        const canvas = new OffscreenCanvas(9, 8);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0, 9, 8);
        const data = ctx.getImageData(0, 0, 9, 8).data;
        const gray = [];
        for (let i = 0; i < 72; i++) {
          gray.push(0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2]);
        }
        let hash = 0n;
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            hash = (hash << 1n) | (gray[9 * i + j] > gray[9 * i + j + 1] ? 1n : 0n);
          }
        }
        sendResponse({ hash: hash.toString(16).padStart(16, "0") });
      } catch (e) {
        sendResponse({});
      }
    })();
    return true;
  }

  // Backend Health Check
  if (message.type === "LIVE_DRESSING_CHECK_BACKEND") {
    chrome.storage.local.get(["backend_url"], async function(res) {
      const baseUrl = res.backend_url || "http://127.0.0.1:8000";
      try {
        const resp = await fetch(`${baseUrl}/health`, { method: "GET" });
        const data = await resp.json();
        sendResponse({ ok: true, data: data, baseUrl: baseUrl });
      } catch (err) {
        sendResponse({ ok: false, error: err.message, baseUrl: baseUrl });
      }
    });
    return true;
  }

  // Installation info shim
  if (message.type === "DECART_GET_INSTALLATION_INFO") {
    sendResponse({ installation_id: "live_dressing_local", chrome_email: null });
    return true;
  }

  // Track event shim (silent no-op)
  if (message.type === "DECART_TRACK_EVENT_WIN") {
    sendResponse({});
    return true;
  }
});