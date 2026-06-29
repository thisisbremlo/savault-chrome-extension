import { fetchArchiveItems } from "./notion-map.js";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    origin === "http://localhost:8787" ||
    origin === "http://127.0.0.1:8787"
  );
}

function corsHeaders(request, extra = {}) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = isAllowedOrigin(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Savault-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    ...extra,
  };
}

function json(data, status, request, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request, {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function authorize(request, env) {
  const requiredKey = env.SAVAULT_API_KEY?.trim();
  if (!requiredKey) return null;

  const provided = request.headers.get("X-Savault-Key")?.trim();
  if (provided !== requiredKey) {
    return "Unauthorized";
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, request);
    }

    const authError = authorize(request, env);
    if (authError) {
      return json({ error: authError }, 401, request);
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, 200, request);
    }

    if (url.pathname === "/api/archive") {
      try {
        const items = await fetchArchiveItems(env);
        return json({ items }, 200, request, {
          "Cache-Control": "private, max-age=60",
        });
      } catch (err) {
        return json(
          { error: err.message || "Failed to load archive" },
          500,
          request
        );
      }
    }

    return json({ error: "Not found" }, 404, request);
  },
};
