import test from "node:test";
import assert from "node:assert/strict";
import { validLibrary } from "../../functions/api/account/library.ts";

const valid = {
  version: 1,
  titles: [{
    id: 1, name: "Film", kind: "Film", year: 2024, genre: "Drame",
    description: "Description", poster: "", backdrop: "", progress: 0, duration: "2h",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Episode 1", progress: 0 }] }],
  }],
  favorites: [1],
  playback: { "1": { currentTime: 10, progress: 5, episodes: { "1:1": { currentTime: 4, progress: 2 } } } },
  history: [{ titleId: 1, viewedAt: 123 }],
  viewCounts: { "1": 2 },
  preferences: { autoplayNext: true },
};

test("accepts a well-formed account library", () => {
  assert.equal(validLibrary(valid), true);
});

test("rejects malformed title and nested season/episode data", () => {
  for (const mutate of [
    (value) => { value.titles[0].name = ""; },
    (value) => { value.titles[0].kind = "Other"; },
    (value) => { value.titles[0].progress = 101; },
    (value) => { value.titles[0].seasons[0].episodes[0].number = -1; },
    (value) => { value.titles[0].seasons[0].episodes = "not-an-array"; },
  ]) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.equal(validLibrary(candidate), false);
  }
});

test("rejects malformed account activity and playback values", () => {
  for (const mutate of [
    (value) => { value.favorites = [0]; },
    (value) => { value.history[0].viewedAt = -1; },
    (value) => { value.viewCounts["1"] = -1; },
    (value) => { value.playback["1"].progress = 101; },
    (value) => { value.playback["1"].episodes["bad"] = { currentTime: 1 }; },
  ]) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.equal(validLibrary(candidate), false);
  }
});

test("rejects excessive object depth and oversized collection counts", () => {
  const tooManyTitles = structuredClone(valid);
  tooManyTitles.titles = Array.from({ length: 301 }, (_, index) => ({ ...valid.titles[0], id: index + 1 }));
  assert.equal(validLibrary(tooManyTitles), false);

  const tooDeep = structuredClone(valid);
  let nested = tooDeep;
  for (let index = 0; index < 14; index++) {
    nested.extra = {};
    nested = nested.extra;
  }
  assert.equal(validLibrary(tooDeep), false);
});
