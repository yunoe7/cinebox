export type SeasonEpisodeDraft = {
  number: number;
  title: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  videoAssetKey?: string;
  thumbnailAssetKey?: string;
  currentTime?: number;
  progress?: number;
  [key: string]: unknown;
};

export type SeasonEditDraft = {
  seasons: Array<{ number: number; episodes: SeasonEpisodeDraft[] }>;
  episodeUploads: Array<{ season: number; episode: number; file: Blob }>;
  removedEpisodes: Array<{ season: number; episode: number }>;
};

export function buildSeasonEditDraft(options: {
  existingSeasons?: Array<{ number: number; episodes: SeasonEpisodeDraft[] }>;
  seasonCount: number;
  episodeCount: number;
  episodeNames?: string[];
  episodeFiles?: Blob[];
  removedEpisodeKeys?: string[];
}): SeasonEditDraft;
