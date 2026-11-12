import test from "node:test";
import assert from "node:assert/strict";
import { buildSeasonEditDraft } from "./series-edit.mjs";
import { playbackStateAfterEpisodeReplacement } from "./episode-playback.mjs";

const existingSeasons = [3, 8, 5].map((count, seasonIndex) => ({
  number: seasonIndex + 1,
  episodes: Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    title: `S${seasonIndex + 1}E${index + 1}`,
    videoAssetKey: `legacy-${seasonIndex + 1}-${index + 1}`,
  })),
}));

test("édition des informations préserve 3, 8 et 5 épisodes malgré un compte par défaut à 3", () => {
  const draft = buildSeasonEditDraft({
    existingSeasons,
    seasonCount: 3,
    episodeCount: 3,
    episodeNames: existingSeasons.flatMap((season) => season.episodes.map((episode) => `Modifié ${episode.title}`)),
  });

  assert.deepEqual(draft.seasons.map((season) => season.episodes.length), [3, 8, 5]);
  assert.equal(draft.seasons.flatMap((season) => season.episodes).length, 16);
  assert.equal(draft.seasons[1].episodes[7].videoAssetKey, "legacy-2-8");
  assert.equal(draft.removedEpisodes.length, 0);
});

test("la suppression d'un épisode n'est appliquée que par sélection explicite", () => {
  const untouched = buildSeasonEditDraft({ existingSeasons, seasonCount: 1, episodeCount: 1 });
  const explicitlyRemoved = buildSeasonEditDraft({
    existingSeasons,
    seasonCount: 1,
    episodeCount: 1,
    removedEpisodeKeys: ["2:4"],
  });

  assert.deepEqual(untouched.seasons.map((season) => season.episodes.length), [3, 8, 5]);
  assert.deepEqual(explicitlyRemoved.seasons.map((season) => season.episodes.length), [3, 7, 5]);
  assert.deepEqual(explicitlyRemoved.removedEpisodes, [{ season: 2, episode: 4 }]);
});

test("la suppression retire uniquement l'association de l'épisode choisi", () => {
  const source = [{ number: 1, episodes: [
    { number: 1, title: "A", videoAssetKey: "a-video", thumbnailAssetKey: "a-thumb", progress: 31, currentTime: 86 },
    { number: 2, title: "B", videoAssetKey: "b-video", thumbnailAssetKey: "b-thumb", progress: 62, currentTime: 174 },
    { number: 3, title: "C", videoAssetKey: "c-video", thumbnailAssetKey: "c-thumb", progress: 11, currentTime: 25 },
  ] }];

  const draft = buildSeasonEditDraft({
    existingSeasons: source,
    seasonCount: 1,
    episodeCount: 1,
    removedEpisodeKeys: ["1:2"],
  });

  assert.deepEqual(draft.removedEpisodes, [{ season: 1, episode: 2 }]);
  assert.deepEqual(draft.seasons[0].episodes.map(({ number, videoAssetKey, thumbnailAssetKey, progress, currentTime }) =>
    ({ number, videoAssetKey, thumbnailAssetKey, progress, currentTime })), [
    { number: 1, videoAssetKey: "a-video", thumbnailAssetKey: "a-thumb", progress: 31, currentTime: 86 },
    { number: 3, videoAssetKey: "c-video", thumbnailAssetKey: "c-thumb", progress: 11, currentTime: 25 },
  ]);
});

test("un épisode explicitement supprimé sort du brouillon et de ses clés référencées", () => {
  const source = existingSeasons.map((season) => ({
    ...season,
    episodes: season.episodes.map((episode) => ({ ...episode, videoAssetKey: `series:episode:${season.number}:${episode.number}:v:old` })),
  }));
  const draft = buildSeasonEditDraft({ existingSeasons: source, seasonCount: 3, episodeCount: 3, removedEpisodeKeys: ["2:4"] });

  assert.deepEqual(draft.removedEpisodes, [{ season: 2, episode: 4 }]);
  assert.equal(
    draft.seasons[1].episodes.some((episode) => episode.number === 4),
    false,
  );
  assert.equal(
    draft.seasons.flatMap((season) => season.episodes).some((episode) => episode.videoAssetKey === "series:episode:2:4:v:old"),
    false,
  );
});

test("les fichiers de remplacement suivent les emplacements réels des épisodes", () => {
  const files = [new Blob(["replacement"]), new Blob(["next"])];
  const draft = buildSeasonEditDraft({ existingSeasons, seasonCount: 3, episodeCount: 3, episodeFiles: files });
  assert.deepEqual(draft.episodeUploads.map(({ season, episode }) => [season, episode]), [[1, 1], [1, 2]]);
});

test("le remplacement vidéo sélectionne immédiatement la nouvelle URL", () => {
  const state = playbackStateAfterEpisodeReplacement(2, 4, "blob:new-video", "blob:old-video");
  assert.deepEqual(state, { selectedEpisode: { season: 2, episode: 4 }, selectedEpisodeUrl: "blob:new-video" });
});
