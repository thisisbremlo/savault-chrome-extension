import { api } from "./browser-api.js";

const CACHE_KEY = "savault_archive_cache";
const CACHE_TS_KEY = "savault_archive_cache_ts";
const CACHE_MAX_AGE = 10 * 60 * 1000;

function hasStorage() {
  return Boolean(api?.storage?.local);
}

function usesPromiseStorage() {
  return typeof globalThis.browser !== "undefined" && api === globalThis.browser;
}

function storageGet(keys) {
  if (!hasStorage()) return Promise.resolve({});
  if (usesPromiseStorage()) return api.storage.local.get(keys);
  return new Promise((resolve) => api.storage.local.get(keys, resolve));
}

function storageSet(items) {
  if (!hasStorage()) return Promise.resolve();
  if (usesPromiseStorage()) return api.storage.local.set(items);
  return new Promise((resolve) => api.storage.local.set(items, resolve));
}

export async function getCachedArchive() {
  try {
    const res = await storageGet([CACHE_KEY, CACHE_TS_KEY]);
    const items = res[CACHE_KEY];
    const ts = res[CACHE_TS_KEY] || 0;
    if (!Array.isArray(items) || !items.length) return null;
    return { items, ts, fresh: Date.now() - ts < CACHE_MAX_AGE };
  } catch {
    return null;
  }
}

export async function setCachedArchive(items) {
  try {
    await storageSet({
      [CACHE_KEY]: items,
      [CACHE_TS_KEY]: Date.now(),
    });
  } catch {
    /* storage may be full */
  }
}
