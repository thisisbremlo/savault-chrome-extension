/** Custom icons: inline SVG helpers. */

const PATHS = {
  // Custom grid view icon (Phosphor style)
  gridSolid: "M216,56v60a4,4,0,0,1-4,4H136V44a4,4,0,0,1,4-4h60A16,16,0,0,1,216,56ZM116,40H56A16,16,0,0,0,40,56v60a4,4,0,0,0,4,4h76V44A4,4,0,0,0,116,40Zm96,96H136v76a4,4,0,0,0,4,4h60a16,16,0,0,0,16-16V140A4,4,0,0,0,212,136ZM40,140v60a16,16,0,0,0,16,16h60a4,4,0,0,0,4-4V136H44A4,4,0,0,0,40,140Z",
  // Custom list view icon (Phosphor style)
  viewColumn: "M224,152v40a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V152a16,16,0,0,1,16-16H208A16,16,0,0,1,224,152ZM208,48H48A16,16,0,0,0,32,64v40a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V64A16,16,0,0,0,208,48Z",
  // heroicons:magnifying-glass
  magnifyingGlass: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  // heroicons:chevron-down
  caretDown: "M19 9l-7 7-7-7",
  // heroicons:x-mark
  x: "M6 18L18 6M6 6l12 12",
  // heroicons:arrow-path
  arrowPath: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  // heroicons:bookmark
  bookmark: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
  // heroicons:bookmark-solid (filled)
  bookmarkSolid: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
  // heroicons:heart-solid (filled)
  heartSolid: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
};

export function iconifyIcon(name, size = 18) {
  const d = PATHS[name];
  if (!d) return "";

  const isLargeViewBox = name === "gridSolid" || name === "viewColumn";
  const viewBox = isLargeViewBox ? "0 0 256 256" : "0 0 24 24";
  const isFilled = name.includes("Solid") || name === "gridSolid" || name === "viewColumn";
  const strokeWidth = isLargeViewBox ? "0" : "2";

  return `<svg class="iconify" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${isFilled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export const VIEW_ICON = {
  grid: "gridSolid",
  list: "viewColumn",
};
