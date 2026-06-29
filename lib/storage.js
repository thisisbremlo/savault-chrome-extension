import { SAVAULT_API_BASE, SAVAULT_API_KEY } from "./api-config.js";
import {
  getExtensionSavedSlugs,
  setExtensionSavedSlugs,
} from "./saved-storage.js";

const PROPERTY_DEFAULTS = {
  titleProperty: "title",
  urlProperty: "externalLink",
  categoryProperty: "category",
  descriptionProperty: "hover description",
  subcategoryProperty: "subcategory",
  pricingProperty: "pricing-type",
  coverProperty: "thumbnailUrl",
  tagsProperty: "",
};

export function getSettings() {
  return Promise.resolve({
    apiBase: SAVAULT_API_BASE.replace(/\/$/, ""),
    apiKey: SAVAULT_API_KEY?.trim() ?? "",
    ...PROPERTY_DEFAULTS,
  });
}

export function isConfigured() {
  return Boolean(SAVAULT_API_BASE?.trim());
}

export async function getBookmarks() {
  return getExtensionSavedSlugs();
}

export async function setBookmarks(bookmarks) {
  return setExtensionSavedSlugs(bookmarks);
}
