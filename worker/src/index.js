const NOTION_VERSION = "2022-06-28"

const SETTINGS = {
    titleProperty: "title",
    urlProperty: "externalLink",
    categoryProperty: "category",
    descriptionProperty: "hover description",
    metaDescriptionProperty: "meta-description",
    subcategoryProperty: "subcategory",
    pricingProperty: "pricing-type",
    coverProperty: "thumbnailUrl",
    fullpageProperty: "fullpageUrl",
    addedDateProperty: "added-date",
    builderProperty: "builder",
    colorPaletteProperty: "color-palette",
    fontsProperty: "fonts",
    techStackProperty: "tech-stack",
}

// Candidate names per field. Used both for reading pages and for
// telling Notion which properties to return (filter_properties).
const FIELDS = {
    title: ["title", "Title", "Name"],
    url: ["externalLink", "external-link", "External Link", "URL", "url"],
    category: ["category", "Category"],
    subcategory: ["subcategory", "Subcategory"],
    pricing: ["pricing-type", "pricing_type", "Pricing Type"],
    description: ["hover description", "hover_description", "hover-description", "Hover Description"],
    metaDescription: ["meta-description", "meta_description", "Meta Description", "SEO Description"],
    cover: ["thumbnailUrl", "thumbnail-url", "Thumbnail URL", "Thumbnail", "Cover Image"],
    fullpage: ["fullpageUrl", "fullpage-url", "Fullpage URL", "Full Page URL", "Fullpage"],
    addedDate: ["added-date", "added_date", "Added Date", "Date Added"],
    builder: ["builder", "Builder", "Built With"],
    colorPalette: ["color-palette", "color_palette", "Color Palette", "Colors"],
    fonts: ["fonts", "Fonts", "Font"],
    techStack: ["tech-stack", "tech_stack", "Tech Stack", "Technology Stack"],
    isNew: ["is-new", "is_new", "New", "Is New"],
    isSponsored: ["is-sponsored", "is_sponsored", "Sponsored", "Is Sponsored"],
    slug: ["slug", "Slug", "CMS Slug", "Framer CMS Slug", "framerCMSSlug"],
}

const KV_ITEMS = "archive:items"
const KV_COUNTS = "archive:counts"
const KV_EDGE_TTL = 60 // seconds KV value is cached at the edge (min 60)

let refreshInFlight = null

// ────────────────────────────────────────────────────────────────
// PROPERTY LOOKUP (indexed - built once per page, Map lookups after)
// ────────────────────────────────────────────────────────────────

const normalizeCache = new Map()
function normalizePropertyName(name) {
    const key = String(name ?? "")
    let n = normalizeCache.get(key)
    if (n === undefined) {
        n = key.toLowerCase().replace(/[\s_-]+/g, "")
        normalizeCache.set(key, n)
    }
    return n
}

function indexProperties(properties) {
    const exact = new Map()
    const normalized = new Map()
    const byType = new Map()
    for (const name in properties ?? {}) {
        const prop = properties[name]
        const entry = [name, prop]
        exact.set(name, entry)
        const n = normalizePropertyName(name)
        if (!normalized.has(n)) normalized.set(n, entry)
        if (!byType.has(prop.type)) byType.set(prop.type, entry)
    }
    return { exact, normalized, byType }
}

function findNamed(index, names, typeFilter) {
    for (const name of names) {
        const entry =
            index.exact.get(name) ??
            index.normalized.get(normalizePropertyName(name))
        if (entry && (!typeFilter || entry[1].type === typeFilter)) return entry
    }
    return null
}

function getProp(index, settingKey, fallbackNames, typeFilter, { allowTypeFallback = true } = {}) {
    const custom = SETTINGS[settingKey]
    const hit =
        (custom && findNamed(index, [custom], typeFilter)) ||
        findNamed(index, fallbackNames, typeFilter)
    if (hit) return hit
    if (allowTypeFallback && typeFilter) return index.byType.get(typeFilter) ?? null
    return null
}

// ────────────────────────────────────────────────────────────────
// PROPERTY READERS
// ────────────────────────────────────────────────────────────────

function extractPlainText(richText = []) {
    let s = ""
    for (const t of richText) s += t.plain_text
    return s.trim()
}

function readTitle(prop) {
    return prop?.type === "title" ? extractPlainText(prop.title) : ""
}

