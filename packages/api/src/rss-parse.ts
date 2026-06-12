// Pure RSS/Atom feed parser — no dependencies, no Bun/Postgres deps.
// Extracts items from RSS 2.0 and Atom 1.0 XML by regex rather than a full
// DOM parser to stay dependency-free (this repo has no xml/dom lib).
// Exported so it can be unit-tested independently (node --test).
//
// Returns at most one item per <item>/<entry> element. Malformed entries
// (unparseable date, no link) are silently dropped — the caller must not rely
// on getting N items when the feed has N elements.

export interface RssItem {
  title: string;
  summary: string; // description/content/summary; "" when absent
  link: string; // canonical URL; "" when absent
  pubDate: string; // YYYY-MM-DD UTC; "" when unparseable
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip CDATA wrappers and XML entities. */
function clean(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ") // strip any nested tags (e.g. <p> in description)
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract first occurrence of a tag's text content. Returns "" when absent. */
function tag(xml: string, name: string): string {
  // Matches <name ...>content</name> (non-greedy, dotall).
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = re.exec(xml);
  return m ? clean(m[1] ?? "") : "";
}

/** Extract a named attribute from the first occurrence of a tag. */
function attr(xml: string, tagName: string, attrName: string): string {
  const re = new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']+)["'][^>]*>`, "i");
  const m = re.exec(xml);
  return m ? (m[1] ?? "").trim() : "";
}

/**
 * Parse a date string (RFC 2822 or ISO 8601) into YYYY-MM-DD UTC.
 * Returns "" when unparseable.
 */
function parsePubDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse RSS 2.0 or Atom 1.0 XML and return normalized items.
 * Malformed items (no parseable link) are dropped; those with no parseable
 * date get pubDate="". Safe to call on empty strings or non-XML input.
 */
export function parseRssItems(xml: string): RssItem[] {
  if (!xml) return [];

  // Detect format by presence of <entry> (Atom) vs <item> (RSS 2.0).
  const isAtom = /<entry[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";

  // Split on item/entry boundaries.
  const itemRe = new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, "gi");
  const blocks = xml.match(itemRe) ?? [];

  const results: RssItem[] = [];
  for (const block of blocks) {
    // --- link ---
    let link = "";
    if (isAtom) {
      // Atom: <link href="..."/> or <link rel="alternate" href="..."/>
      link = attr(block, "link", "href");
      if (!link) link = tag(block, "link");
    } else {
      link = tag(block, "link");
    }
    link = link.trim();
    // Only keep http(s) links — skip feed-protocol / relative links.
    if (!/^https?:\/\//i.test(link)) continue;

    // --- title ---
    const title = tag(block, "title") || "(no title)";

    // --- summary / description ---
    const summary = isAtom
      ? tag(block, "summary") || tag(block, "content")
      : tag(block, "description");

    // --- date ---
    const rawDate = isAtom
      ? tag(block, "published") || tag(block, "updated")
      : tag(block, "pubDate") || tag(block, "dc:date") || tag(block, "date");
    const pubDate = parsePubDate(rawDate);

    results.push({ title, summary, link, pubDate });
  }
  return results;
}
