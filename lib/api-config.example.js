/**
 * Copy to `api-config.js` after deploying the Cloudflare Worker.
 * Archive database credentials live only on Cloudflare, not in the extension.
 */
export const SAVAULT_API_BASE = "https://savault-archive-api.SUBDOMAIN.workers.dev";
/** Optional. Set the same value as SAVAULT_API_KEY worker secret, or leave empty. */
export const SAVAULT_API_KEY = "";
