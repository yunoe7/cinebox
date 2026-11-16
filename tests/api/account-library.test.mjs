import test from "node:test";
import assert from "node:assert/strict";
import { createAccountLibrary, isAccountLibrary, mergeLibraries, mergeTitleEdits } from "../../lib/cinebox/account-library.mjs";

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

test("mergeLibraries preserves an intentional favorite removal", () => {
  const base = createAccountLibrary({ favorites: [1, 2] }, []);
  const local = createAccountLibrary({ favorites: [2] }, []); // removed 1
  const server = createAccountLibrary({ favorites: [1, 2] }, []); // unchanged
  const merged = mergeLibraries(local, server, base);
  assert.deepEqual(merged.favorites, [2]);
});

test("mergeLibraries preserves an intentional progress reset", () => {
  const base = createAccountLibrary({ playback: { "1": { currentSeconds: 100, progress: 50, episodes: {} } } }, []);
  const local = createAccountLibrary({ playback: { "1": { currentSeconds: 0, progress: 0, episodes: {} } } }, []); // reset
  const server = createAccountLibrary({ playback: { "1": { currentSeconds: 100, progress: 50, episodes: {} } } }, []); // unchanged
  const merged = mergeLibraries(local, server, base);
  assert.equal(merged.playback["1"].progress, 0);
  assert.equal(merged.playback["1"].currentSeconds, 0);
});

test("mergeLibraries keeps a favorite added by another tab", () => {
  const base = createAccountLibrary({ favorites: [1] }, []);
  const local = createAccountLibrary({ favorites: [1] }, []); // no change
  const server = createAccountLibrary({ favorites: [1, 2] }, []); // added 2
  const merged = mergeLibraries(local, server, base);
  assert.deepEqual(merged.favorites.sort(), [1, 2]);
});

test("mergeLibraries handles concurrent modification of the same favorite", () => {
  // base: favorite 1 present
  const base = createAccountLibrary({ favorites: [1] }, []);
  // local removes 1, server keeps 1 (unchanged) -> removal wins
  const local = createAccountLibrary({ favorites: [] }, []);
  const server = createAccountLibrary({ favorites: [1] }, []);
  const merged = mergeLibraries(local, server, base);
  assert.deepEqual(merged.favorites, []);
});

test("mergeLibraries keeps server-added favorite when local unchanged", () => {
  const base = createAccountLibrary({ favorites: [1] }, []);
  const local = createAccountLibrary({ favorites: [1] }, []);
  const server = createAccountLibrary({ favorites: [1, 2] }, []);
  const merged = mergeLibraries(local, server, base);
  assert.deepEqual(merged.favorites.sort(), [1, 2]);
});

test("mergeTitleEdits merges seasons and episodes by number", () => {
  const base = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1", progress: 0 }] }] };
  const latest = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1", progress: 10 }] }] };
  const edited = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1 renamed", progress: 0 }] }] };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.seasons[0].episodes[0].title, "Ep1 renamed");
  assert.equal(merged.seasons[0].episodes[0].progress, 10);
});

test("mergeLibraries preserves titles removed locally", () => {
  const t = (id) => ({ id, name: `T${id}`, kind: "Film", year: 2024, genre: "Drame", description: "", poster: "", backdrop: "", progress: 0, duration: "" });
  const base = createAccountLibrary({}, [t(1), t(2)]);
  const local = createAccountLibrary({}, [t(2)]); // removed 1
  const server = createAccountLibrary({}, [t(1), t(2)]); // unchanged
  const merged = mergeLibraries(local, server, base);
  assert.deepEqual(merged.titles.map((x) => x.id), [2]);
});

test("mergeLibraries preserves a voluntary progress reset to zero", () => {
  const base = createAccountLibrary({ playback: { "1": { currentSeconds: 100, progress: 50, episodes: {} } } }, []);
  const local = createAccountLibrary({ playback: { "1": { currentSeconds: 0, progress: 0, episodes: {} } } }, []);
  const server = createAccountLibrary({ playback: { "1": { currentSeconds: 100, progress: 50, episodes: {} } } }, []);
  const merged = mergeLibraries(local, server, base);
  assert.equal(merged.playback["1"].progress, 0);
  assert.equal(merged.playback["1"].currentSeconds, 0);
});

test("mergeTitleEdits preserves non-conflicting field changes", () => {
  const base = { id: 1, name: "Base", description: "desc", rating: 5 };
  const latest = { id: 1, name: "Renamed", description: "desc", rating: 5 };
  const edited = { id: 1, name: "Base", description: "new desc", rating: 5 };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.name, "Renamed");
  assert.equal(merged.description, "new desc");
});

test("mergeTitleEdits resolves conflicting field with server winning", () => {
  const base = { id: 1, name: "Base", description: "desc" };
  const latest = { id: 1, name: "ServerName", description: "desc" };
  const edited = { id: 1, name: "LocalName", description: "desc" };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.name, "ServerName");
});

test("mergeTitleEdits merges seasons and episodes by number", () => {
  const base = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1", progress: 0 }] }] };
  const latest = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1", progress: 10 }] }] };
  const edited = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Ep1 renamed", progress: 0 }] }] };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.seasons[0].episodes[0].title, "Ep1 renamed");
  assert.equal(merged.seasons[0].episodes[0].progress, 10);
});
