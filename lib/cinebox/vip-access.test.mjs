import test from "node:test";
import assert from "node:assert/strict";
import {
  VIP_EARLY_ACCESS_WINDOW_MS,
  accessMode,
  applySharedVipRestrictions,
  canAccessContent,
  catalogVisibilitySql,
  filterAccessibleTitles,
  filterVisibleTitles,
  normalizeVipFlags,
  parsePublicAt,
  sanitizeTitleForViewer,
  validateVipSettings,
  vipAccessState,
  vipEarlyAccessStart,
  vipStatusLabel,
} from "./vip-access.mjs";

const HOUR = 60 * 60 * 1000;
// Black Clover scenario: public release on 2026-11-15 15:00 UTC.
const PUBLIC_AT_MS = Date.parse("2026-11-15T15:00:00.000Z");
const WINDOW_START_MS = PUBLIC_AT_MS - VIP_EARLY_ACCESS_WINDOW_MS;
const PUBLIC_AT = new Date(PUBLIC_AT_MS).toISOString();
const WINDOW_START = new Date(WINDOW_START_MS).toISOString();
const NOW_SCHEDULED = WINDOW_START_MS - HOUR;
const NOW_EARLY = WINDOW_START_MS + HOUR;
const NOW_EARLY_END = PUBLIC_AT_MS - 1;

const publicTitle = { vipExclusive: false, vipEarlyAccess: false, publicAt: null };
const exclusiveTitle = { vipExclusive: true, vipEarlyAccess: false, publicAt: null };
const earlyTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: PUBLIC_AT };
const invalidEarlyTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: "not-a-date" };
const missingDateEarlyTitle = { vipExclusive: false, vipEarlyAccess: true, publicAt: null };

const guest = { authenticated: false, vip: false, admin: false };
const classic = { authenticated: true, vip: false, admin: false };
const vip = { authenticated: true, vip: true, admin: false };
const admin = { authenticated: true, vip: false, admin: true };

test("flags are normalised and exclusive wins over a contradictory early flag", () => {
  assert.deepEqual(normalizeVipFlags({ vipExclusive: true, vipEarlyAccess: true, publicAt: PUBLIC_AT }), {
    vipExclusive: true,
    vipEarlyAccess: false,
    publicAt: PUBLIC_AT,
    publicAtMs: PUBLIC_AT_MS,
  });
  assert.equal(accessMode(publicTitle), "public");
  assert.equal(accessMode(exclusiveTitle), "vip-exclusive");
  assert.equal(accessMode(earlyTitle), "early-access");
  assert.equal(parsePublicAt(""), null);
  assert.equal(parsePublicAt("nope"), null);
  assert.equal(parsePublicAt(PUBLIC_AT), PUBLIC_AT_MS);
});

test("the early-access state only opens 48 hours before the public date", () => {
  assert.equal(vipAccessState(earlyTitle, WINDOW_START_MS - 1), "scheduled");
  assert.equal(vipAccessState(earlyTitle, NOW_SCHEDULED), "scheduled");
  assert.equal(vipAccessState(earlyTitle, WINDOW_START_MS), "early");
  assert.equal(vipAccessState(earlyTitle, NOW_EARLY), "early");
  assert.equal(vipAccessState(earlyTitle, NOW_EARLY_END), "early");
  assert.equal(vipAccessState(earlyTitle, PUBLIC_AT_MS), "public");
  assert.equal(vipAccessState(earlyTitle, PUBLIC_AT_MS + HOUR), "public");
  // A missing or invalid mandatory date fails closed for every viewer.
  assert.equal(vipAccessState(invalidEarlyTitle, NOW_EARLY), "invalid");
  assert.equal(vipAccessState(missingDateEarlyTitle, NOW_EARLY), "invalid");
  assert.equal(vipAccessState(exclusiveTitle, NOW_EARLY), "vip");
  assert.equal(vipAccessState(publicTitle, NOW_EARLY), "public");
});

test("the VIP window start is exactly public_at minus 48 hours", () => {
  assert.equal(vipEarlyAccessStart(earlyTitle), WINDOW_START_MS);
  assert.equal(new Date(vipEarlyAccessStart(earlyTitle)).toISOString(), WINDOW_START);
  assert.equal(vipEarlyAccessStart(publicTitle), null);
  assert.equal(vipEarlyAccessStart(exclusiveTitle), null);
  assert.equal(vipEarlyAccessStart(invalidEarlyTitle), null);
  assert.equal(vipEarlyAccessStart(missingDateEarlyTitle), null);
  assert.equal(VIP_EARLY_ACCESS_WINDOW_MS, 48 * HOUR);
});

