/**
 * Live Dressing - Configuration & Direct Self-Hosted Pipeline
 * Directs all virtual try-on requests to your live Render backend without remote queues.
 */
var LIVE_DRESSING_CONFIG = {
  BACKEND_URL: "https://live-dressing-api.onrender.com",
  TRYON_ENDPOINT: "https://live-dressing-api.onrender.com/api/tryon",
  WS_TRYON_ENDPOINT: "wss://live-dressing-api.onrender.com/ws/tryon",
  HEALTH_ENDPOINT: "https://live-dressing-api.onrender.com/health",
  WIDGET_SIDE: "left",
  DEBUG: false,
  SHOW_TRYON_BUTTONS_WHEN_WIDGET_CLOSED: true,
};

// Backwards-compatibility configuration for embedded Decart SDK components
var DECART_CONFIG = {
  WIDGET_SIDE: LIVE_DRESSING_CONFIG.WIDGET_SIDE,
  TOKEN_ENDPOINT_URL: LIVE_DRESSING_CONFIG.BACKEND_URL + "/api/tokens",
  QUEUE_ENDPOINT_BASE: null,
  QUEUE_MAX_WAIT_MS: 0,
  IMAGE_PROXY_URL: LIVE_DRESSING_CONFIG.BACKEND_URL + "/api/proxy-image",
  DEBUG: LIVE_DRESSING_CONFIG.DEBUG,
  CONNECT_TIMEOUT_MS: 15000,
  SESSION_INACTIVITY_SECONDS: 300,
  SESSION_INACTIVITY_ACTION: "reset",
  SESSION_MAX_IMAGES: 99,
  SLOW_CONNECTION_THRESHOLD_MBPS: 1.0,
  SLOW_CONNECTION_TRIGGER_COUNT: 10,
  RECORDING_ENABLED: false,
  SESSION_RECAP_ENABLED: false,
  SESSION_RECAP_DISABLED_HOSTS: [],
  ATC_PROMPT_ENABLED: false,
  SHOW_TRYON_BUTTONS_WHEN_WIDGET_CLOSED: true,
  MODERATION_RESET_ATTEMPT: {
    ENABLED: false,
  },
};

// Immediate Queue & Token Interceptor:
// Supplies apiKey at root level (required by fetchDecartToken) and inside token (required by Decart Queue),
// completely eliminating all 'Response missing apiKey field' and queue fallback errors.
(function() {
  if (typeof window === "undefined") return;

  var now = Date.now();
  var sessionToken = {
    apiKey: "ld_direct_session_" + now,
    expiresAt: new Date(now + 86400000 * 30).toISOString(),
    issuedAt: new Date(now).toISOString(),
    modelName: "live-dressing-v2",
    webrtcConnectTimeoutSeconds: 60,
    sessionInactivitySeconds: 300,
    billing_enabled: false,
    _exp: now + 86400000 * 30
  };

  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ "__decart_token_cache": sessionToken });
    }
  } catch(e) {}

  if (!window.fetch) return;
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === "string") ? input : (input && input.url ? input.url : "");
    if (
      url.indexOf("tokens") !== -1 ||
      url.indexOf("/api/tokens") !== -1 ||
      url.indexOf("/api/queue/") !== -1 ||
      url.indexOf("queue/join") !== -1 ||
      url.indexOf("queue/status") !== -1 ||
      url.indexOf("queue/requeue") !== -1 ||
      url.indexOf("queue/heartbeat") !== -1
    ) {
      var currentNow = Date.now();
      var currentToken = {
        apiKey: "ld_direct_session_" + currentNow,
        expiresAt: new Date(currentNow + 86400000 * 30).toISOString(),
        issuedAt: new Date(currentNow).toISOString(),
        modelName: "live-dressing-v2",
        webrtcConnectTimeoutSeconds: 60,
        sessionInactivitySeconds: 300,
        billing_enabled: false,
        _exp: currentNow + 86400000 * 30
      };

      // Both root level (i.apiKey for fetchDecartToken) AND nested token (for Decart Queue)
      var responseObj = Object.assign({
        status: "active",
        ticket_id: "ld_direct_ticket_" + currentNow,
        position: 0,
        poll_ms: 0,
        use_held_token: true,
        token: currentToken
      }, currentToken);

      return Promise.resolve(new Response(JSON.stringify(responseObj), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return _origFetch.apply(this, arguments);
  };
})();