/** Cross-browser extension API (Chrome + Firefox). */
export const api = globalThis.browser ?? globalThis.chrome;
