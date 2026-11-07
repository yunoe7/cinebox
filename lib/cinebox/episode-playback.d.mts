export function playbackStateAfterEpisodeReplacement(
  season: number,
  episode: number,
  replacementUrl?: string | null,
  currentUrl?: string | null,
): { selectedEpisode: { season: number; episode: number }; selectedEpisodeUrl: string | null };
