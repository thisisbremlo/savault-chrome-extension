import { queryArchive } from "../lib/notion.js";
import { getSettings, isConfigured } from "../lib/storage.js";
import {
  getExtensionSavedSlugs,
  normalizeSlug,
  setExtensionSavedSlugs,
} from "../lib/saved-storage.js";
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
const clearCategoryBtn = document.getElementById("clear-category-btn");
const categoryTileEls = [...document.querySelectorAll(".vault-tile")];
const savedResultsEl = document.getElementById("saved-results");
const heroTitleEl = document.querySelector(".hero-title");
const heroSubtitleEl = document.querySelector(".hero-subtitle");

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

let allItems = [];
let activeCategory = "All";
let activePricing = "All";
let viewMode = VIEW_GRID;
let savedSlugs = new Set();
let archiveLoaded = false;
let archiveLoadPromise = null;

const ARCHIVE_HERO = {
  title: "Explore the Savault archive.",
  subtitle:
    "Browse curated websites, tools, libraries, and design resources - filtered for faster inspiration and better creative research.",
};

const SAVED_EMPTY_HERO = {
  title: "Your vault is still empty.",
  subtitle:
    "Start saving websites, tools, and resources from the Savault archive. Your favorites will appear here.",
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
  const appEl = document.querySelector(".app");
  appEl?.classList.add("has-results");
  appEl?.classList.remove("has-saved-empty");
  if (heroTitleEl) heroTitleEl.textContent = ARCHIVE_HERO.title;
  if (heroSubtitleEl) heroSubtitleEl.textContent = ARCHIVE_HERO.subtitle;
  if (viewSavedBtn) viewSavedBtn.textContent = "Browse all";
  if (appEl) appEl.scrollTop = 0;
}

function showSavedEmpty() {
  const appEl = document.querySelector(".app");
  appEl?.classList.remove("has-results");
  appEl?.classList.add("has-saved-empty");
  if (heroTitleEl) heroTitleEl.textContent = SAVED_EMPTY_HERO.title;
  if (heroSubtitleEl) heroSubtitleEl.textContent = SAVED_EMPTY_HERO.subtitle;
  if (viewSavedBtn) viewSavedBtn.textContent = "Explore Savault";
  if (appEl) appEl.scrollTop = 0;
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
  showResults();
  await ensureArchiveLoaded();
  renderItems(filterItems());
}

async function openArchive({ category = "All", savedOnly = false } = {}) {
  activeCategory = category || "All";
  activePricing = "All";
  if (pricingEl) pricingEl.value = "All";
  setBookmarkFilter(savedOnly);
  updateCategoryTiles();
  showResults();
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
    isItemNew(item) ? '<span class="flag flag-new">New</span>' : "",
    item.isSponsored ? '<span class="flag flag-sponsored">Sponsored</span>' : "",
  ]
    .filter(Boolean)
    .join("");

  const meta = [
    builder ? `<span class="tag">${escapeHtml(builder)}</span>` : "",
    stack ? `<span class="tag">${escapeHtml(stack)}</span>` : "",
  ].join("");

  return `
    <div class="card" role="listitem">
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
    if (bookmarksFilterEl?.checked) {
      gridEl.innerHTML = "";
      showSavedEmpty();
      return;
    }

    gridEl.innerHTML = `<p class="empty">No finds match your search.</p>`;
    return;
  }

  document.querySelector(".app")?.classList.remove("has-saved-empty");
  gridEl.innerHTML = items.map(renderCard).join("");
  bindMediaLoad(gridEl);
}

async function loadArchive() {
  if (!isConfigured()) {
    showStatus(
      "API not configured. Set SAVAULT_API_BASE in lib/api-config.js.",
      "error"
    );
    gridEl.innerHTML = "";
    return;
  }

  showStatus("Loading finds...", "loading");
  refreshBtn.disabled = true;
  refreshBtn.classList.add("is-spinning");

  try {
    const settings = await getSettings();
    const [items, extensionSlugs, activeTabSlugs] = await Promise.all([
      queryArchive(settings),
      getExtensionSavedSlugs(),
      getActiveSavaultSavedSlugs()
    ]);
    const bookmarks = activeTabSlugs
      ? await setExtensionSavedSlugs(activeTabSlugs)
      : extensionSlugs;
    allItems = items;
    savedSlugs = new Set(bookmarks);
    archiveLoaded = true;
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
    renderItems(filterItems());
  });
}
viewSavedBtn?.addEventListener("click", () => openArchive({ category: "All" }));
savedFindsBtn?.addEventListener("click", () =>
  openArchive({ category: "All", savedOnly: true })
);
clearCategoryBtn?.addEventListener("click", () => {
  setBookmarkFilter(false);
  activeCategory = "All";
  updateCategoryTiles();
  renderItems(filterItems());
});
categoryTileEls.forEach((tile) => {
  tile.addEventListener("click", () => setActiveCategory(tile.dataset.category));
});
refreshBtn.addEventListener("click", loadArchive);

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
