const NOTION_VERSION = "2022-06-28";

const SETTINGS = {
  titleProperty: "title",
  urlProperty: "externalLink",
  categoryProperty: "category",
  descriptionProperty: "hover description",
  subcategoryProperty: "subcategory",
  pricingProperty: "pricing-type",
  coverProperty: "thumbnailUrl",
  fullpageProperty: "fullpageUrl",
  builderProperty: "builder",
  techStackProperty: "tech-stack",
};

function extractPlainText(richText = []) {
  return richText.map((t) => t.plain_text).join("").trim();
}

function pickProperty(properties, preferredNames, typeFilter) {
  const entries = Object.entries(properties ?? {});
  for (const name of preferredNames) {
    const key = entries.find(([k]) => k.toLowerCase() === name.toLowerCase());
    if (key && (!typeFilter || key[1].type === typeFilter)) return key;
  }
  return null;
}

function getProp(properties, settingKey, fallbackNames, typeFilter) {
  const custom = SETTINGS[settingKey];
  if (custom) {
    const match = pickProperty(properties, [custom], typeFilter);
    if (match) return match;
  }
  return pickProperty(properties, fallbackNames, typeFilter);
}

function readTitle(prop) {
  if (!prop) return "";
  if (prop.type === "title") return extractPlainText(prop.title);
  return "";
}

function readUrl(prop) {
  if (!prop) return "";
  if (prop.type === "url") return prop.url ?? "";
  return "";
}

function readSelect(prop) {
  if (!prop) return "";
  if (prop.type === "select") return prop.select?.name ?? "";
  if (prop.type === "status") return prop.status?.name ?? "";
  if (prop.type === "multi_select") {
    return prop.multi_select?.map((item) => item.name).filter(Boolean).join(", ") ?? "";
  }
  if (prop.type === "rich_text") return extractPlainText(prop.rich_text);
  if (prop.type === "formula" && prop.formula?.type === "string") {
    return prop.formula.string ?? "";
  }
  return "";
}

function readCheckbox(prop) {
  if (!prop) return false;
  if (prop.type === "checkbox") return Boolean(prop.checkbox);
  if (prop.type === "formula" && prop.formula?.type === "boolean") {
    return Boolean(prop.formula.boolean);
  }
  return false;
}

function readDescription(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return extractPlainText(prop.rich_text);
  return "";
}

function readString(prop) {
  if (!prop) return "";
  if (prop.type === "rich_text") return extractPlainText(prop.rich_text);
  if (prop.type === "title") return extractPlainText(prop.title);
  if (prop.type === "url") return prop.url ?? "";
  if (prop.type === "formula" && prop.formula?.type === "string") {
    return prop.formula.string ?? "";
  }
  return "";
}

function normalizeSlug(value) {
  return String(value ?? "").trim();
}

function normalizeImageUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function readImageUrl(prop) {
  if (!prop) return "";
  if (prop.type === "url") return normalizeImageUrl(prop.url);
  if (prop.type === "rich_text") return normalizeImageUrl(extractPlainText(prop.rich_text));
  if (prop.type === "formula" && prop.formula?.type === "string") {
    return normalizeImageUrl(prop.formula.string);
  }
  if (prop.type !== "files") return "";

  const file = prop.files?.[0];
  if (!file) return "";
  if (file.type === "file") return normalizeImageUrl(file.file?.url);
  if (file.type === "external") return normalizeImageUrl(file.external?.url);
  return "";
}

export function mapPageToItem(page) {
  const { properties } = page;

  const title = readTitle(
    getProp(properties, "titleProperty", ["title", "Title", "Name"], "title")?.[1]
  );
  const url = readUrl(
    getProp(properties, "urlProperty", ["externalLink", "External Link", "URL"], "url")?.[1]
  );
  const category = readSelect(
    getProp(properties, "categoryProperty", ["category", "Category"])?.[1]
  );
  const subcategory = readSelect(
    getProp(properties, "subcategoryProperty", ["subcategory", "Subcategory"])?.[1]
  );
  const pricing = readSelect(
    getProp(
      properties,
      "pricingProperty",
      ["pricing-type", "Pricing Type", "Pricing", "Price", "Cost"]
    )?.[1]
  );
  const description = readDescription(
    getProp(
      properties,
      "descriptionProperty",
      ["hover description", "Hover Description", "meta-description", "Meta Description"],
      "rich_text"
    )?.[1]
  );
  const coverImage = readImageUrl(
    getProp(
      properties,
      "coverProperty",
      ["thumbnailUrl", "Thumbnail URL", "Thumbnail", "Cover Image"]
    )?.[1]
  );
  const fullpageImage = readImageUrl(
    getProp(
      properties,
      "fullpageProperty",
      ["fullpageUrl", "Fullpage URL", "Full Page URL", "Fullpage"]
    )?.[1]
  );
  const builder = readSelect(
    getProp(properties, "builderProperty", ["builder", "Builder"])?.[1]
  );
  const techStack = readSelect(
    getProp(properties, "techStackProperty", ["tech-stack", "Tech Stack"])?.[1]
  );
  const isNew = readCheckbox(
    pickProperty(properties, ["is-new", "New", "Is New", "New?", "Recently Added"])?.[1]
  );
  const isSponsored = readCheckbox(
    pickProperty(properties, ["is-sponsored", "is-sponsored?", "Sponsored", "Is Sponsored", "Sponsored?"])?.[1]
  );
  const slug = normalizeSlug(
    readString(
      pickProperty(
        properties,
        ["slug", "Slug", "CMS Slug", "Framer CMS Slug", "framerCMSSlug"]
      )?.[1]
    )
  );

  let hostname = "";
  try {
    if (url) hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }

  return {
    id: slug || page.id,
    notionId: page.id,
    slug,
    cmsSlug: slug,
    framerCMSSlug: slug,
    title: title || hostname || "Untitled",
    url,
    category,
    subcategory,
    pricing,
    description,
    coverImage,
    fullpageImage,
    builder,
    techStack,
    isNew,
    isSponsored,
    tags: [subcategory, builder, techStack].filter(Boolean),
    hostname,
    favicon: url
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
      : "",
  };
}

export async function fetchArchiveItems(env) {
  const token = env.NOTION_TOKEN?.trim();
  const databaseId = env.NOTION_DATABASE_ID?.replace(/-/g, "").trim();

  if (!token || !databaseId) {
    throw new Error("Worker missing NOTION_TOKEN or NOTION_DATABASE_ID secrets.");
  }

  const items = [];
  let cursor;

  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Notion API error (${response.status})`);
    }

    const data = await response.json();
    for (const page of data.results ?? []) {
      if (page.object !== "page") continue;
      const item = mapPageToItem(page);
      if (item.url) items.push(item);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  items.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  return items;
}
