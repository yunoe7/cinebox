/**
 * Build an edit draft without shrinking existing seasons or episodes.
 * Episodes are removed only when their stable season:episode key is selected.
 */
export function buildSeasonEditDraft({
  existingSeasons = [],
  seasonCount,
  episodeCount,
  episodeNames = [],
  episodeFiles = [],
  removedEpisodeKeys = [],
}) {
  const oldSeasons = Array.isArray(existingSeasons) ? existingSeasons : [];
  const seasonNumbers = [...new Set([
    ...oldSeasons.map((season) => season.number).filter((number) => Number.isSafeInteger(number) && number > 0),
    ...Array.from({ length: Math.max(1, seasonCount || 1) }, (_, index) => index + 1),
  ])].sort((a, b) => a - b);
  const removed = new Set(removedEpisodeKeys);
  const oldByNumber = new Map(oldSeasons.map((season) => [season.number, season]));
  const seasons = [];
  let nameIndex = 0;

  for (const seasonNumber of seasonNumbers) {
    const oldSeason = oldByNumber.get(seasonNumber);
    const oldEpisodes = oldSeason?.episodes || [];
    const requestedCount = episodeCount || 0;
    const targetCount = Math.max(oldEpisodes.length, requestedCount);
    const episodes = [...oldEpisodes];
    let nextNumber = episodes.reduce((max, episode) => Math.max(max, episode.number), 0) + 1;
    while (episodes.length < targetCount) {
      episodes.push({ number: nextNumber, title: `Épisode ${nextNumber}` });
      nextNumber += 1;
    }
    const draftEpisodes = episodes.map((episode) => {
      const title = episodeNames[nameIndex]?.trim() || episode.title || `Épisode ${episode.number}`;
      nameIndex += 1;
      return { ...episode, title };
    });
    seasons.push({ number: seasonNumber, episodes: draftEpisodes });
  }

  // If the user selected more files than there are episode slots, append new
  // episodes to the last season rather than silently ignoring uploaded media.
  const retained = () => seasons.flatMap((season) => season.episodes.filter(
    (episode) => !removed.has(`${season.number}:${episode.number}`),
  ));
  let lastSeason = seasons[seasons.length - 1];
  let nextEpisodeNumber = lastSeason.episodes.reduce((max, episode) => Math.max(max, episode.number), 0) + 1;
  let retainedCount = retained().length;
  while (retainedCount < episodeFiles.length) {
    lastSeason.episodes.push({ number: nextEpisodeNumber, title: `Épisode ${nextEpisodeNumber}` });
    nextEpisodeNumber += 1;
    retainedCount += 1;
  }

  const episodeUploads = [];
  const availableEpisodes = seasons.flatMap((season) => season.episodes
    .filter((episode) => !removed.has(`${season.number}:${episode.number}`))
    .map((episode) => ({ season: season.number, episode: episode.number })));
  episodeFiles.forEach((file, index) => {
    const target = availableEpisodes[index];
    if (target) episodeUploads.push({ ...target, file });
  });

  const removedEpisodes = oldSeasons.flatMap((season) => season.episodes
    .filter((episode) => removed.has(`${season.number}:${episode.number}`))
    .map((episode) => ({ season: season.number, episode: episode.number })));

  return {
    seasons: seasons.map((season) => ({
      ...season,
      episodes: season.episodes.filter((episode) => !removed.has(`${season.number}:${episode.number}`)),
    })),
    episodeUploads,
    removedEpisodes,
  };
}
