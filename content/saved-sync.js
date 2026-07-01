(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.storage?.local) return;

  const STORAGE_KEY = "savault_saved_websites";
  const STORAGE_EVENT = "savault_saved_websites_changed";
  const OLD_CLIENT_ID_KEY = "loopa_client_id";
  const CLIENT_ID_KEY = "savault_client_id";
  const SLUG_FIELDS = ["slug", "id", "cmsSlug", "framerCMSSlug"];

  let isWritingPageStorage = false;
  let lastSerialized = "";

  function storageGet(keys) {
    return new Promise((resolve) => api.storage.local.get(keys, resolve));
  }

  function storageSet(items) {
    return new Promise((resolve) => api.storage.local.set(items, resolve));
  }

  function normalizeSlug(slug) {
    return typeof slug === "string" ? slug.trim() : "";
  }

  function createClientId() {
    try {
      return (
        window.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2) + Date.now().toString(36)
      );
    } catch {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function readPageClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = localStorage.getItem(OLD_CLIENT_ID_KEY) || createClientId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  function readObjectSlug(value) {
    if (!value || typeof value !== "object") return "";
    for (const field of SLUG_FIELDS) {
      const slug = normalizeSlug(value[field]);
      if (slug) return slug;
    }
    return "";
  }

  function normalizeSavedSlugs(slugs) {
    const input = Array.isArray(slugs) ? slugs : [];
    const seen = new Set();
    const normalized = [];

    for (const item of input) {
      const slug =
        typeof item === "string" ? normalizeSlug(item) : readObjectSlug(item);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      normalized.push(slug);
    }

    return normalized;
  }

  function mergeSavedSlugs(a, b) {
    return normalizeSavedSlugs([
      ...normalizeSavedSlugs(a),
      ...normalizeSavedSlugs(b),
    ]);
  }

  function normalizeStoredValue(value) {
    if (Array.isArray(value)) return normalizeSavedSlugs(value);
    if (typeof value !== "string") return [];

    try {
      return normalizeSavedSlugs(JSON.parse(value));
    } catch {
      const slug = normalizeSlug(value);
      return slug ? [slug] : [];
    }
  }

  async function getExtensionSavedSlugs() {
    const res = await storageGet(STORAGE_KEY);
    return normalizeStoredValue(res?.[STORAGE_KEY]);
  }

  async function setExtensionSavedSlugs(slugs) {
    const normalized = normalizeSavedSlugs(slugs);
    await storageSet({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  function serialize(slugs) {
    return JSON.stringify(normalizeSavedSlugs(slugs));
  }

  function readPageSavedSlugs() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];

    try {
      return normalizeSavedSlugs(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function writePageSavedSlugs(slugs) {
    const normalized = normalizeSavedSlugs(slugs);
    const serialized = serialize(normalized);

    isWritingPageStorage = true;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      lastSerialized = serialized;
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
    } finally {
      queueMicrotask(() => {
        isWritingPageStorage = false;
      });
    }

    return normalized;
  }

  async function syncWebsiteChangeToExtension() {
    if (isWritingPageStorage) return;

    const pageSlugs = readPageSavedSlugs();
    if (pageSlugs === null) return;

    lastSerialized = serialize(pageSlugs);
    await setExtensionSavedSlugs(pageSlugs);
  }

  async function initialSync() {
    const extensionSlugs = await getExtensionSavedSlugs();
    const pageSlugs = readPageSavedSlugs();
    if (pageSlugs === null) return;

    const merged = mergeSavedSlugs(pageSlugs, extensionSlugs);
    writePageSavedSlugs(merged);
    await setExtensionSavedSlugs(merged);
  }

  window.addEventListener(STORAGE_EVENT, syncWebsiteChangeToExtension);

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "savault:get-saved-slugs") {
      const slugs = readPageSavedSlugs();
      sendResponse({ ok: slugs !== null, slugs: slugs ?? [] });
      return false;
    }

    if (message?.type === "savault:get-client-id") {
      sendResponse({ ok: true, clientId: readPageClientId() });
      return false;
    }

    if (message?.type !== "savault:set-saved-slugs") return false;

    (async () => {
      const nextSlugs = normalizeSavedSlugs(message.slugs);
      await setExtensionSavedSlugs(nextSlugs);
      writePageSavedSlugs(nextSlugs);
      sendResponse({ ok: true, slugs: nextSlugs });
    })().catch((err) => {
      sendResponse({ ok: false, error: err?.message || "Sync failed" });
    });

    return true;
  });

  api.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[STORAGE_KEY]) return;

    const nextSlugs = normalizeSavedSlugs(changes[STORAGE_KEY].newValue);
    const nextSerialized = serialize(nextSlugs);
    if (nextSerialized === lastSerialized) return;

    writePageSavedSlugs(nextSlugs);
  });

  initialSync();
})();
