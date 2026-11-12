import test from "node:test";
import assert from "node:assert/strict";
import { addAccountView, emptyAccountData, overlayAccountData } from "./account-data.mjs";

test("empty account data has one personal library", () => {
  assert.deepEqual(emptyAccountData(), {
    favorites: [], playback: {}, history: [], viewCounts: {}, preferences: { autoplayNext: true },
  });
});

test("account views are recorded and immediate duplicate views are ignored", () => {
  const first = addAccountView(emptyAccountData(), 42, 100_000);
  assert.equal(first.viewCounts["42"], 1);
  assert.deepEqual(first.history, [{ titleId: 42, viewedAt: 100_000 }]);
  const duplicate = addAccountView(first, 42, 110_000);
  assert.equal(duplicate, first);
  const replay = addAccountView(first, 42, 131_000);
  assert.equal(replay.viewCounts["42"], 2);
  assert.equal(replay.history.length, 2);
});

test("account playback overlays titles and episodes without profile filtering", () => {
  const data = emptyAccountData();
  data.playback["7"] = {
    assetKey: "7:video", currentTime: 90, progress: 25,
    episodes: { "1:2": { assetKey: "7:episode:1:2", currentTime: 45, progress: 50 } },
  };
  data.viewCounts["7"] = 3;
  const [title] = overlayAccountData([{
    id: 7, name: "Series", progress: 0, currentTime: 0,
    seasons: [{ number: 1, episodes: [{ number: 2, progress: 0, currentTime: 0 }] }],
  }], data);
  assert.equal(title.progress, 25);
  assert.equal(title.currentTime, 90);
  assert.equal(title.viewCount, 3);
  assert.equal(title.seasons[0].episodes[0].progress, 50);
  assert.equal(title.seasons[0].episodes[0].currentTime, 45);
});