function readUrl(prop) {
    if (!prop) return ""
    if (prop.type === "url") return prop.url ?? ""
    if (prop.type === "rich_text") return extractPlainText(prop.rich_text)
    if (prop.type === "formula" && prop.formula?.type === "string") return prop.formula.string ?? ""
    return ""
}

function readString(prop) {
    if (!prop) return ""
    switch (prop.type) {
        case "rich_text": return extractPlainText(prop.rich_text)
        case "title": return extractPlainText(prop.title)
        case "url": return prop.url ?? ""
        case "select": return prop.select?.name ?? ""
        case "status": return prop.status?.name ?? ""
        case "date": return prop.date?.start ?? ""
        case "formula": {
            const f = prop.formula
            if (f?.type === "string") return f.string ?? ""
            if (f?.type === "number") return String(f.number ?? "")
            if (f?.type === "boolean") return f.boolean ? "Yes" : "No"
            if (f?.type === "date") return f.date?.start ?? ""
            return ""
        }
        default: return ""
    }
}

function parseListValue(value) {
    return String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean)
}

function readList(prop) {
    if (!prop) return []
    if (prop.type === "multi_select") return prop.multi_select.map((i) => i.name).filter(Boolean)
    if (prop.type === "select") return prop.select?.name ? [prop.select.name] : []
    if (prop.type === "status") return prop.status?.name ? [prop.status.name] : []
    return parseListValue(readString(prop))
}

const TRUTHY = new Set(["yes", "true", "1"])
function readCheckbox(prop) {
    if (!prop) return false
    if (prop.type === "checkbox") return Boolean(prop.checkbox)
    if (prop.type === "formula" && prop.formula?.type === "boolean") return Boolean(prop.formula.boolean)
    return TRUTHY.has(readString(prop).toLowerCase().trim())
}

// ────────────────────────────────────────────────────────────────
// URL / IMAGE HELPERS
// ────────────────────────────────────────────────────────────────

function normalizeImageUrl(value) {
    const url = String(value ?? "").trim()
    if (!url) return ""
    try {
        const p = new URL(url).protocol
        return p === "http:" || p === "https:" ? url : ""
    } catch { return "" }
}

function readImageUrl(prop) {
    if (!prop) return ""
    if (prop.type === "url") return normalizeImageUrl(prop.url)
    if (prop.type === "rich_text") return normalizeImageUrl(extractPlainText(prop.rich_text))
    if (prop.type === "formula" && prop.formula?.type === "string") return normalizeImageUrl(prop.formula.string)
    if (prop.type !== "files") return ""
    const file = prop.files?.[0]
    if (!file) return ""
    if (file.type === "file") return normalizeImageUrl(file.file?.url)
    if (file.type === "external") return normalizeImageUrl(file.external?.url)
    return ""
}

function rewriteReferralUrl(value, env) {
    const rawUrl = String(value ?? "").trim()
    if (!rawUrl) return ""
    const referralSource = env.SAVAULT_REFERRAL_SOURCE?.trim()
    if (!referralSource) return rawUrl
    try {
        const url = new URL(rawUrl)
        url.searchParams.set("utm_source", referralSource)
        if (!url.searchParams.get("utm_medium")) url.searchParams.set("utm_medium", "referral")
        return url.toString()
    } catch { return rawUrl }
}

function rewriteAssetUrl(value, env) {
    const rawUrl = String(value ?? "").trim()
    const assetRepo = env.SAVAULT_ASSET_REPO?.trim()
    if (!rawUrl || !assetRepo) return rawUrl
    try {
        const url = new URL(rawUrl)
        if (url.hostname !== "cdn.jsdelivr.net") return rawUrl
        if (!url.pathname.includes("/gh/thisisbremlo/loopa-assets@")) return rawUrl
        url.pathname = url.pathname.replace(/\/gh\/thisisbremlo\/loopa-assets@main/, `/gh/${assetRepo}`)
        return url.toString()
    } catch { return rawUrl }
}

// ────────────────────────────────────────────────────────────────
// MAP NOTION PAGE → ITEM
// ────────────────────────────────────────────────────────────────

const NO_FALLBACK = { allowTypeFallback: false }

