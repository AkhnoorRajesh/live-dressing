/**
 * Live Dressing - Popup Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const backendInput = document.getElementById("backend-url");
  const saveBtn = document.getElementById("save-config");
  const openWidgetBtn = document.getElementById("open-widget");
  const docsLink = document.getElementById("docs-link");
  const tabNotice = document.getElementById("tab-notice");
  const tabNoticeMsg = document.getElementById("tab-notice-msg");
  const openStoreBtn = document.getElementById("open-store-btn");

  const DEFAULT_BACKEND = "https://live-dressing-api.onrender.com";

  function showNotice(text, type = "warn", showStoreBtn = false) {
    if (!tabNotice || !tabNoticeMsg) return;
    tabNoticeMsg.textContent = text;
    tabNotice.className = `notice-box ${type}`;
    tabNotice.style.display = "block";
    if (openStoreBtn) {
      openStoreBtn.style.display = showStoreBtn ? "block" : "none";
    }
  }

  // Demo store launcher
  if (openStoreBtn) {
    openStoreBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://www.zara.com" });
      window.close();
    });
  }

  // Load configured backend URL
  chrome.storage.local.get(["backend_url"], (result) => {
    const url = result.backend_url || DEFAULT_BACKEND;
    backendInput.value = url;
    docsLink.href = `${url}/docs`;
    checkHealth(url);
  });

  // Check backend server health
  async function checkHealth(baseUrl) {
    statusDot.className = "status-dot";
    statusText.textContent = "Connecting...";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      statusText.textContent = "Waking up server...";
    }, 2500);

    try {
      const resp = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        statusDot.className = "status-dot online";
        statusText.textContent = "AI Ready";
        statusText.title = data.hardware ? data.hardware.mode : "Ready";
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      statusDot.className = "status-dot offline";
      statusText.textContent = "Offline";
      statusText.title = "Verify server URL or check Render dashboard";
    }
  }

  // Save Config
  saveBtn.addEventListener("click", () => {
    let newUrl = backendInput.value.trim();
    if (!newUrl) newUrl = DEFAULT_BACKEND;
    if (newUrl.endsWith("/")) newUrl = newUrl.slice(0, -1);

    chrome.storage.local.set({ backend_url: newUrl }, () => {
      docsLink.href = `${newUrl}/docs`;
      checkHealth(newUrl);
    });
  });

  // Open Widget in Active Tab safely with auto-injection
  openWidgetBtn.addEventListener("click", async () => {
    if (tabNotice) tabNotice.style.display = "none";

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];

      if (!activeTab || !activeTab.id) {
        showNotice("No active browser tab found.", "error");
        return;
      }

      const url = activeTab.url || "";

      // 1. Check if user is on chrome:// or restricted page
      const isRestricted =
        !url ||
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url.startsWith("view-source:") ||
        url.startsWith("https://chromewebstore.google.com");

      if (isRestricted) {
        const pageName = url.startsWith("chrome://") ? "chrome://extensions" : "system settings";
        showNotice(
          `⚠️ Extensions cannot run on ${pageName}. Please open a fashion website to try on clothes!`,
          "warn",
          true // show "Open Zara Demo Store" button
        );
        return;
      }

      // 2. Try sending message to existing content script
      chrome.tabs.sendMessage(activeTab.id, { type: "DECART_POPUP_OPEN" }, async (response) => {
        if (!chrome.runtime.lastError && response && response.ok) {
          window.close();
          return;
        }

        // 3. If content script is missing, auto-inject it via chrome.scripting
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: [
              "crash_reports.js",
              "button-detector.js",
              "config.js",
              "revolve.js",
              "ugg.js",
              "guess.js",
              "factory54.js",
              "uniqlo.js",
              "loropiana.js",
              "per_website_garment_filter.js",
              "widget-core.js",
              "content.js",
            ],
          });

          // Small delay then trigger open
          setTimeout(() => {
            chrome.tabs.sendMessage(activeTab.id, { type: "DECART_POPUP_OPEN" }, () => {
              window.close();
            });
          }, 150);
        } catch (injectErr) {
          console.warn("[Live Dressing] Script injection failed:", injectErr);
          showNotice(
            "🔄 Please refresh this page once so Live Dressing can activate!",
            "error",
            false
          );
        }
      });
    } catch (err) {
      console.error("[Live Dressing] Popup error:", err);
      showNotice("An error occurred while opening the fitting room.", "error");
    }
  });
});