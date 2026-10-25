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

  const DEFAULT_BACKEND = "https://live-dressing-api.onrender.com";

  function showNotice(text, isError = true) {
    if (!tabNotice) return;
    tabNotice.textContent = text;
    tabNotice.style.display = "block";
    tabNotice.style.color = isError ? "#fca5a5" : "#6ee7b7";
    tabNotice.style.background = isError ? "rgba(239, 68, 68, 0.12)" : "rgba(16, 185, 129, 0.12)";
    tabNotice.style.borderColor = isError ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)";
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

  // Open Widget in Active Tab safely
  openWidgetBtn.addEventListener("click", () => {
    if (tabNotice) tabNotice.style.display = "none";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.id) {
        showNotice("No active browser tab found.");
        return;
      }

      const url = activeTab.url || "";

      // 1. Restricted browser pages (chrome://, edge://, about:)
      if (
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url.startsWith("view-source:")
      ) {
        showNotice("⚠️ Please open a fashion shopping site (e.g., Zara, Uniqlo) to try on clothes!");
        return;
      }

      // 2. Send message with callback to consume runtime.lastError safely
      chrome.tabs.sendMessage(activeTab.id, { type: "DECART_POPUP_OPEN" }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not yet attached (e.g. page was loaded before extension was loaded)
          showNotice("🔄 Please refresh this shopping page once to activate Live Dressing!");
        } else {
          window.close();
        }
      });
    });
  });
});