function mapPageToItem(page, env) {
    const ix = indexProperties(page.properties)

    const title = readTitle(getProp(ix, "titleProperty", FIELDS.title, "title")?.[1])
    const rawUrl = readUrl(getProp(ix, "urlProperty", FIELDS.url, undefined, NO_FALLBACK)?.[1])
    const url = rewriteReferralUrl(rawUrl, env)
    const category = readString(getProp(ix, "categoryProperty", FIELDS.category, undefined, NO_FALLBACK)?.[1])
    const subcategory = readString(getProp(ix, "subcategoryProperty", FIELDS.subcategory, undefined, NO_FALLBACK)?.[1])
    const pricing = readString(getProp(ix, "pricingProperty", FIELDS.pricing, undefined, NO_FALLBACK)?.[1])
    const hoverDescription = readString(getProp(ix, "descriptionProperty", FIELDS.description, undefined, NO_FALLBACK)?.[1])
    const metaDescription = readString(getProp(ix, "metaDescriptionProperty", FIELDS.metaDescription, undefined, NO_FALLBACK)?.[1])
    const thumbnailUrl = rewriteAssetUrl(readImageUrl(getProp(ix, "coverProperty", FIELDS.cover)?.[1]), env)
    const fullpageUrl = rewriteAssetUrl(readImageUrl(getProp(ix, "fullpageProperty", FIELDS.fullpage)?.[1]), env)
    const addedDate = readString(getProp(ix, "addedDateProperty", FIELDS.addedDate, undefined, NO_FALLBACK)?.[1])
    const builder = readString(getProp(ix, "builderProperty", FIELDS.builder, undefined, NO_FALLBACK)?.[1])
    const colorPaletteRaw = readString(getProp(ix, "colorPaletteProperty", FIELDS.colorPalette, undefined, NO_FALLBACK)?.[1])
    const colorPalette = parseListValue(colorPaletteRaw)
    const fonts = readList(getProp(ix, "fontsProperty", FIELDS.fonts, undefined, NO_FALLBACK)?.[1])
    const techStack = readList(getProp(ix, "techStackProperty", FIELDS.techStack, undefined, NO_FALLBACK)?.[1])
    const isNew = readCheckbox(findNamed(ix, FIELDS.isNew)?.[1])
    const isSponsored = readCheckbox(findNamed(ix, FIELDS.isSponsored)?.[1])
    const slug = readString(findNamed(ix, FIELDS.slug)?.[1]).trim()

    let hostname = ""
    if (url) {
        try { hostname = new URL(url).hostname.replace(/^www\./, "") } catch {}
    }

    return {
        id: slug || page.id,
        notionId: page.id,
        slug, cmsSlug: slug, framerCMSSlug: slug,
        title: title || hostname || "Untitled",
        url, externalLink: url,
        category, subcategory, pricing,
        description: hoverDescription, hoverDescription, metaDescription,
        coverImage: thumbnailUrl, thumbnailUrl, fullpageUrl,
        addedDate, builder,
        colorPaletteRaw, colorPalette,
        fonts, techStack,
        isNew, isSponsored,
        tags: subcategory ? [subcategory] : [],
        hostname,
        favicon: hostname
            ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
            : "",
    }
}

function calculateCounts(items) {
    const categories = {}
    for (const item of items) {
        const c = String(item.category || "").trim().toLowerCase()
        if (c) categories[c] = (categories[c] || 0) + 1
    }
    return { total: items.length, categories }
}

// ────────────────────────────────────────────────────────────────
// NOTION
// ────────────────────────────────────────────────────────────────

function notionCreds(env) {
    const token = env.NOTION_TOKEN?.trim()
    const databaseId = env.NOTION_DATABASE_ID?.replace(/-/g, "").trim()
    if (!token || !databaseId) throw new Error("Worker missing NOTION_TOKEN or NOTION_DATABASE_ID secrets.")
    return { token, databaseId }
}

function notionHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
}

async function notionError(response) {
    const err = await response.json().catch(() => ({}))
    return new Error(err.message || `Notion API error (${response.status})`)
}

