import test from "node:test";
import assert from "node:assert/strict";
import { createAccountLibrary, isAccountLibrary } from "../../lib/cinebox/account-library.mjs";

test("account library strips device-local media URLs and asset keys", () => {
  const library = createAccountLibrary({
    favorites: [1, 1, "2"],
    playback: { "1": { currentTime: 12, progress: 20, assetKey: "1:video", episodes: { "1:1": { currentTime: 4, progress: 10, assetKey: "ep" } } } },
    history: [{ titleId: 1, viewedAt: 123 }, { titleId: "bad", viewedAt: 1 }],
    viewCounts: { "1": 3 },
    preferences: { autoplayNext: false },
  }, [{
    id: 1, name: "Test", kind: "Film", year: 2024, genre: "Drame", description: "Test",
    poster: "blob:https://cinebox.test/local", posterAssetKey: "poster-key",
    backdrop: "https://cdn.example/backdrop.jpg", videoUrl: "blob:https://cinebox.test/video",
    videoAssetKey: "video-key",
    seasons: [{ number: 1, posterUrl: "blob:https://cinebox.test/season", posterAssetKey: "season-key",
      episodes: [{ number: 1, title: "Épisode", videoUrl: "blob:https://cinebox.test/episode", videoAssetKey: "episode-key",
        thumbnailUrl: "blob:https://cinebox.test/thumb", thumbnailAssetKey: "thumb-key" }] }],
  }]);

  assert.equal(isAccountLibrary(library), true);
  assert.deepEqual(library.favorites, [1]);
  assert.equal(library.history.length, 1);
  assert.equal(library.titles[0].poster, "");
  assert.equal(library.titles[0].backdrop, "https://cdn.example/backdrop.jpg");
  assert.equal("videoUrl" in library.titles[0], false);
  assert.equal("videoAssetKey" in library.titles[0], false);
  assert.equal(library.titles[0].seasons[0].posterUrl, "");
  assert.equal("posterAssetKey" in library.titles[0].seasons[0], false);
  assert.equal("videoUrl" in library.titles[0].seasons[0].episodes[0], false);
  assert.equal(library.titles[0].seasons[0].episodes[0].thumbnailUrl, "");
  assert.equal(library.playback["1"].currentTime, 12);
  assert.equal("assetKey" in library.playback["1"], false);
  assert.equal("assetKey" in library.playback["1"].episodes["1:1"], false);
  assert.equal(library.preferences.autoplayNext, false);
});
