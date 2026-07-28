import { api } from "./browser-api.js";

export const STORAGE_KEY = "savault_vault_items";
export const STORAGE_EVENT = "savault_vault_changed";

const SLUG_FIELDS = ["slug", "id", "cmsSlug", "framerCMSSlug"];

function hasExtensionStorage() {
  return Boolean(api?.storage?.local);
}

function usesPromiseStorage() {
  return typeof globalThis.browser !== "undefined" && api === globalThis.browser;
}

function storageGet(keys) {
  if (!hasExtensionStorage()) return null;
  if (usesPromiseStorage()) return api.storage.local.get(keys);
  return new Promise((resolve) => api.storage.local.get(keys, resolve));
}

function storageSet(items) {
  if (!hasExtensionStorage()) return null;
  if (usesPromiseStorage()) return api.storage.local.set(items);
  return new Promise((resolve) => api.storage.local.set(items, resolve));
}

function readObjectSlug(value) {
  if (!value || typeof value !== "object") return "";
  for (const field of SLUG_FIELDS) {
    const slug = normalizeSlug(value[field]);
    if (slug) return slug;
  }
  return "";
}

export function normalizeSlug(slug) {
  return typeof slug === "string" ? slug.trim() : "";
}

export function normalizeSavedSlugs(slugs) {
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

export function mergeSavedSlugs(a, b) {
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

export async function getExtensionSavedSlugs() {
  if (hasExtensionStorage()) {
    const res = await storageGet(STORAGE_KEY);
    const savedSlugs = normalizeStoredValue(res?.[STORAGE_KEY]);
    return savedSlugs;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeStoredValue(saved) : [];
  } catch {
    return [];
  }
}

export async function setExtensionSavedSlugs(slugs) {
  const normalized = normalizeSavedSlugs(slugs);
  if (hasExtensionStorage()) {
    await storageSet({ [STORAGE_KEY]: normalized });
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
  }
  return normalized;
}

export async function toggleExtensionSavedSlug(slug) {
  const normalizedSlug = normalizeSlug(slug);
  const current = await getExtensionSavedSlugs();
  if (!normalizedSlug) return current;

  const next = current.includes(normalizedSlug)
    ? current.filter((item) => item !== normalizedSlug)
    : [...current, normalizedSlug];

  return setExtensionSavedSlugs(next);
}
