import {
  queryArchive,
  queryArchiveWithMeta,
  refreshRemoteArchive,
} from "../lib/notion.js";
import { getSettings, isConfigured } from "../lib/storage.js";
import {
  getExtensionSavedSlugs,
  normalizeSlug,
  setExtensionSavedSlugs,
} from "../lib/saved-storage.js";
import { getCachedArchive, setCachedArchive } from "../lib/archive-cache.js";
import { api } from "../lib/browser-api.js";
import {
  getViewMode,
  setViewMode,
  VIEW_GRID,
  VIEW_LIST,
} from "../lib/view-preference.js";
import { iconifyIcon, VIEW_ICON } from "../lib/icons.js";

const isEmbed = new URLSearchParams(location.search).has("embed");

if (isEmbed) {
  document.documentElement.classList.add("embed");
  document.getElementById("close-btn")?.removeAttribute("hidden");

  const parentOrigin = (() => {
    try {
      const origin = document.referrer ? new URL(document.referrer).origin : "";
      return origin && origin !== "null" ? origin : "*";
    } catch {
      return "*";
    }
  })();

  const closeFn = () =>
    parent.postMessage({ type: "savault-archive-close" }, parentOrigin);
  
  document.getElementById("close-btn")?.addEventListener("click", closeFn);
  
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFn();
  });
}

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const categoryEl = document.getElementById("category-filter");
const pricingEl = document.getElementById("pricing-filter");
const refreshBtn = document.getElementById("refresh-btn");
const viewToggleBtn = document.getElementById("view-toggle");
const newFilterEl = document.getElementById("new-filter");
const bookmarksFilterEl = document.getElementById("bookmarks-filter");
const viewSavedBtn = document.getElementById("view-saved-btn");
const savedFindsBtn = document.getElementById("saved-finds-btn");
const personalVaultBtn = document.getElementById("personal-vault-btn");
const shareVaultBtn = document.getElementById("share-vault-btn");
const clearCategoryBtn = document.getElementById("clear-category-btn");
const categoryTileEls = [...document.querySelectorAll(".vault-tile")];
const savedResultsEl = document.getElementById("saved-results");
const heroTitleEl = document.querySelector(".hero-title");
const heroSubtitleEl = document.querySelector(".hero-subtitle");
const lastUpdatedMetaEl = document.getElementById("last-updated");

document.getElementById("search-icon").innerHTML = iconifyIcon("magnifyingGlass", 16);
document.getElementById("category-chevron").innerHTML = iconifyIcon("caretDown", 14);
document.getElementById("pricing-chevron").innerHTML = iconifyIcon("caretDown", 14);
const refreshIconEl = refreshBtn.querySelector(".refresh-icon");
if (refreshIconEl) {
  refreshIconEl.innerHTML = iconifyIcon("arrowPath", 15);
}
document.getElementById("close-btn")?.insertAdjacentHTML(
  "afterbegin",
  iconifyIcon("x", 16)
);
const bookmarksFilterBtn = document.getElementById("bookmarks-filter-btn");
if (bookmarksFilterBtn) {
  bookmarksFilterBtn.innerHTML = iconifyIcon("bookmark", 16);
}
const supportIconEl = document.querySelector(".support-icon");
if (supportIconEl) {
  supportIconEl.innerHTML = iconifyIcon("heartSolid", 16);
}

if (shareVaultBtn) {
  shareVaultBtn.onclick = () => openArchive({ category: "All" });
}

// Default header CTA: 'My vault' (opens personal vault from main menu)
if (personalVaultBtn) {
  personalVaultBtn.textContent = "My vault";
  personalVaultBtn.classList.remove("primary-cta");
  personalVaultBtn.classList.add("open-link");
  personalVaultBtn.onclick = () => openPersonalVault();
}

// Submit a find button
const submitFindBtn = document.getElementById("submit-find-btn");
if (submitFindBtn) {
  submitFindBtn.onclick = () => {
    window.location.href = "submit.html" + location.search;
  };
}

