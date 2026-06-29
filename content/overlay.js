(function () {
  const ROOT_ID = "savault-archive-root";
  const CLEANUP_KEY = "__savaultArchiveCleanup";

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
  const archiveUrl = `${api.runtime.getURL("archive/archive.html")}?embed=1`;

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
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: #1e1e20;
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
    <div class="panel" role="dialog" aria-label="savault">
      <iframe src="${archiveUrl}" title="savault"></iframe>
    </div>
  `;

  const iframe = shadow.querySelector("iframe");

  function closeOverlay() {
    host.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("message", onMessage);
    if (globalThis[CLEANUP_KEY] === closeOverlay) {
      delete globalThis[CLEANUP_KEY];
    }
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
  }

  shadow.querySelector(".backdrop").addEventListener("click", closeOverlay);
  document.addEventListener("keydown", onKey);
  window.addEventListener("message", onMessage);
  globalThis[CLEANUP_KEY] = closeOverlay;

  document.documentElement.appendChild(host);
})();
