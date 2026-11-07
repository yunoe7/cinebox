/** Return the episode selection and URL to activate after a successful replacement. */
export function playbackStateAfterEpisodeReplacement(season, episode, replacementUrl, currentUrl = null) {
  return {
    selectedEpisode: { season, episode },
    selectedEpisodeUrl: replacementUrl || currentUrl || null,
  };
}
