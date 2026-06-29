import { api } from "./browser-api.js";

const VIEW_KEY = "savaultViewMode";
export const VIEW_GRID = "grid";
export const VIEW_LIST = "list";

function normalizeViewMode(mode) {
  return mode === VIEW_LIST ? VIEW_LIST : VIEW_GRID;
}

function hasExtensionStorage() {
  return Boolean(api?.storage?.local);
}

function usesPromiseStorage() {
  return typeof globalThis.browser !== "undefined" && api === globalThis.browser;
}

export async function getViewMode() {
  if (!hasExtensionStorage()) {
    return normalizeViewMode(localStorage.getItem(VIEW_KEY));
  }

  const items = usesPromiseStorage()
    ? await api.storage.local.get({ [VIEW_KEY]: VIEW_GRID })
    : await new Promise((resolve) =>
        api.storage.local.get({ [VIEW_KEY]: VIEW_GRID }, resolve)
      );

  return normalizeViewMode(items[VIEW_KEY]);
}

export async function setViewMode(mode) {
  const nextMode = normalizeViewMode(mode);

  if (!hasExtensionStorage()) {
    localStorage.setItem(VIEW_KEY, nextMode);
    return;
  }

  if (usesPromiseStorage()) {
    await api.storage.local.set({ [VIEW_KEY]: nextMode });
    return;
  }

  await new Promise((resolve) =>
    api.storage.local.set({ [VIEW_KEY]: nextMode }, resolve)
  );
}
