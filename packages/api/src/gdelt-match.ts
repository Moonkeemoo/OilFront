// Pure GDELT DOC 2.0 article → infra_strikes candidate mapping.
// Companion of acled-match.ts: same candidate shape, different source. The
// loader (cli/load-gdelt-strikes.ts) queries GDELT per facility by name, so
// unlike ACLED there is no spatial join — the facility is known up-front and
// the filtering burden is on the title keywords (isStrikeArticle).
//
// No Bun/Postgres deps — unit-testable with node --test.

// Strike-signal vocabulary. An article still needs ONE of these to count as a
// strike/attack — this gate is intentionally not "match everything". The first
// group is the original drone/fire/attack core (EN+UA). The second group
// (added 2026-06-13) widens recall for energy-infra phrasing that curated
// digging kept catching by hand — small oil depots, pipeline pumping stations
// (LPDS/NPS), seaports/marine terminals, gas processing plants (GPP) — plus the
// Russian-language terms those articles use. These ADD to the signal; they do
// not replace the strike-indicator requirement.
const STRIKE_KEYWORDS =
  /\b(strike|drone|uav|attack|explosion|fire|hit|blaze|damaged|udar)\b|удар|атак|пожеж|пожар|бпла|дрон|вибух/i;
// Energy-infra + RU facility-class terms (recall widening — see note above).
// These are facility-class nouns that strike reports about depots / LPDS-NPS /
// seaports / GPP tend to use. isStrikeArticle ORs them onto the strike core; in
// the GDELT/FIRMS paths the article was already fetched via a strike-AND-ed
// query (buildGdeltQuery), so this is a recall-widening title filter, not a
// standalone strike oracle. Bare "refinery" is deliberately omitted — it appears
// in non-strike business news ("Refinery posts record output"); a genuine
// refinery-strike headline already carries a strike-core word.
const INFRA_KEYWORDS =
  /\b(oil depot|fuel depot|tank farm|oil terminal|fuel terminal|sea ?port|pumping station|gas processing|fuel storage)\b|нефтебаз|нефтеперекачивающа|нефтеперекачивающе|лпдс|нпс|насосная станция|газоперерабатывающи|гпз|нефтеналивн|нефтетерминал|нефтепровод|топлив|резервуар|порт/i;
const UAV_KEYWORDS = /drone|uav|бпла|дрон/i;
const SUMMARY_MAX = 280;

export interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // "20260611T063000Z" or similar
  domain?: string;
}

export interface GdeltCandidate {
  id: string; // "gdelt-<infra_id>-<YYYYMMDD>"
  infra_id: string;
  occurred_on: string; // YYYY-MM-DD from seendate
  weapon: "uav" | "unknown";
  summary: string; // title trimmed to 280 + " [auto: GDELT]"
  source_urls: string[]; // [article url]
  raw: Record<string, unknown>;
}

/**
 * GDELT DOC query for one facility: exact-phrase name (OR-grouped with the
 * local name when present) AND-ed with strike vocabulary. Plain string —
 * the loader URL-encodes it.
 */
export function buildGdeltQuery(name: string, nameLocal: string | null): string {
  const namePart = nameLocal ? `("${name}" OR "${nameLocal}")` : `"${name}"`;
  return `${namePart} (strike OR drone OR attack OR fire OR explosion)`;
}

/**
 * Title-level filter: does this headline look like a strike/fire/attack report?
 * Passes on the strike/fire/attack core (STRIKE_KEYWORDS) OR an energy-infra /
 * port / LPDS-NPS / GPP facility-class phrase (INFRA_KEYWORDS). In the GDELT and
 * FIRMS paths buildGdeltQuery already AND-s the facility name with strike
 * vocabulary, so this is a recall-widening title filter, not a standalone "is it
 * a strike" oracle. Bare ambiguous nouns (e.g. "refinery") are intentionally not
 * in INFRA_KEYWORDS so non-strike business news is still rejected.
 */
export function isStrikeArticle(title: string): boolean {
  return STRIKE_KEYWORDS.test(title) || INFRA_KEYWORDS.test(title);
}

/**
 * Parses a GDELT seendate ("YYYYMMDDTHHMMSSZ" or any string starting with a
 * valid "YYYYMMDD") into YYYY-MM-DD. Returns null when unparseable.
 */
function parseSeendate(seendate: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T|$)/.exec(seendate);
  if (!m) return null;
  const [, y, mo, d] = m;
  // Round-trip through Date to reject impossible dates like month 13.
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Maps a strike-looking GDELT article to an infra_strikes candidate. The id is
 * one-per-facility-per-day (gdelt-<infra_id>-<YYYYMMDD>) so multiple articles
 * about the same event collapse onto a single row. Null when the seendate is
 * unparseable or the url is not http(s).
 */
export function mapGdeltArticle(a: GdeltArticle, infraId: string): GdeltCandidate | null {
  if (!/^https?:\/\//i.test(a.url)) return null;
  const occurredOn = parseSeendate(a.seendate);
  if (!occurredOn) return null;

  const title = a.title.trim();
  const base = title.length > SUMMARY_MAX ? title.slice(0, SUMMARY_MAX) : title;
  return {
    id: `gdelt-${infraId}-${occurredOn.replaceAll("-", "")}`,
    infra_id: infraId,
    occurred_on: occurredOn,
    weapon: UAV_KEYWORDS.test(title) ? "uav" : "unknown",
    summary: `${base} [auto: GDELT]`,
    source_urls: [a.url],
    raw: { ...a },
  };
}
