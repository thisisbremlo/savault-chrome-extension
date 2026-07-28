(function () {
  const ROOT_ID = "savault-submit-root";
  const CLEANUP_KEY = "__savaultSubmitCleanup";

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    if (globalThis[CLEANUP_KEY]) {
      globalThis[CLEANUP_KEY]();
    } else {
      existing.remove();
    }
    return;
  }

  const api = globalThis.browser ?? globalThis.chrome;
  const submitUrl = `${api.runtime.getURL("archive/submit.html")}?embed=1`;

  const host = document.createElement("div");
  host.id = ROOT_ID;

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(6px);
        opacity: 0;
        animation: backdrop-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      }
      .backdrop.is-closing {
        animation: backdrop-out 0.22s cubic-bezier(0.4, 0, 1, 1) forwards;
      }
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: min(560px, calc(100vw - 32px));
        height: min(660px, calc(100vh - 32px));
        border-radius: 0;
        border: 0;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
        overflow: hidden;
        background: #1e1e20;
        opacity: 0;
        transform: translateY(12px) scale(0.97);
        animation: panel-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) 0.04s forwards;
      }
      .panel.is-closing {
        animation: panel-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: #1e1e20;
      }
      @keyframes backdrop-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes backdrop-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes panel-in {
        from { opacity: 0; transform: translateY(12px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes panel-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(12px) scale(0.97); }
      }
      @media (prefers-reduced-motion: reduce) {
        .backdrop { animation: none; opacity: 1; }
        .backdrop.is-closing { animation: none; opacity: 0; }
        .panel { animation: none; opacity: 1; transform: none; }
        .panel.is-closing { animation: none; opacity: 0; }
      }
      @media (max-width: 480px) {
        .panel {
          top: 0;
          right: 0;
          width: 100vw;
          height: 100vh;
          border-radius: 0;
          border: none;
        }
      }
    </style>
    <div class="backdrop" aria-hidden="true"></div>
    <div class="panel" role="dialog" aria-label="Submit a find - savault">
      <iframe src="${submitUrl}" title="Submit a find to savault"></iframe>
    </div>
  `;

  const iframe = shadow.querySelector("iframe");

  function closeOverlay() {
    if (host.dataset.closing) return;
    host.dataset.closing = "1";
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("message", onMessage);
    if (globalThis[CLEANUP_KEY] === closeOverlay) {
      delete globalThis[CLEANUP_KEY];
    }

    const backdrop = shadow.querySelector(".backdrop");
    const panel = shadow.querySelector(".panel");
    if (backdrop) backdrop.classList.add("is-closing");
    if (panel) panel.classList.add("is-closing");

    host.addEventListener("animationend", (e) => {
      if (e.target === panel || e.target === backdrop) {
        host.remove();
      }
    }, { once: true });

    setTimeout(() => {
      if (host.parentNode) host.remove();
    }, 350);
  }

  function onKey(e) {
    if (e.key === "Escape" && document.getElementById(ROOT_ID)) {
      closeOverlay();
    }
  }

  function onMessage(event) {
    if (event.source !== iframe?.contentWindow) return;
    if (event.data?.type === "savault-archive-close") {
      closeOverlay();
    }
    if (event.data?.type === "savault-open-archive") {
      closeOverlay();
      // Inject archive overlay
      const script = document.createElement("script");
      script.src = api.runtime.getURL("content/overlay.js");
      document.documentElement.appendChild(script);
    }
  }

  shadow.querySelector(".backdrop").addEventListener("click", closeOverlay);
  document.addEventListener("keydown", onKey);
  window.addEventListener("message", onMessage);
  globalThis[CLEANUP_KEY] = closeOverlay;

  document.documentElement.appendChild(host);
})();
