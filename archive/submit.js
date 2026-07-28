import { getSettings, isConfigured } from "../lib/storage.js";
import { queryArchive } from "../lib/notion.js";
import { api } from "../lib/browser-api.js";

const isEmbed = new URLSearchParams(location.search).has("embed");

// Brand logo - return to archive
const brandBtn = document.getElementById("brand-btn");
if (brandBtn) {
  brandBtn.onclick = () => {
    window.location.href = "archive.html" + location.search;
  };
}

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

const formEl = document.getElementById("submit-form");
const urlInputEl = document.getElementById("website-url");
const categorySelectEl = document.getElementById("category");
const statusEl = document.getElementById("submit-status");
const formSectionEl = document.getElementById("form-section");

let archiveItems = [];
let currentUrl = "";

// Initialize form
async function initializeForm() {
  try {
    // Check if configured
    if (!isConfigured()) {
      showStatus("Configuration missing. Please set up your API key.", "error");
      formEl.style.display = "none";
      return;
    }

    // Get active tab URL
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentUrl = tab.url;
      // Only auto-populate if it's a valid HTTP(S) URL
      try {
        const urlObj = new URL(currentUrl);
        if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
          urlInputEl.value = currentUrl;
        }
      } catch {
        // Invalid URL, don't populate
      }
    }

    // Load archive data to check for duplicates and get categories
    await loadArchiveData();

    // Load categories from archive
    loadCategories();

    // Check if current URL is already in archive (only if we have archive data)
    if (currentUrl && archiveItems.length > 0) {
      console.log("🔍 Checking if URL is in archive:", currentUrl);
      checkIfDuplicate(currentUrl);
    } else if (currentUrl) {
      console.log("⚠️ No archive data loaded, showing form for:", currentUrl);
      showFormState();
    } else {
      console.log("⚠️ No current URL, showing form");
      showFormState();
    }

    // Add event listeners
    urlInputEl.addEventListener("change", () => {
      if (urlInputEl.value) {
        console.log("🔄 URL changed, checking:", urlInputEl.value);
        if (archiveItems.length > 0) {
          checkIfDuplicate(urlInputEl.value);
        } else {
          console.log("⚠️ No archive data, showing form");
          showFormState();
        }
      }
    });

    // My vault button
    const personalVaultBtn = document.getElementById("personal-vault-btn");
    if (personalVaultBtn) {
      personalVaultBtn.textContent = "My vault";
      personalVaultBtn.classList.remove("primary-cta");
      personalVaultBtn.classList.add("open-link");
      personalVaultBtn.onclick = () => {
        window.location.href = "archive.html?vault=personal" + (location.search.includes("embed") ? "&embed=1" : "");
      };
    }

    formEl.addEventListener("submit", handleSubmit);
  } catch (error) {
    console.error("Failed to initialize form:", error);
    showStatus("Failed to load form. Please refresh.", "error");
  }
}

async function loadArchiveData() {
  try {
    const settings = await getSettings();
    archiveItems = await queryArchive(settings);
    console.log("✓ Archive loaded with", archiveItems.length, "items");
  } catch (error) {
    console.error("✗ Failed to load archive:", error);
    // Continue anyway with empty archiveItems
    archiveItems = [];
  }
}

function loadCategories() {
  const categories = new Set();
  
  console.log("📋 Loading categories from", archiveItems.length, "items");
  
  // Extract unique categories from archive items
  archiveItems.forEach(item => {
    if (item.category) {
      categories.add(item.category);
    }
  });

  // Sort alphabetically and populate select
  const sortedCategories = Array.from(categories).sort();
  console.log("📋 Categories found:", sortedCategories);
  
  sortedCategories.forEach(category => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelectEl.appendChild(option);
  });
}

function checkIfDuplicate(url) {
  try {
    const inputUrl = new URL(url).href;
    console.log("📍 Checking duplicate for:", inputUrl);
    console.log("📊 Archive items available:", archiveItems.length);
    
    // Log first few items for debugging
    if (archiveItems.length > 0) {
      console.log("📦 First 3 items:", archiveItems.slice(0, 3).map(i => i.url));
    }

    // Check if URL exists in archive
    const isDuplicate = archiveItems.some(item => {
      if (!item.url) return false;
      try {
        const itemUrl = new URL(item.url).href;
        const match = itemUrl === inputUrl;
        if (match) {
          console.log("✓ FOUND MATCH:", itemUrl);
        }
        return match;
      } catch (e) {
        console.log("Parse error on:", item.url);
        return false;
      }
    });

    console.log("🔍 Result: isDuplicate =", isDuplicate);
    
    if (isDuplicate) {
      console.log("→ Navigating to ALREADY-FEATURED page");
      window.location.href = "already-featured.html" + location.search;
    } else {
      console.log("→ Showing FORM state");
      showFormState();
    }
  } catch (e) {
    console.error("Error in checkIfDuplicate:", e);
    showFormState();
  }
}

function showFormState() {
  console.log("📌 Setting UI to FORM state");
  formSectionEl.hidden = false;
}

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `submit-status ${type}`;
  statusEl.hidden = false;
  
  if (type === "success") {
    setTimeout(() => {
      statusEl.hidden = true;
      formEl.reset();
      urlInputEl.value = currentUrl;
      checkIfDuplicate(currentUrl);
    }, 2000);
  }
}

function clearStatus() {
  statusEl.hidden = true;
}

async function handleSubmit(e) {
  e.preventDefault();
  clearStatus();

  // Validate form
  const url = urlInputEl.value.trim();
  const category = categorySelectEl.value;

  if (!url) {
    showStatus("Please enter a website URL.", "error");
    return;
  }

  if (!category) {
    showStatus("Please select a category.", "error");
    return;
  }

  try {
    // Validate URL
    new URL(url);
  } catch {
    showStatus("Please enter a valid website URL.", "error");
    return;
  }

  // Disable submit button
  const submitBtn = formEl.querySelector(".btn-submit");
  submitBtn.disabled = true;

  try {
    const formData = new FormData(formEl);
    const data = {
      url: formData.get("url"),
      category: formData.get("category"),
      description: formData.get("description") || "",
      whyFeature: formData.get("why-feature") || "",
    };

    const settings = await getSettings();
    const base = settings.apiBase?.trim();
    
    if (!base) {
      throw new Error("API not configured.");
    }

    // Send submission to worker
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    
    if (settings.apiKey) {
      headers["X-Savault-Key"] = settings.apiKey;
    }

    const response = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to submit");
    }

    showStatus("Thanks! Your submission has been received. We'll review it soon.", "success");
  } catch (error) {
    console.error("Submission error:", error);
    showStatus(error.message || "Failed to submit. Please try again.", "error");
    submitBtn.disabled = false;
  }
}

// Initialize on load
initializeForm();
