export function emptyAccountData() {
  return { favorites: [], playback: {}, history: [], viewCounts: {}, preferences: { autoplayNext: true } };
}
export function addAccountView(data, titleId, viewedAt = Date.now()) {
  const last = data.history[0];
  if (last && last.titleId === titleId && viewedAt - last.viewedAt < 30000) return data;
  return { ...data, viewCounts: { ...data.viewCounts, [String(titleId)]: (data.viewCounts[String(titleId)] || 0) + 1 }, history: [{ titleId, viewedAt }, ...data.history].slice(0, 200) };
}
export function overlayAccountData(titles, data) {
  return titles.map((title) => {
    const saved = data.playback[String(title.id)];
    const key = title.videoAssetKey || `${title.id}:video`;
    const playback = saved && (!saved.assetKey || saved.assetKey === key) ? saved : undefined;
    const seasons = title.seasons?.map((season) => ({ ...season, episodes: season.episodes.map((episode) => {
      const item = saved?.episodes?.[`${season.number}:${episode.number}`];
      const episodeKey = episode.videoAssetKey || `${title.id}:episode:${season.number}:${episode.number}`;
      return item && (!item.assetKey || item.assetKey === episodeKey) ? { ...episode, currentTime: item.currentTime, progress: item.progress } : { ...episode, currentTime: 0, progress: 0 };
    }) }));
    return { ...title, progress: playback?.progress ?? 0, currentTime: playback?.currentTime ?? 0, viewCount: data.viewCounts[String(title.id)] ?? 0, ...(seasons ? { seasons } : {}) };
  });
}