// Fetch the database schema once so we can:
//  1) ask Notion to return ONLY the properties we use (smaller payload)
//  2) filter out pages without a URL server-side
async function buildQueryPlan(env, token, databaseId) {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        headers: notionHeaders(token),
    })
    if (!res.ok) throw await notionError(res)
    const db = await res.json()
    const ix = indexProperties(db.properties)

    const wanted = new Set()
    const add = (entry) => { if (entry) wanted.add(entry[1].id) }
    add(getProp(ix, "titleProperty", FIELDS.title, "title"))
    add(getProp(ix, "urlProperty", FIELDS.url, undefined, NO_FALLBACK))
    add(getProp(ix, "categoryProperty", FIELDS.category, undefined, NO_FALLBACK))
    add(getProp(ix, "subcategoryProperty", FIELDS.subcategory, undefined, NO_FALLBACK))
    add(getProp(ix, "pricingProperty", FIELDS.pricing, undefined, NO_FALLBACK))
    add(getProp(ix, "descriptionProperty", FIELDS.description, undefined, NO_FALLBACK))
    add(getProp(ix, "metaDescriptionProperty", FIELDS.metaDescription, undefined, NO_FALLBACK))
    add(getProp(ix, "coverProperty", FIELDS.cover))
    add(getProp(ix, "fullpageProperty", FIELDS.fullpage))
    add(getProp(ix, "addedDateProperty", FIELDS.addedDate, undefined, NO_FALLBACK))
    add(getProp(ix, "builderProperty", FIELDS.builder, undefined, NO_FALLBACK))
    add(getProp(ix, "colorPaletteProperty", FIELDS.colorPalette, undefined, NO_FALLBACK))
    add(getProp(ix, "fontsProperty", FIELDS.fonts, undefined, NO_FALLBACK))
    add(getProp(ix, "techStackProperty", FIELDS.techStack, undefined, NO_FALLBACK))
    add(findNamed(ix, FIELDS.isNew))
    add(findNamed(ix, FIELDS.isSponsored))
    add(findNamed(ix, FIELDS.slug))

    const filterProps = [...wanted].map((id) => `filter_properties=${encodeURIComponent(id)}`).join("&")

    // Server-side "URL is not empty" filter
    let filter
    const urlEntry = getProp(ix, "urlProperty", FIELDS.url, undefined, NO_FALLBACK)
    if (urlEntry) {
        const [name, prop] = urlEntry
        if (prop.type === "url") filter = { property: name, url: { is_not_empty: true } }
        else if (prop.type === "rich_text") filter = { property: name, rich_text: { is_not_empty: true } }
        else if (prop.type === "formula") filter = { property: name, formula: { string: { is_not_empty: true } } }
    }

    return { filterProps, filter }
}

async function fetchArchiveItems(env) {
    const { token, databaseId } = notionCreds(env)
    const { filterProps, filter } = await buildQueryPlan(env, token, databaseId)

    const queryUrl =
        `https://api.notion.com/v1/databases/${databaseId}/query` +
        (filterProps ? `?${filterProps}` : "")

    const items = []
    let cursor

    do {
        const body = { page_size: 100 }
        if (cursor) body.start_cursor = cursor
        if (filter) body.filter = filter

        const response = await fetch(queryUrl, {
            method: "POST",
            headers: notionHeaders(token),
            body: JSON.stringify(body),
        })
        if (!response.ok) throw await notionError(response)

        const data = await response.json()
        for (const page of data.results ?? []) {
            if (page.object !== "page") continue
            const item = mapPageToItem(page, env)
            if (item.url) items.push(item)
        }
        cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)

    items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
    return items
}

// ────────────────────────────────────────────────────────────────
// KV REFRESH (runs on cron, or on-demand if KV is empty)
// ────────────────────────────────────────────────────────────────

async function refreshArchive(env) {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = (async () => {
        const items = await fetchArchiveItems(env)
        const counts = calculateCounts(items)
        const updatedAt = new Date().toISOString()

        // Pre-serialize once. Requests just return these strings.
        const itemsJson = JSON.stringify({ items, updatedAt })
        const countsJson = JSON.stringify({ ...counts, updatedAt })

        await Promise.all([
            env.SAVAULT_KV.put(KV_ITEMS, itemsJson),
            env.SAVAULT_KV.put(KV_COUNTS, countsJson),
        ])
        return { itemsJson, countsJson, count: items.length, updatedAt }
    })().finally(() => { refreshInFlight = null })
    return refreshInFlight
}

