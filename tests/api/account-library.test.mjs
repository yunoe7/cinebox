import test from "node:test";
import assert from "node:assert/strict";
import { createAccountLibrary, isAccountLibrary, mergeLibraries, mergeTitleEdits, persistLibrary } from "../../lib/cinebox/account-library.mjs";

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

test("mergeTitleEdits handles two rapid edits to different titles", () => {
  const base1 = { id: 1, name: "A", description: "d1" };
  const base2 = { id: 2, name: "B", description: "d2" };
  const v1 = mergeTitleEdits(base1, base1, { id: 1, name: "A1", description: "d1" });
  const v2 = mergeTitleEdits(base2, base2, { id: 2, name: "B2", description: "d2" });
  assert.equal(v1.name, "A1");
  assert.equal(v2.name, "B2");
});

test("mergeTitleEdits preserves both sequential edits", () => {
  const base = { id: 1, name: "Base", description: "desc", rating: 5 };
  const v1 = mergeTitleEdits(base, base, { id: 1, name: "V1", description: "desc", rating: 5 });
  const v2 = mergeTitleEdits(base, v1, { id: 1, name: "V1", description: "V2", rating: 5 });
  assert.equal(v2.name, "V1");
  assert.equal(v2.description, "V2");
});

test("persistLibrary retries on conflict and merges", async () => {
  const baseLib = createAccountLibrary({ favorites: [1] }, []);
  const localLib = createAccountLibrary({ favorites: [1, 2] }, []);
  let calls = 0;
  const saveFn = async (lib, rev) => {
    calls++;
    if (calls === 1) return { status: "conflict", revision: 5, library: createAccountLibrary({ favorites: [1, 3] }, []) };
    return { status: "saved", revision: 6 };
  };
  const res = await persistLibrary({ saveFn, initialLibrary: localLib, initialAccountData: { favorites: [1, 2] }, initialRevision: 1, baseLibrary: baseLib, maxAttempts: 3 });
  assert.equal(res.ok, true);
  assert.equal(res.revision, 6);
  assert.ok(res.accountData.favorites.includes(2));
  assert.ok(res.accountData.favorites.includes(3));
});

test("persistLibrary returns conflict after max attempts", async () => {
  const localLib = createAccountLibrary({ favorites: [1] }, []);
  const saveFn = async () => ({ status: "conflict", revision: 2, library: createAccountLibrary({ favorites: [2] }, []) });
  const res = await persistLibrary({ saveFn, initialLibrary: localLib, initialAccountData: { favorites: [1] }, initialRevision: 1, baseLibrary: null, maxAttempts: 2 });
  assert.equal(res.ok, false);
  assert.equal(res.conflict, true);
});

test("persistLibrary serializes two rapid saves via a queue", async () => {
  // Simulate the queue pattern used in app/page.tsx: each save waits for the previous.
  let chain = Promise.resolve();
  const revisions = [];
  const savedLibraries = [];
  const makeSaveFn = (deferred) => async (lib, rev) => {
    // defer resolution until the test resolves it
    await deferred.promise;
    revisions.push(rev);
    savedLibraries.push(lib);
    return { status: "saved", revision: rev + 1 };
  };

  const deferred1 = { promise: null, resolve: null };
  deferred1.promise = new Promise((r) => { deferred1.resolve = r; });
  const deferred2 = { promise: null, resolve: null };
  deferred2.promise = new Promise((r) => { deferred2.resolve = r; });

  let rev = 1;
  const baseLib = createAccountLibrary({ favorites: [] }, []);

  // First save queued
  const p1 = (async () => {
    const prev = chain;
    const op = (async () => {
      await prev.catch(() => {});
      const lib = createAccountLibrary({ favorites: [1] }, []);
      const res = await persistLibrary({ saveFn: makeSaveFn(deferred1), initialLibrary: lib, initialAccountData: { favorites: [1] }, initialRevision: rev, baseLibrary: null, maxAttempts: 1 });
      if (res.ok) rev = res.revision;
      return res;
    })();
    chain = op.catch(() => {});
    return op;
  })();

  // Second save queued before first resolves
  const p2 = (async () => {
    const prev = chain;
    const op = (async () => {
      await prev.catch(() => {});
      const lib = createAccountLibrary({ favorites: [1, 2] }, []);
      const res = await persistLibrary({ saveFn: makeSaveFn(deferred2), initialLibrary: lib, initialAccountData: { favorites: [1, 2] }, initialRevision: rev, baseLibrary: null, maxAttempts: 1 });
      if (res.ok) rev = res.revision;
      return res;
    })();
    chain = op.catch(() => {});
    return op;
  })();

  // Resolve first, then second
  deferred1.resolve();
  const r1 = await p1;
  assert.equal(r1.ok, true);
  // second should not have started yet
  assert.equal(revisions.length, 1);

  deferred2.resolve();
  const r2 = await p2;
  assert.equal(r2.ok, true);
  assert.equal(revisions.length, 2);
  // second started after first (revision incremented)
  assert.ok(revisions[1] > revisions[0] || revisions[1] === revisions[0] + 1);
  // both modifications preserved: second library contains both 1 and 2
  assert.ok(savedLibraries[1].favorites.includes(1));
  assert.ok(savedLibraries[1].favorites.includes(2));
});