test("access matrix: before the window nobody, during the window VIP only, after everyone", () => {
  const rows = [
    ["public", publicTitle, NOW_SCHEDULED, [true, true, true, true]],
    ["exclusive", exclusiveTitle, NOW_SCHEDULED, [false, false, true, false]],
    // Black Clover before 2026-11-13 15:00 UTC: even VIP and admin are refused.
    ["scheduled", earlyTitle, NOW_SCHEDULED, [false, false, false, false]],
    ["window-start", earlyTitle, WINDOW_START_MS, [false, false, true, false]],
    ["early", earlyTitle, NOW_EARLY, [false, false, true, false]],
    ["early-last-ms", earlyTitle, NOW_EARLY_END, [false, false, true, false]],
    ["public-boundary", earlyTitle, PUBLIC_AT_MS, [true, true, true, true]],
    ["public-after", earlyTitle, PUBLIC_AT_MS + HOUR, [true, true, true, true]],
    ["invalid", invalidEarlyTitle, NOW_EARLY, [false, false, false, false]],
    ["missing-date", missingDateEarlyTitle, NOW_EARLY, [false, false, false, false]],
  ];
  const viewers = [guest, classic, vip, admin];
  for (const [name, row, now, expected] of rows) {
    viewers.forEach((viewer, index) => {
      assert.equal(canAccessContent(row, viewer, now), expected[index], `${name} / viewer ${index}`);
    });
  }
});

test("catalogue visibility includes scheduled premieres while playback policy stays separate", () => {
  const entitled = catalogVisibilitySql(true, { now: new Date(NOW_SCHEDULED).toISOString() });
  assert.match(entitled.sql, /vip_exclusive\)?=1/);
  assert.match(entitled.sql, /datetime\(public_at\)/);
  assert.deepEqual(entitled.params, []);

  const guestSql = catalogVisibilitySql(false, { now: new Date(NOW_SCHEDULED).toISOString() });
  assert.match(guestSql.sql, /vip_exclusive\)?=1/);
  assert.match(guestSql.sql, /vip_early_access\)?=0/);
  assert.match(guestSql.sql, /datetime\(public_at\) IS NOT NULL/);
  assert.deepEqual(guestSql.params, []);

  const prefixed = catalogVisibilitySql(false, { prefix: "t." });
  assert.match(prefixed.sql, /t\.vip_exclusive\)?=1/);
  assert.match(prefixed.sql, /datetime\(t\.public_at\)/);
  assert.deepEqual(prefixed.params, []);
});

test("administration settings reject contradictory modes and missing dates", () => {
  assert.deepEqual(validateVipSettings({ vipExclusive: true, vipEarlyAccess: false, publicAt: null }), {
    ok: true,
    value: { vipExclusive: true, vipEarlyAccess: false, publicAt: null },
  });
  assert.deepEqual(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: PUBLIC_AT }), {
    ok: true,
    value: { vipExclusive: false, vipEarlyAccess: true, publicAt: PUBLIC_AT },
  });
  assert.equal(validateVipSettings({ vipExclusive: true, vipEarlyAccess: true, publicAt: PUBLIC_AT }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: null }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: false, vipEarlyAccess: true, publicAt: "bad" }).ok, false);
  assert.equal(validateVipSettings({ vipExclusive: "yes", vipEarlyAccess: false }).ok, false);
  // Public/exclusive modes always clear a leftover date.
  assert.deepEqual(validateVipSettings({ vipExclusive: false, vipEarlyAccess: false, publicAt: PUBLIC_AT }), {
    ok: true,
    value: { vipExclusive: false, vipEarlyAccess: false, publicAt: null },
  });
});

test("status labels reflect the real audience, including a scheduled premiere", () => {
  assert.equal(vipStatusLabel(exclusiveTitle, NOW_EARLY).label, "Exclusif VIP");
  assert.equal(vipStatusLabel(earlyTitle, NOW_SCHEDULED).label, "Avant-première programmée");
  assert.equal(vipStatusLabel(earlyTitle, NOW_EARLY).label, "Avant-première VIP");
  assert.equal(vipStatusLabel(earlyTitle, PUBLIC_AT_MS).label, "Public — avant-première terminée");
  assert.equal(vipStatusLabel(invalidEarlyTitle, NOW_EARLY).label, "Configuration VIP invalide");
  assert.equal(vipStatusLabel(publicTitle, NOW_EARLY).label, "Public");
});

