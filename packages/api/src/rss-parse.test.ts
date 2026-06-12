// Unit tests for the pure RSS/Atom parser.
// Pure module (no Bun/Postgres deps) — runnable with: node --test packages/api/src/rss-parse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems } from "./rss-parse.ts";

// ---------------------------------------------------------------------------
// RSS 2.0 sample
// ---------------------------------------------------------------------------

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test OSINT Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Drone strike hits Ryazan refinery</title>
      <link>https://example.com/ryazan-drone-strike</link>
      <description><![CDATA[Multiple UAVs struck the Ryazan Oil Refinery causing a fire.]]></description>
      <pubDate>Thu, 12 Jun 2026 08:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Attack on Nizhnekamsk petrochemical plant</title>
      <link>https://example.com/nizhnekamsk-attack</link>
      <description>Explosion reported at Nizhnekamsk facility.</description>
      <pubDate>Fri, 11 Jun 2026 14:30:00 +0000</pubDate>
    </item>
    <item>
      <title>No link item — should be skipped</title>
      <description>This item has no http link</description>
      <pubDate>Fri, 11 Jun 2026 10:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Relative link — should be skipped</title>
      <link>/relative/path</link>
      <pubDate>Fri, 11 Jun 2026 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

test("RSS 2.0: parses two valid items, skips two without http links", () => {
  const items = parseRssItems(RSS_SAMPLE);
  assert.equal(items.length, 2);
});

test("RSS 2.0: first item title and link parsed correctly", () => {
  const items = parseRssItems(RSS_SAMPLE);
  const first = items[0];
  assert.ok(first, "first item must exist");
  assert.equal(first.title, "Drone strike hits Ryazan refinery");
  assert.equal(first.link, "https://example.com/ryazan-drone-strike");
});

test("RSS 2.0: CDATA description extracted and tags stripped", () => {
  const items = parseRssItems(RSS_SAMPLE);
  const first = items[0];
  assert.ok(first, "first item must exist");
  assert.ok(first.summary.includes("UAVs"));
});

test("RSS 2.0: pubDate parsed to YYYY-MM-DD UTC", () => {
  const items = parseRssItems(RSS_SAMPLE);
  const first = items[0];
  const second = items[1];
  assert.ok(first, "first item must exist");
  assert.ok(second, "second item must exist");
  assert.equal(first.pubDate, "2026-06-12");
  assert.equal(second.pubDate, "2026-06-11");
});

test("RSS 2.0: second item plain description text is extracted", () => {
  const items = parseRssItems(RSS_SAMPLE);
  const second = items[1];
  assert.ok(second, "second item must exist");
  assert.ok(second.summary.includes("Explosion"));
});

// ---------------------------------------------------------------------------
// Atom 1.0 sample
// ---------------------------------------------------------------------------

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Militarnyi EN</title>
  <entry>
    <title>Ukraine drones strike Saratov depot</title>
    <link rel="alternate" href="https://militarnyi.com/en/saratov-depot-strike"/>
    <published>2026-06-12T07:45:00Z</published>
    <summary>Ukrainian UAV formation attacked the Saratov fuel depot overnight.</summary>
  </entry>
  <entry>
    <title>Naval update — no strike</title>
    <link rel="alternate" href="https://militarnyi.com/en/naval-update"/>
    <updated>2026-06-11T12:00:00Z</updated>
  </entry>
  <entry>
    <title>Unparseable link entry</title>
    <link rel="alternate" href="feed://bad-protocol/path"/>
    <published>2026-06-10T00:00:00Z</published>
  </entry>
</feed>`;

test("Atom 1.0: parses two valid entries, skips non-http link", () => {
  const items = parseRssItems(ATOM_SAMPLE);
  assert.equal(items.length, 2);
});

test("Atom 1.0: title and link href extracted", () => {
  const items = parseRssItems(ATOM_SAMPLE);
  const first = items[0];
  assert.ok(first, "first entry must exist");
  assert.equal(first.title, "Ukraine drones strike Saratov depot");
  assert.equal(first.link, "https://militarnyi.com/en/saratov-depot-strike");
});

test("Atom 1.0: published date parsed to YYYY-MM-DD", () => {
  const items = parseRssItems(ATOM_SAMPLE);
  const first = items[0];
  assert.ok(first, "first entry must exist");
  assert.equal(first.pubDate, "2026-06-12");
});

test("Atom 1.0: summary extracted", () => {
  const items = parseRssItems(ATOM_SAMPLE);
  const first = items[0];
  assert.ok(first, "first entry must exist");
  assert.ok(first.summary.includes("UAV"));
});

test("Atom 1.0: entry with only updated date falls back correctly", () => {
  const items = parseRssItems(ATOM_SAMPLE);
  const second = items[1];
  assert.ok(second, "second entry must exist");
  assert.equal(second.pubDate, "2026-06-11");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("empty string returns empty array", () => {
  assert.deepEqual(parseRssItems(""), []);
});

test("non-XML garbage returns empty array", () => {
  assert.deepEqual(parseRssItems("not xml at all"), []);
});

test("item with unparseable date gets pubDate empty string", () => {
  const xml = `<rss><channel>
    <item>
      <title>Dated weirdly</title>
      <link>https://example.com/dated</link>
      <pubDate>not-a-real-date</pubDate>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  const first = items[0];
  assert.ok(first, "first item must exist");
  assert.equal(first.pubDate, "");
});

test("XML entities in title are decoded", () => {
  const xml = `<rss><channel>
    <item>
      <title>Strike &amp; fire at facility</title>
      <link>https://example.com/strike</link>
      <pubDate>Thu, 12 Jun 2026 08:00:00 +0000</pubDate>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  const first = items[0];
  assert.ok(first, "first item must exist");
  assert.equal(first.title, "Strike & fire at facility");
});

test("item with no title gets placeholder", () => {
  const xml = `<rss><channel>
    <item>
      <link>https://example.com/no-title</link>
      <pubDate>Thu, 12 Jun 2026 08:00:00 +0000</pubDate>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  const first = items[0];
  assert.ok(first, "first item must exist");
  assert.equal(first.title, "(no title)");
});