test("enqueueLibraryWrite serializes real queued tasks and survives a rejection", async () => {
  const { enqueueLibraryWrite } = await import("../../lib/cinebox/account-library.mjs");
  const queue = { current: Promise.resolve() };
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const started = [];
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  const first = enqueueLibraryWrite(queue, async () => {
    started.push("first");
    signalFirstStarted();
    await firstGate;
    throw new Error("expected failure");
  });
  const second = enqueueLibraryWrite(queue, async () => {
    started.push("second");
    return "saved";
  });
  await firstStarted;
  assert.deepEqual(started, ["first"]);
  releaseFirst();
  await assert.rejects(first, /expected failure/);
  assert.equal(await second, "saved");
  assert.deepEqual(started, ["first", "second"]);
});

test("mergeTitleEdits applies an intentional field deletion when server is unchanged", () => {
  const base = { id: 1, name: "Base", tagline: "old" };
  const latest = { id: 1, name: "Base", tagline: "old" };
  const edited = { id: 1, name: "Base" };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(Object.hasOwn(merged, "tagline"), false);
});

test("mergeTitleEdits keeps a server field when local did not change it", () => {
  const base = { id: 1, name: "Base", tagline: "old" };
  const latest = { id: 1, name: "Base", tagline: "server edit" };
  const edited = { id: 1, name: "Base" };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.tagline, "server edit");
});


test("mergeLibraries combines independent edits to the same title", () => {
  const title = (name, description) => ({ id: 7, name, description, kind: "Film", year: 2024, genre: "Drame", poster: "", backdrop: "", progress: 0, duration: "" });
  const base = createAccountLibrary({}, [title("Base", "base description")]);
  const local = createAccountLibrary({}, [title("Base", "local description")]);
  const server = createAccountLibrary({}, [title("server name", "base description")]);
  const merged = mergeLibraries(local, server, base);
  assert.equal(merged.titles[0].name, "server name");
  assert.equal(merged.titles[0].description, "local description");
});


test("mergeTitleEdits preserves local episode deletion when server is unchanged", () => {
  const base = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Keep" }, { number: 2, title: "Remove" }] }] };
  const latest = structuredClone(base);
  const edited = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Keep" }] }] };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.deepEqual(merged.seasons[0].episodes.map((episode) => episode.number), [1]);
});

test("mergeTitleEdits keeps server-edited episode when local deletes it", () => {
  const base = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Keep" }, { number: 2, title: "Old" }] }] };
  const latest = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Keep" }, { number: 2, title: "Server edit" }] }] };
  const edited = { id: 1, seasons: [{ number: 1, episodes: [{ number: 1, title: "Keep" }] }] };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.equal(merged.seasons[0].episodes.find((episode) => episode.number === 2).title, "Server edit");
});

test("mergeTitleEdits preserves local season deletion when server is unchanged", () => {
  const base = { id: 1, seasons: [{ number: 1, episodes: [] }, { number: 2, episodes: [] }] };
  const latest = structuredClone(base);
  const edited = { id: 1, seasons: [{ number: 1, episodes: [] }] };
  const merged = mergeTitleEdits(base, latest, edited);
  assert.deepEqual(merged.seasons.map((season) => season.number), [1]);
});


test("persistLibrary retries repeated concurrent library conflicts without losing local changes", async () => {
  const base = createAccountLibrary({ favorites: [1] }, []);
  const local = createAccountLibrary({ favorites: [1, 2] }, []);
  let calls = 0;
  const saveFn = async (library, revision) => {
    calls++;
    if (calls < 5) return { status: "conflict", revision: revision + 1, library: createAccountLibrary({ favorites: [1, 3 + calls] }, []) };
    assert.ok(library.favorites.includes(2));
    return { status: "saved", revision: revision + 1 };
  };
  const result = await persistLibrary({ saveFn, initialLibrary: local, initialAccountData: { favorites: [1, 2] }, initialRevision: 1, baseLibrary: base });
  assert.equal(result.ok, true);
  assert.equal(calls, 5);
  assert.ok(result.library.favorites.includes(2));
});
