/**
 * Map a Notion database page to a normalized archive item.
 * Used only if you switch back to direct Notion API access.
 */
export function mapPageToItem(page, settings) {
  void page;
  void settings;
  throw new Error("Direct Notion mapping is disabled. Use the Cloudflare proxy.");
}

export async function queryArchive(settings) {
  const base = settings.apiBase?.trim();
  if (!base) {
    throw new Error(
      "API not configured. Copy lib/api-config.example.js to lib/api-config.js and set your Worker URL."
    );
  }

  const headers = { Accept: "application/json" };
  if (settings.apiKey) {
    headers["X-Savault-Key"] = settings.apiKey;
  }

  const response = await fetch(`${base}/api/archive`, { headers });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message =
      err.error ||
      `API error (${response.status}). Check Worker URL, secrets, and SAVAULT_API_KEY.`;
    throw new Error(message);
  }

  const data = await response.json();
  return data.items ?? [];
}