async function readOrRefresh(env, key) {
    const cached = await env.SAVAULT_KV.get(key, { type: "text", cacheTtl: KV_EDGE_TTL })
    if (cached) return cached
    // First run / empty KV - populate it now
    const r = await refreshArchive(env)
    return key === KV_ITEMS ? r.itemsJson : r.countsJson
}

// ────────────────────────────────────────────────────────────────
// CORS / RESPONSES
// ────────────────────────────────────────────────────────────────

function getAllowedOrigins(env) {
    return String(env.SAVAULT_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
}

function isAllowedOrigin(origin, env) {
    if (!origin) return false
    return (
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("moz-extension://") ||
        origin === "http://localhost:8787" ||
        origin === "http://127.0.0.1:8787" ||
        getAllowedOrigins(env).includes(origin)
    )
}

function corsHeaders(request, env, extra = {}) {
    const origin = request.headers.get("Origin") || ""
    return {
        "Access-Control-Allow-Origin": isAllowedOrigin(origin, env) ? origin : "null",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Savault-Key",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
        ...extra,
    }
}

function publicCorsHeaders(extra = {}) {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        ...extra,
    }
}

const JSON_CT = { "Content-Type": "application/json; charset=utf-8" }

function json(data, status, request, env, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders(request, env, { ...JSON_CT, ...extra }),
    })
}

function rawJson(text, status, headers) {
    return new Response(text, { status, headers: { ...JSON_CT, ...headers } })
}

function authorize(request, env) {
    const requiredKey = env.SAVAULT_API_KEY?.trim()
    if (!requiredKey) return null
    return request.headers.get("X-Savault-Key")?.trim() === requiredKey ? null : "Unauthorized"
}

// ────────────────────────────────────────────────────────────────
// WORKER
// ────────────────────────────────────────────────────────────────

export default {
    // Background refresh - Notion is only ever queried here (and on first run).
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            refreshArchive(env).catch((err) =>
                console.error("[Savault] Scheduled refresh failed:", err)
            )
        )
    },

    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url)

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: pathname === "/api/counts" ? publicCorsHeaders() : corsHeaders(request, env),
            })
        }

        // ── PUBLIC: /api/counts  (KV read only, ~0 ms CPU) ──
        if (pathname === "/api/counts") {
            if (request.method !== "GET") {
                return rawJson('{"error":"Method not allowed"}', 405, publicCorsHeaders())
            }

            // Optional per-IP rate limit (only if binding is configured)
            if (env.COUNTS_LIMITER) {
                const ip = request.headers.get("CF-Connecting-IP") || "unknown"
                const { success } = await env.COUNTS_LIMITER.limit({ key: ip })
                if (!success) {
                    return rawJson('{"error":"Too many requests"}', 429,
                        publicCorsHeaders({ "Retry-After": "60" }))
                }
            }

            try {
                const body = await readOrRefresh(env, KV_COUNTS)
                return rawJson(body, 200, publicCorsHeaders({
                    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
                }))
            } catch (err) {
                console.error("[Savault] Counts error:", err)
                return rawJson(JSON.stringify({ error: err?.message || "Failed to load counts" }),
                    500, publicCorsHeaders({ "Cache-Control": "no-store" }))
            }
        }

        // ── PROTECTED ──
        const authError = authorize(request, env)
        if (authError) return json({ error: authError }, 401, request, env)

        if (pathname === "/health" && request.method === "GET") {
            return json({ ok: true, service: "savault-archive-worker" }, 200, request, env)
        }

        // Force a refresh right after editing Notion (GET or POST)
        if (pathname === "/api/refresh") {
            try {
                const r = await refreshArchive(env)
                return json({ ok: true, items: r.count, updatedAt: r.updatedAt }, 200, request, env)
            } catch (err) {
                console.error("[Savault] Refresh error:", err)
                return json({ error: err?.message || "Refresh failed" }, 500, request, env)
            }
        }

        if (pathname === "/api/archive" && request.method === "GET") {
            try {
                const body = await readOrRefresh(env, KV_ITEMS)
                return new Response(body, {
                    status: 200,
                    headers: corsHeaders(request, env, { ...JSON_CT, "Cache-Control": "private, max-age=60" }),
                })
            } catch (err) {
                console.error("[Savault] Archive error:", err)
                return json({ error: err?.message || "Failed to load archive" }, 500, request, env)
            }
        }

        if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, request, env)
        return json({ error: "Not found" }, 404, request, env)
    },
}