test("client filters follow the same 48-hour window as the server", () => {
  const titles = [publicTitle, exclusiveTitle, earlyTitle];

  // Before the window: the scheduled premiere is hidden from VIPs as well,
  // while an already VIP-exclusive title stays visible to entitled viewers.
  assert.deepEqual(filterAccessibleTitles(titles, classic, NOW_SCHEDULED), [publicTitle]);
  assert.deepEqual(filterAccessibleTitles(titles, vip, NOW_SCHEDULED), [publicTitle, exclusiveTitle]);
  assert.deepEqual(filterAccessibleTitles(titles, admin, NOW_SCHEDULED), [publicTitle]);

  // Inside the window: active VIP members only; admin role alone is not a VIP pass.
  assert.deepEqual(filterAccessibleTitles(titles, classic, NOW_EARLY), [publicTitle]);
  assert.deepEqual(filterAccessibleTitles(titles, admin, NOW_EARLY), [publicTitle]);
  assert.deepEqual(filterAccessibleTitles(titles, vip, NOW_EARLY), titles);

  // From the public date: everyone.
  assert.deepEqual(filterAccessibleTitles(titles, classic, PUBLIC_AT_MS), [publicTitle, earlyTitle]);
});

test("catalogue display keeps scheduled premieres visible but strips playback until entitlement", () => {
  const teaser = { ...earlyTitle, videoUrl: "https://video.example/secret" };
  const visibleGuest = filterVisibleTitles([teaser], guest, NOW_SCHEDULED);
  assert.equal(visibleGuest.length, 1);
  assert.equal(visibleGuest[0].videoUrl, undefined);
  assert.equal(filterVisibleTitles([teaser], vip, NOW_SCHEDULED)[0].videoUrl, undefined);
  assert.equal(filterVisibleTitles([teaser], vip, NOW_EARLY)[0].videoUrl, "https://video.example/secret");
  assert.equal(filterVisibleTitles([teaser], guest, PUBLIC_AT_MS)[0].videoUrl, "https://video.example/secret");
  assert.deepEqual(filterVisibleTitles([{ ...invalidEarlyTitle }], guest, NOW_SCHEDULED), []);
  assert.deepEqual(filterVisibleTitles([exclusiveTitle], guest, NOW_EARLY), [exclusiveTitle]);
  assert.deepEqual(filterVisibleTitles([exclusiveTitle], vip, NOW_EARLY), [exclusiveTitle]);
});

test("client filters strip every video URL outside the allowed audience", () => {
  const leaked = sanitizeTitleForViewer({
    ...earlyTitle,
    videoUrl: "https://video.example/secret",
    sources: [{ playbackUrl: "https://video.example/secret" }],
    seasons: [{ number: 1, episodes: [{ number: 1, videoUrl: "https://video.example/e1" }] }],
  }, vip, NOW_SCHEDULED);
  assert.equal(leaked.videoUrl, undefined);
  assert.equal(leaked.sources, undefined);
  assert.equal(leaked.seasons[0].episodes[0].videoUrl, undefined);

  const vipInWindow = sanitizeTitleForViewer({
    ...earlyTitle,
    videoUrl: "https://video.example/vip",
  }, vip, NOW_EARLY);
  assert.equal(vipInWindow.videoUrl, "https://video.example/vip");

  const exclusiveGuest = sanitizeTitleForViewer({
    ...exclusiveTitle,
    videoUrl: "https://video.example/exclusive",
  }, guest, NOW_EARLY);
  assert.equal(exclusiveGuest.videoUrl, undefined);
  assert.equal(exclusiveGuest.vipExclusive, true);
});

test("personal copies inherit the shared catalogue's VIP flags and public date", () => {
  const local = [
    { id: 1, name: "Copie locale", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42" },
    { id: 2, name: "Titre perso", kind: "Film", tmdbId: 99 },
  ];
  const shared = [
    { id: 3, name: "Titre partagé", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42", vipExclusive: false, vipEarlyAccess: true, publicAt: PUBLIC_AT },
  ];
  const [restricted, untouched] = applySharedVipRestrictions(local, shared);
  assert.equal(restricted.vipEarlyAccess, true);
  assert.equal(restricted.publicAt, PUBLIC_AT);
  assert.equal(untouched.vipEarlyAccess, undefined);

  // The local copy obeys the same window: hidden before it, visible during it.
  assert.deepEqual(filterAccessibleTitles([restricted], vip, NOW_SCHEDULED), []);
  assert.equal(filterAccessibleTitles([restricted], vip, NOW_EARLY).length, 1);
  assert.deepEqual(filterAccessibleTitles([restricted], classic, NOW_EARLY), []);
  assert.equal(filterAccessibleTitles([restricted], classic, PUBLIC_AT_MS).length, 1);
});

test("exclusive local copies still inherit the exclusive rights", () => {
  const local = [{ id: 1, name: "Copie locale", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42" }];
  const shared = [{ id: 3, name: "Titre partagé", kind: "Film", tmdbId: 42, sharedId: "tmdb:movie:42", vipExclusive: true, vipEarlyAccess: false }];
  const [restricted] = applySharedVipRestrictions(local, shared);
  assert.equal(restricted.vipExclusive, true);
  assert.deepEqual(filterAccessibleTitles([restricted], classic, NOW_EARLY), []);
  assert.equal(filterAccessibleTitles([restricted], vip, NOW_EARLY).length, 1);
});
