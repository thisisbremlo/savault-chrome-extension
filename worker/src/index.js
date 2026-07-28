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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    if (request.method !== "GET" && request.method !== "POST") {
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
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, request);
      }
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

    if (url.pathname === "/api/submit") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, request);
      }
      try {
        const submission = await request.json();
        
        // Validate submission
        if (!submission.url || !submission.category) {
          return json({ error: "Missing required fields" }, 400, request);
        }

        // Validate URL format
        try {
          new URL(submission.url);
        } catch {
          return json({ error: "Invalid URL format" }, 400, request);
        }

        // Send to Discord webhook if configured
        const webhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
        if (webhookUrl) {
          const embed = {
            title: "New Savault Submission",
            color: 3447003,
            fields: [
              { name: "URL", value: submission.url, inline: false },
              { name: "Category", value: submission.category, inline: true },
              { name: "Description", value: submission.description || "N/A", inline: false },
              { name: "Why Feature", value: submission.whyFeature || "N/A", inline: false },
            ],
            timestamp: new Date().toISOString(),
          };

          try {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ embeds: [embed] }),
            });
          } catch (webhookError) {
            console.error("Discord webhook error:", webhookError);
            // Don't fail the request if webhook fails
          }
        }

        return json({ ok: true, message: "Submission received" }, 200, request);
      } catch (err) {
        return json(
          { error: err.message || "Failed to process submission" },
          500,
          request
        );
      }
    }

    return json({ error: "Not found" }, 404, request);
  },
};