// Brand logo - return to starting UI (initial hero state)
const brandBtn = document.getElementById("brand-btn");
if (brandBtn) {
  brandBtn.onclick = () => {
    isPersonalVault = false;
    savedEmptyMode = false;
    const appEl = document.querySelector(".app");
    const mainScroll = document.querySelector(".main-scroll");

    if (mainScroll) {
      mainScroll.classList.remove("is-visible");
      mainScroll.classList.add("is-transitioning");
    }

    setTimeout(() => {
      appEl?.classList.remove("has-results", "has-personal-vault", "has-saved-empty");
      if (searchEl) searchEl.value = "";
      if (newFilterEl) newFilterEl.checked = false;
      setBookmarkFilter(false);
      updateCategoryTiles();
      if (appEl) appEl.scrollTop = 0;

      crossfadeHero(
        "Browse every site in the vault.",
        "Search curated websites, tools, libraries, and design references — organized to help you find better resources faster and save the ones worth revisiting."
      );
    }, 130);
  };
}

let allItems = [];
let activeCategory = "All";
let activePricing = "All";
let viewMode = VIEW_GRID;
let savedSlugs = new Set();
let archiveLoaded = false;
let archiveLoadPromise = null;
let isPersonalVault = false;
let savedEmptyMode = false;

const SHARE_BASE_URL = "https://savault.framer.website/vault";
const CLIENT_ID_KEY = "savault_client_id";

const ARCHIVE_HERO = {
  title: "Browse every site in the vault.",
  subtitle:
    "Search curated websites, tools, libraries, and design references — organized to help you find better resources faster and save the ones worth revisiting.",
};

const SAVED_EMPTY_HERO = {
  title: "Your vault is empty.",
  subtitle:
    "Save websites, tools, and resources from the archive. They'll appear here for quick access.",
};

const PERSONAL_VAULT_HERO = {
  title: "Your personal vault.",
  subtitle:
    "Everything you've bookmarked, in one place — ready to revisit, reuse, or share.",
};

const NON_PRICING_VALUES = new Set([
  "custom / astro",
  "custom / next.js",
  "custom / nuxt",
  "framer",
  "shopify",
  "squarespace",
  "unknown",
  "webflow",
  "wix",
  "wordpress",
]);

const PRICING_HINTS = [
  "free",
  "freemium",
  "paid",
  "price",
  "pricing",
  "trial",
  "subscription",
  "one-time",
  "enterprise",
  "open source",
  "$",
  "€",
];

function showStatus(message, type = "loading") {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

let lastUpdatedAt = "";

function formatUpdatedAge(updatedAt) {
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function updateLastUpdated(ageOverride) {
  if (!lastUpdatedMetaEl) return;
  const age = ageOverride ?? formatUpdatedAge(lastUpdatedAt);
  if (!age) {
    lastUpdatedMetaEl.textContent = "";
    lastUpdatedMetaEl.hidden = true;
    lastUpdatedMetaEl.classList.remove("is-stale");
    return;
  }
  lastUpdatedMetaEl.textContent = `Updated ${age}`;
  lastUpdatedMetaEl.hidden = false;
  lastUpdatedMetaEl.classList.toggle("is-stale", /d ago|d$/.test(age));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&#60;")
    .replaceAll(">", "&#62;")
    .replaceAll('"', "&#34;");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createClientId() {
  try {
    return (
      crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = createClientId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return createClientId();
  }
}

function showToast(message) {
  const oldToast = document.querySelector(".toast");
  if (oldToast) oldToast.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));

  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 240);
  }, 1800);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fallback to legacy copy behavior if writeText is unavailable or blocked.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();

  const copied = document.execCommand("copy");
  input.remove();

  if (!copied) {
    throw new Error("copy failed");
  }
}

async function sharePersonalVault() {
  const slugs = Array.from(savedSlugs).map(normalizeSlug).filter(Boolean);

  if (!slugs.length) {
    showToast("No saved finds yet");
    return;
  }

  const clientId = (await getActiveSavaultClientId()) || getClientId();
  const params = new URLSearchParams({
    sites: slugs.join(","),
    sharedBy: clientId,
  });

  try {
    await copyText(`${SHARE_BASE_URL}?${params.toString()}`);
    showToast("Vault link copied");
  } catch {
    showToast("Copy failed");
  }
}

function getItemPricing(item) {
  return normalizeText(item?.pricing);
}

