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

  const DEFAULT_BACKEND = "https://live-dressing-api.onrender.com";

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

  // Open Widget in Active Tab
  openWidgetBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { type: "DECART_POPUP_OPEN" });
      }
      window.close();
    });
  });
});