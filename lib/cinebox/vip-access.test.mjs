import test from "node:test";
import assert from "node:assert/strict";
import {
  accessMode,
  applySharedVipRestrictions,
  canAccessContent,
  catalogVisibilitySql,
  filterAccessibleTitles,
  normalizeVipFlags,
  parsePublicAt,
  sanitizeTitleForViewer,
  validateVipSettings,
  vipAccessState,
  vipStatusLabel,
} from "./vip-access.mjs";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const PAST = "2026-11-12T12:00:00.000Z";
const FUTURE = "2026-11-14T12:00:00.000Z";

const publicTitle = { vipExclusive: false, vipEarlyAccess: false, publicAt: null };
const exclusiveTitle = { vipExclusive: true, vipEarlyAccess: false, publicAt: null };
const earlyTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: FUTURE };
const earlyPublicTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: PAST };
const malformedEarlyTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: "not-a-date" };

const guest = { authenticated: false, vip: false, admin: false };
const classic = { authenticated: true, vip: false, admin: false };
const vip = { authenticated: true, vip: true, admin: false };
const admin = { authenticated: true, vip: false, admin: true };

test("flags are normalised and exclusive wins over a contradictory early flag", () => {
  assert.deepEqual(normalizeVipFlags({ vipExclusive: true, vipEarlyAccess: true, publicAt: FUTURE }), {
    vipExclusive: true,
    vipEarlyAccess: false,
    publicAt: FUTURE,
    publicAtMs: Date.parse(FUTURE),
  });
  assert.equal(accessMode(publicTitle), "public");
  assert.equal(accessMode(exclusiveTitle), "vip-exclusive");
  assert.equal(accessMode(earlyTitle), "early-access");
  assert.equal(parsePublicAt(""), null);
  assert.equal(parsePublicAt("nope"), null);
  assert.equal(parsePublicAt(FUTURE), Date.parse(FUTURE));
});

test("early access state switches automatically at the public date", () => {
  assert.equal(vipAccessState(earlyTitle, NOW), "early");
  assert.equal(vipAccessState(earlyTitle, Date.parse(FUTURE)), "public");
  assert.equal(vipAccessState(earlyTitle, Date.parse(FUTURE) - 1), "early");
  assert.equal(vipAccessState(earlyPublicTitle, NOW), "public");
  // A missing or invalid mandatory date fails closed: VIP only.
  assert.equal(vipAccessState(malformedEarlyTitle, NOW), "vip");
  assert.equal(vipAccessState({ vipEarlyAccess: true, publicAt: null }, NOW), "vip");
  assert.equal(vipAccessState(exclusiveTitle, NOW), "vip");
});

test("access matrix: public / VIP-exclusive / early-before / early-after × guest / classic / VIP / admin", () => {
  const rows = [
    ["public", publicTitle, [true, true, true, true]],
    ["exclusive", exclusiveTitle, [false, false, true, true]],
    ["early-before", earlyTitle, [false, false, true, true]],
    ["early-after", earlyPublicTitle, [true, true, true, true]],
  ];
  const viewers = [guest, classic, vip, admin];
  for (const [name, row, expected] of rows) {
    viewers.forEach((viewer, index) => {
      assert.equal(canAccessContent(row, viewer, NOW), expected[index], `${name} / viewer ${index}`);
    });
  }
  assert.equal(canAccessContent(malformedEarlyTitle, classic, NOW), false);
  assert.equal(canAccessContent(malformedEarlyTitle, vip, NOW), true);
});

test("SQL predicate keeps VIP rows visible for entitled viewers and filters guests", () => {
  assert.deepEqual(catalogVisibilitySql(true), { sql: "1=1", params: [] });
  const guestSql = catalogVisibilitySql(false, { now: new Date(NOW).toISOString() });
  assert.match(guestSql.sql, /vip_exclusive=0/);
  assert.match(guestSql.sql, /public_at/);
  assert.deepEqual(guestSql.params, [new Date(NOW).toISOString()]);
  const prefixed = catalogVisibilitySql(false, { now: "2026-01-01T00:00:00.000Z", prefix: "t." });
  assert.match(prefixed.sql, /t\.vip_exclusive=0/);
  assert.match(prefixed.sql, /t\.public_at/);
});

test("administration settings reject contradictory modes and missing dates", () => {
  assert.deepEqual(validateVipSettings({ vipExclusive: true, vipEarlyAccess: false, publicAt: null }), {
    ok: true,
    value: { vipExclusive: true, vipEarlyAccess: false, publicAt: null },
  });
  assert.deepEqual(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: FUTURE }), {
    ok: true,
    value: { vipExclusive: false, vipEarlyAccess: true, publicAt: FUTURE },
  });
  assert.equal(validateVipSettings({ vipExclusive: true, vipEarlyAccess: true, publicAt: FUTURE }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: null }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: "bad" }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: "yes", vipEarlyAccess: false }).ok, false);
  // Public/exclusive modes always clear a leftover date.
  assert.deepEqual(validateVipSettings({ vipExclusive: false, vipEarlyAccess: false, publicAt: FUTURE }), {
    ok: true,
    value: { vipExclusive: false, vipEarlyAccess: false, publicAt: null },
  });
});

test("status labels reflect the real audience", () => {
  assert.equal(vipStatusLabel(exclusiveTitle, NOW).label, "Exclusif VIP");
  assert.equal(vipStatusLabel(earlyTitle, NOW).label, "Avant-première VIP");
  assert.equal(vipStatusLabel(earlyPublicTitle, NOW).label, "Public — avant-première terminée");
  assert.equal(vipStatusLabel(publicTitle, NOW).label, "Public");
});

test("client filters unentitled titles and strips every video URL", () => {
  const titles = [publicTitle, exclusiveTitle, earlyTitle, earlyPublicTitle];
  assert.deepEqual(filterAccessibleTitles(titles, classic, NOW), [publicTitle, earlyPublicTitle]);
  assert.deepEqual(filterAccessibleTitles(titles, vip, NOW), titles);

  const leaked = sanitizeTitleForViewer({
    ...exclusiveTitle,
    videoUrl: "https://video.example/secret",
    sources: [{ playbackUrl: "https://video.example/secret" }],
    seasons: [{ number: 1, episodes: [{ number: 1, videoUrl: "https://video.example/e1" }] }],
  }, classic, NOW);
  assert.equal(leaked.videoUrl, undefined);
  assert.equal(leaked.sources, undefined);
  assert.equal(leaked.seasons[0].episodes[0].videoUrl, undefined);
});

test("personal copies inherit the shared catalogue's VIP restrictions", () => {
  const local = [
    { id: 1, name: "Copie locale", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42" },
    { id: 2, name: "Titre perso", kind: "Film", tmdbId: 99 },
  ];
  const shared = [
    { id: 3, name: "Titre partagé", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42", vipExclusive: true, vipEarlyAccess: false, publicAt: undefined },
  ];
  const [restricted, untouched] = applySharedVipRestrictions(local, shared);
  assert.equal(restricted.vipExclusive, true);
  assert.equal(untouched.vipExclusive, undefined);
  assert.deepEqual(filterAccessibleTitles([restricted], classic, NOW), []);
  assert.equal(filterAccessibleTitles([restricted], vip, NOW).length, 1);
});