function getItemSearchText(item) {
  return [
    item.title,
    item.url,
    item.hostname,
    item.category,
    item.subcategory,
    getItemPricing(item),
    item.description,
    item.metaDescription,
    item.metaTitle,
    item.builder,
    item.techStack,
    Array.isArray(item.tags) ? item.tags.join(" ") : item.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isItemNew(item) {
  return item?.isNew === true;
}

function slugify(value) {
  return normalizeSlug(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCategoryKey(category) {
  const key = slugify(category);
  return key.endsWith("s") ? key.slice(0, -1) : key;
}

function findCategoryMatch(category, categories) {
  if (!category || category === "All") return "All";
  if (categories.includes(category)) return category;

  const targetKey = getCategoryKey(category);
  return categories.find((cat) => getCategoryKey(cat) === targetKey) || "All";
}

function getHostnameSlug(item) {
  const hostname = normalizeSlug(item?.hostname);
  const source = hostname || (() => {
    try {
      return item?.url ? new URL(item.url).hostname : "";
    } catch {
      return "";
    }
  })();

  return slugify(source.replace(/^www\./, "").split(".")[0]);
}

function getItemSlugCandidates(item) {
  const candidates = [
    item?.slug,
    item?.cmsSlug,
    item?.framerCMSSlug,
    slugify(item?.title),
    getHostnameSlug(item),
    item?.id,
  ];
  const seen = new Set();
  return candidates
    .map(normalizeSlug)
    .filter((slug) => {
      if (!slug || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });
}

function getItemSavedSlug(item) {
  const candidates = getItemSlugCandidates(item);
  return candidates.find((slug) => savedSlugs.has(slug)) ?? candidates[0] ?? "";
}

function getItemLegacyId(item) {
  return normalizeSlug(item?.notionId ?? item?.id);
}

function isItemSaved(item) {
  const legacyId = getItemLegacyId(item);
  return Boolean(
    getItemSlugCandidates(item).some((slug) => savedSlugs.has(slug)) ||
      (legacyId && savedSlugs.has(legacyId))
  );
}

async function syncSavedSlugsToActiveSavaultTab(slugs) {
  try {
    await api.runtime.sendMessage({
      type: "savault:broadcast-saved-slugs",
      slugs,
    });
  } catch {
    /* the active tab may not be a savault page */
  }
}

async function getActiveSavaultSavedSlugs() {
  try {
    const response = await api.runtime.sendMessage({
      type: "savault:read-saved-slugs",
    });
    return response?.ok && Array.isArray(response.slugs)
      ? response.slugs
      : null;
  } catch {
    return null;
  }
}

async function getActiveSavaultClientId() {
  try {
    const response = await api.runtime.sendMessage({
      type: "savault:read-client-id",
    });
    return response?.ok && response.clientId ? response.clientId : null;
  } catch {
    return null;
  }
}

function applyViewMode(mode) {
  viewMode = mode;
  gridEl.classList.remove("view-grid", "view-list");
  gridEl.classList.add(mode === VIEW_LIST ? "view-list" : "view-grid");

  const isList = mode === VIEW_LIST;
  viewToggleBtn.dataset.view = mode;
  const iconEl = viewToggleBtn.querySelector(".view-toggle-icon");
  const labelEl = viewToggleBtn.querySelector(".view-toggle-label");
  if (iconEl) iconEl.innerHTML = iconifyIcon(VIEW_ICON[mode], 15);
  if (labelEl) labelEl.textContent = isList ? "List" : "Grid";
  viewToggleBtn.classList.toggle("is-active", true);
  viewToggleBtn.title = isList ? "List view" : "Grid view";
  viewToggleBtn.setAttribute(
    "aria-label",
    isList
      ? "List view active. Click to switch to grid."
      : "Grid view active. Click to switch to list."
  );
}

async function initViewMode() {
  const saved = await getViewMode();
  applyViewMode(saved);
}

viewToggleBtn?.addEventListener("click", async () => {
  const next = viewMode === VIEW_GRID ? VIEW_LIST : VIEW_GRID;
  applyViewMode(next);
  await setViewMode(next);
});

function renderCategoryFilter(items) {
  const categories = [
    "All",
    ...[...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
  ];

  const previous = findCategoryMatch(activeCategory, categories);
  categoryEl.innerHTML = categories
    .map((cat) => {
      const label = cat === "All" ? "All categories" : cat;
      return `<option value="${escapeHtml(cat)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  activeCategory = previous;
  categoryEl.value = previous;
}

function renderPricingFilter(items) {
  const pricingTypes = [
    "All",
    ...[...new Set(items.map(getItemPricing).filter(Boolean))].sort(),
  ];

  const previous = activePricing;
  pricingEl.innerHTML = pricingTypes
    .map((p) => {
      const label = p === "All" ? "All pricing" : p;
      return `<option value="${escapeHtml(p)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (pricingTypes.includes(previous)) {
    pricingEl.value = previous;
  } else {
    activePricing = "All";
    pricingEl.value = "All";
  }
}

function filterItems() {
  const q = searchEl.value.trim().toLowerCase();
  return allItems.filter((item) => {
    if (activeCategory !== "All" && item.category !== activeCategory) return false;
    if (activePricing !== "All" && getItemPricing(item) !== activePricing) return false;
    if (newFilterEl && newFilterEl.checked && !isItemNew(item)) return false;
    if (bookmarksFilterEl && bookmarksFilterEl.checked && !isItemSaved(item)) return false;
    if (!q) return true;
    const terms = q.split(/\s+/).filter(Boolean);
    const haystack = getItemSearchText(item);
    return terms.every((term) => haystack.includes(term));
  });
}

function updateCategoryTiles() {
  const categoryOptions = categoryEl ? [...categoryEl.options].map((option) => option.value) : [];
  if (categoryOptions.includes(activeCategory)) {
    categoryEl.value = activeCategory;
  }

  categoryTileEls.forEach((tile) => {
    tile.classList.toggle(
      "is-active",
      getCategoryKey(tile.dataset.category) === getCategoryKey(activeCategory)
    );
  });

  if (clearCategoryBtn) {
    clearCategoryBtn.hidden = activeCategory === "All" && !bookmarksFilterEl?.checked;
  }
}

function showResults() {
  isPersonalVault = false;
  savedEmptyMode = false;
  const appEl = document.querySelector(".app");
  appEl?.classList.add("has-results");
  appEl?.classList.remove("has-saved-empty", "has-personal-vault");
  if (viewSavedBtn) viewSavedBtn.textContent = "Browse all";
  if (viewSavedBtn) viewSavedBtn.hidden = false;
  if (shareVaultBtn) {
    shareVaultBtn.hidden = false;
    shareVaultBtn.onclick = () => openArchive({ category: "All" });
  }
  savedFindsBtn?.removeAttribute("hidden");
  if (appEl) appEl.scrollTop = 0;
  updateVaultCTAs();
  crossfadeHero(ARCHIVE_HERO.title, ARCHIVE_HERO.subtitle);
}

function showSavedEmpty() {
  isPersonalVault = true;
  savedEmptyMode = true;
  const appEl = document.querySelector(".app");
  appEl?.classList.add("has-saved-empty", "has-personal-vault");
  appEl?.classList.remove("has-results");
  if (viewSavedBtn) viewSavedBtn.hidden = true;
  if (shareVaultBtn) shareVaultBtn.hidden = false;
  savedFindsBtn?.setAttribute("hidden", "");
  if (appEl) appEl.scrollTop = 0;
  updateVaultCTAs();
  crossfadeHero(SAVED_EMPTY_HERO.title, SAVED_EMPTY_HERO.subtitle);
}

function showPersonalVault() {
  isPersonalVault = true;
  savedEmptyMode = false;
  const appEl = document.querySelector(".app");
  appEl?.classList.add("has-results", "has-personal-vault");
  appEl?.classList.remove("has-saved-empty");
  if (viewSavedBtn) viewSavedBtn.hidden = true;
  if (shareVaultBtn) shareVaultBtn.hidden = false;
  savedFindsBtn?.setAttribute("hidden", "");
  if (appEl) appEl.scrollTop = 0;
  updateVaultCTAs();
  crossfadeHero(PERSONAL_VAULT_HERO.title, PERSONAL_VAULT_HERO.subtitle);
}

function updateVaultCTAs() {
  const hasSaved = Boolean(savedSlugs && savedSlugs.size > 0);

  if (shareVaultBtn) {
    shareVaultBtn.hidden = false;
    shareVaultBtn.classList.add("primary-cta");
    if (savedEmptyMode || !isPersonalVault) {
      shareVaultBtn.textContent = "Browse all";
      shareVaultBtn.onclick = () => openArchive({ category: "All" });
    } else if (isPersonalVault) {
      shareVaultBtn.textContent = hasSaved ? "Share your vault" : "Browse all";
      shareVaultBtn.onclick = hasSaved ? sharePersonalVault : () => openArchive({ category: "All" });
    }
  }

  if (personalVaultBtn) {
    if (savedEmptyMode) {
      personalVaultBtn.textContent = "Open Savault";
      personalVaultBtn.classList.add("primary-cta");
      personalVaultBtn.classList.remove("open-link");
      personalVaultBtn.onclick = () => openArchive({ category: "All" });
    } else if (isPersonalVault) {
      personalVaultBtn.textContent = "Browse all";
      personalVaultBtn.classList.add("primary-cta");
      personalVaultBtn.classList.remove("open-link");
      personalVaultBtn.onclick = () => openArchive({ category: "All" });
    } else {
      personalVaultBtn.textContent = "My vault";
      personalVaultBtn.classList.remove("primary-cta");
      personalVaultBtn.classList.add("open-link");
      personalVaultBtn.onclick = () => openPersonalVault();
    }
  }
}

function setBookmarkFilter(checked) {
  if (!bookmarksFilterEl) return;
  bookmarksFilterEl.checked = checked;
  if (bookmarksFilterBtn) {
    bookmarksFilterBtn.innerHTML = iconifyIcon(
      checked ? "bookmarkSolid" : "bookmark",
      16
    );
  }
}

async function ensureArchiveLoaded() {
  if (archiveLoaded) return;
  if (!archiveLoadPromise) {
    archiveLoadPromise = loadArchive().finally(() => {
      archiveLoadPromise = null;
    });
  }
  await archiveLoadPromise;
}

async function setActiveCategory(category) {
  activeCategory = category || "All";
  activePricing = "All";
  if (pricingEl) pricingEl.value = "All";
  setBookmarkFilter(false);
  updateCategoryTiles();
  transitionContent(() => {
    showResults();
  });
  await ensureArchiveLoaded();
  renderItems(filterItems());
}

async function openArchive({ category = "All", savedOnly = false } = {}) {
  activeCategory = category || "All";
  activePricing = "All";
  if (pricingEl) pricingEl.value = "All";
  setBookmarkFilter(savedOnly);
  updateCategoryTiles();
  transitionContent(() => {
    showResults();
  });
  await ensureArchiveLoaded();
  renderItems(filterItems());
}

async function openPersonalVault() {
  activeCategory = "All";
  activePricing = "All";
  if (pricingEl) pricingEl.value = "All";
  if (searchEl) searchEl.value = "";
  if (newFilterEl) newFilterEl.checked = false;
  setBookmarkFilter(true);
  updateCategoryTiles();
  transitionContent(() => {
    showPersonalVault();
  });
  await ensureArchiveLoaded();
  renderItems(filterItems());
}

function renderCard(item) {
  const saved = isItemSaved(item);
  const savedSlug = getItemSavedSlug(item);
  const legacyId = getItemLegacyId(item);
  const pricing = getItemPricing(item);
  const builder = normalizeText(item?.builder);
  const stack = normalizeText(item?.techStack);
  const kicker = [item.category, item.subcategory].filter(Boolean).join(" / ");
  const coverSrc = normalizeText(item?.coverImage) || normalizeText(item?.fullpageImage);
  const fallbackCoverSrc =
    normalizeText(item?.coverImage) && normalizeText(item?.fullpageImage)
      ? normalizeText(item.fullpageImage)
      : "";
  const coverBlock = coverSrc
    ? `
        <div class="cover-skeleton" aria-hidden="true"></div>
        <img
          class="cover cover-img is-loading"
          src="${escapeHtml(coverSrc)}"
          ${fallbackCoverSrc ? `data-fallback-src="${escapeHtml(fallbackCoverSrc)}"` : ""}
          alt=""
          loading="eager"
          fetchpriority="high"
          decoding="async"
        />`
    : `<div class="cover-fallback" aria-hidden="true"></div>`;

  const flags = [
    item.isSponsored ? '<span class="flag flag-sponsored">Sponsored</span>' : "",
  ]
    .filter(Boolean)
    .join("");
  const titleBadges = [
    isItemNew(item) ? '<span class="title-badge">NEW</span>' : "",
  ]
    .filter(Boolean)
    .join("");

  const meta = [
    builder ? `<span class="tag">${escapeHtml(builder)}</span>` : "",
    stack ? `<span class="tag">${escapeHtml(stack)}</span>` : "",
  ].join("");

  return `
    <div class="card" role="listitem" data-vault-slug="${escapeHtml(savedSlug)}">
      <a class="card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        <div class="cover-wrap">
          ${coverBlock}
          ${flags ? `<div class="card-badges">${flags}</div>` : ""}
          <span class="corner-arrow" aria-hidden="true">OPEN</span>
        </div>
        <div class="card-body">
          ${kicker ? `<p class="card-kicker">${escapeHtml(kicker)}</p>` : ""}
          <div class="card-title-row">
            <img class="favicon is-loading" src="${escapeHtml(item.favicon)}" alt="" width="22" height="22" loading="lazy" decoding="async" />
            <h2>${escapeHtml(item.title)}</h2>
            ${titleBadges}
            ${pricing ? `<span class="price-pill">${escapeHtml(pricing)}</span>` : ""}
          </div>
          ${item.description ? `<p class="description">${escapeHtml(item.description)}</p>` : ""}
          ${meta ? `<div class="meta">${meta}</div>` : ""}
        </div>
      </a>
      <button type="button" class="bookmark-btn ${saved ? "is-active" : ""}" data-slug="${escapeHtml(savedSlug)}" data-legacy-id="${escapeHtml(legacyId)}" title="${saved ? "Remove bookmark" : "Add bookmark"}" aria-label="${saved ? "Remove bookmark" : "Add bookmark"}">
        ${iconifyIcon(saved ? "bookmarkSolid" : "bookmark", 16)}
      </button>
    </div>
  `;
}

function bindMediaLoad(root) {
  root.querySelectorAll(".cover-img, .favicon").forEach((img) => {
    let fallbackTimer;

    const onDone = (ok) => {
      clearTimeout(fallbackTimer);
      img.classList.remove("is-loading");
      if (ok) {
        img.classList.add("is-loaded");
        const skeleton = img.closest(".cover-wrap")?.querySelector(".cover-skeleton");
        if (skeleton) skeleton.classList.add("is-hidden");
      } else {
        const wrap = img.closest(".cover-wrap");
        if (wrap && img.classList.contains("cover-img")) {
          const fallbackSrc = img.dataset.fallbackSrc;
          if (fallbackSrc && img.src !== fallbackSrc) {
            img.dataset.fallbackSrc = "";
            img.addEventListener("load", () => onDone(true), { once: true });
            img.addEventListener("error", () => onDone(false), { once: true });
            img.src = fallbackSrc;
            fallbackTimer = setTimeout(() => {
              if (!img.classList.contains("is-loaded")) onDone(false);
            }, 4500);
            return;
          }

          img.classList.add("is-error");
          img.remove();
          if (!wrap.querySelector(".cover-fallback")) {
            wrap.insertAdjacentHTML(
              "afterbegin",
              '<div class="cover-fallback" aria-hidden="true"></div>'
            );
          }
          wrap.querySelector(".cover-skeleton")?.remove();
        }
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      onDone(true);
    } else if (img.complete) {
      onDone(false);
    } else {
      img.addEventListener("load", () => onDone(true), { once: true });
      img.addEventListener("error", () => onDone(false), { once: true });

      if (img.classList.contains("cover-img")) {
        fallbackTimer = setTimeout(() => {
          if (!img.classList.contains("is-loaded")) onDone(false);
        }, 4500);
      }
    }
  });
}

function renderItems(items) {
  if (!items.length) {
    if (savedSlugs.size === 0 && isPersonalVault) {
      gridEl.innerHTML = "";
      showSavedEmpty();
      return;
    }

    if (bookmarksFilterEl?.checked) {
      gridEl.innerHTML = `<p class="empty">No saved finds yet. Bookmark websites from the archive to see them here.</p>`;
      return;
    }

    gridEl.innerHTML = `<p class="empty">No finds match your search.</p>`;
    return;
  }

  document.querySelector(".app")?.classList.remove("has-saved-empty");
  gridEl.innerHTML = items.map(renderCard).join("");
  bindMediaLoad(gridEl);
}

function transitionContent(callback) {
  const mainScroll = document.querySelector(".main-scroll");
  const heroCopy = document.querySelector(".hero-copy");

  if (heroCopy) heroCopy.classList.add("is-transitioning");

  if (mainScroll) {
    mainScroll.classList.remove("is-visible");
    mainScroll.classList.add("is-transitioning");
  }

  requestAnimationFrame(() => {
    callback();

    requestAnimationFrame(() => {
      if (heroCopy) {
        heroCopy.classList.remove("is-transitioning");
        heroCopy.classList.add("is-visible");
      }

      if (mainScroll) {
        mainScroll.classList.remove("is-transitioning");
        mainScroll.classList.add("is-visible");
      }
    });
  });
}

function crossfadeHero(title, subtitle, callback) {
  const heroCopy = document.querySelector(".hero-copy");

  if (heroCopy) heroCopy.classList.add("is-transitioning");

  setTimeout(() => {
    if (heroTitleEl) heroTitleEl.textContent = title;
    if (heroSubtitleEl) heroSubtitleEl.textContent = subtitle;
    if (callback) callback();

    requestAnimationFrame(() => {
      if (heroCopy) {
        heroCopy.classList.remove("is-transitioning");
        heroCopy.classList.add("is-visible");
      }
    });
  }, 130);
}

async function loadArchive({ force = false } = {}) {
  if (!isConfigured()) {
    showStatus(
      "API not configured. Set SAVAULT_API_BASE in lib/api-config.js.",
      "error"
    );
    gridEl.innerHTML = "";
    return;
  }

  const [extensionSlugs, activeTabSlugs] = await Promise.all([
    getExtensionSavedSlugs(),
    getActiveSavaultSavedSlugs(),
  ]);
  const bookmarks = activeTabSlugs
    ? await setExtensionSavedSlugs(activeTabSlugs)
    : extensionSlugs;
  savedSlugs = new Set(bookmarks);

  const cached = await getCachedArchive();

  if (cached) {
    allItems = cached.items;
    archiveLoaded = true;
    lastUpdatedAt = cached.updatedAt || "";
    updateLastUpdated();
    updateVaultCTAs();
    activePricing = "All";
    renderCategoryFilter(allItems);
    renderPricingFilter(allItems);
    updateCategoryTiles();
    renderItems(filterItems());

    if (cached.fresh && !force) return;

    refreshBtn.disabled = true;
    refreshBtn.classList.add("is-spinning");

    try {
      const settings = await getSettings();
      const { items: freshItems, updatedAt } = await queryArchiveWithMeta(settings);
      allItems = freshItems;
      lastUpdatedAt = updatedAt;
      await setCachedArchive(freshItems, updatedAt);
      updateLastUpdated();
      activePricing = "All";
      renderCategoryFilter(allItems);
      renderPricingFilter(allItems);
      updateCategoryTiles();
      renderItems(filterItems());
      hideStatus();
    } catch (err) {
      /* keep stale cache */
      showStatus(
        `Couldn't check for updates (${err?.message || "network error"}). Showing saved data.`,
        "error"
      );
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("is-spinning");
    }
    return;
  }

  showStatus("Loading finds...", "loading");
  refreshBtn.disabled = true;
  refreshBtn.classList.add("is-spinning");

  try {
    const settings = await getSettings();
    const { items, updatedAt } = await queryArchiveWithMeta(settings);
    allItems = items;
    archiveLoaded = true;
    lastUpdatedAt = updatedAt;
    await setCachedArchive(items, updatedAt);
    updateLastUpdated();
    updateVaultCTAs();
    hideStatus();
    activePricing = "All";
    renderCategoryFilter(allItems);
    renderPricingFilter(allItems);
    updateCategoryTiles();
    renderItems(filterItems());
  } catch (err) {
    showStatus(err.message || "Failed to load archive.", "error");
    gridEl.innerHTML = "";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("is-spinning");
  }
}

searchEl.addEventListener("input", () => renderItems(filterItems()));
categoryEl.addEventListener("change", () => {
  activeCategory = categoryEl.value;
  updateCategoryTiles();
  transitionContent(() => {});
  renderItems(filterItems());
});
pricingEl.addEventListener("change", () => {
  activePricing = pricingEl.value;
  renderItems(filterItems());
});
if (newFilterEl) {
  newFilterEl.addEventListener("change", () => renderItems(filterItems()));
}
if (bookmarksFilterEl) {
  bookmarksFilterEl.addEventListener("change", () => {
    setBookmarkFilter(bookmarksFilterEl.checked);
    updateCategoryTiles();
    transitionContent(() => {});
    renderItems(filterItems());
  });
}
if (viewSavedBtn) viewSavedBtn.onclick = () => openArchive({ category: "All" });
if (savedFindsBtn) savedFindsBtn.onclick = openPersonalVault;
if (personalVaultBtn) personalVaultBtn.onclick = openPersonalVault;
if (shareVaultBtn) shareVaultBtn.onclick = () => openArchive({ category: "All" });
clearCategoryBtn?.addEventListener("click", () => {
  setBookmarkFilter(false);
  activeCategory = "All";
  updateCategoryTiles();
  transitionContent(() => {});
  renderItems(filterItems());
});
categoryTileEls.forEach((tile) => {
  tile.addEventListener("click", () => setActiveCategory(tile.dataset.category));
});
let isForceRefreshing = false;

async function forceRefreshArchive() {
  if (!isConfigured() || isForceRefreshing) return;

  isForceRefreshing = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add("is-spinning");
  if (lastUpdatedMetaEl) {
    lastUpdatedMetaEl.textContent = "Syncing with Notion...";
    lastUpdatedMetaEl.hidden = false;
    lastUpdatedMetaEl.classList.remove("is-stale");
  }

  try {
    const settings = await getSettings();
    await refreshRemoteArchive(settings);
    await loadArchive({ force: true });
  } catch (err) {
    showStatus(err?.message || "Sync failed.", "error");
    updateLastUpdated();
  } finally {
    isForceRefreshing = false;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("is-spinning");
  }
}

refreshBtn.addEventListener("click", forceRefreshArchive);

renderCategoryFilter(allItems);
renderPricingFilter(allItems);

gridEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".bookmark-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const slug = normalizeSlug(btn.dataset.slug);
  const legacyId = normalizeSlug(btn.dataset.legacyId);
  if (!slug) return;

  btn.classList.remove("is-pop");
  void btn.offsetWidth;
  btn.classList.add("is-pop");
  btn.addEventListener("animationend", () => btn.classList.remove("is-pop"), { once: true });

  if (savedSlugs.has(slug) || (legacyId && savedSlugs.has(legacyId))) {
    savedSlugs.delete(slug);
    if (legacyId) savedSlugs.delete(legacyId);
    btn.classList.remove("is-active");
    btn.innerHTML = iconifyIcon("bookmark", 16);
    btn.title = "Add bookmark";
    btn.setAttribute("aria-label", "Add bookmark");
  } else {
    savedSlugs.add(slug);
    btn.classList.add("is-active");
    btn.innerHTML = iconifyIcon("bookmarkSolid", 16);
    btn.title = "Remove bookmark";
    btn.setAttribute("aria-label", "Remove bookmark");
  }

  const nextSlugs = await setExtensionSavedSlugs(Array.from(savedSlugs));
  savedSlugs = new Set(nextSlugs);
  await syncSavedSlugsToActiveSavaultTab(nextSlugs);
  
  if (bookmarksFilterEl && bookmarksFilterEl.checked) {
    renderItems(filterItems());
  }
});

(async () => {
  await initViewMode();
})();
