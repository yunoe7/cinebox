export type Kind = "Film" | "Série" | "Vidéo";
/**
 * Remote media providers supported by the future upload flow (LOT 8).
 * Vidsrc is handled separately from `tmdbId`, and local files stay in
 * IndexedDB through `videoAssetKey` / `videoUrl`.
 */
export type MediaProvider = "uqload" | "vidmoly";
/** Lifecycle of a media source before it becomes playable. */
export type MediaEncodingStatus = "pending" | "processing" | "ready" | "failed";
/**
 * A playable media source stored in D1 (`catalog_media_sources`).
 * `playbackUrl` is always derived from `fileCode` by `lib/cinebox/media-sources.mjs`.
 */
export type MediaSource = {
  id?: string;
  titleId: string;
  episodeId?: string | null;
  provider: MediaProvider;
  fileCode: string;
  videoId?: string;
  playbackUrl: string;
  quality?: string | null;
  encodingStatus: MediaEncodingStatus;
  uploadedAt?: string | null;
};
export type Episode = { number: number; title: string; videoUrl?: string; thumbnailUrl?: string; videoAssetKey?: string; thumbnailAssetKey?: string; currentTime?: number; progress?: number; overview?: string; airDate?: string; runtime?: number; tmdbId?: number; sources?: MediaSource[] };
export type Season = { number: number; episodes: Episode[]; name?: string; overview?: string; airDate?: string; episodeCount?: number; posterUrl?: string; posterAssetKey?: string; tmdbId?: number };
export type Title = {
  id: number; name: string; kind: Kind; year: number; genre: string;
  description: string; poster: string; backdrop: string; progress: number;
  duration: string; collection?: string; episodes?: string; seasons?: Season[]; currentTime?: number;
  videoUrl?: string; posterAssetKey?: string; backdropAssetKey?: string; videoAssetKey?: string; viewCount?: number;
  originalName?: string; releaseDate?: string; originalLanguage?: string; productionCountries?: string[];
  cast?: string[]; director?: string; rating?: number; voteCount?: number; tmdbId?: number;
  status?: string; totalSeasons?: number; totalEpisodes?: number; genres?: string[];
  sharedId?: string;
  vipExclusive?: boolean;
  vipEarlyAccess?: boolean;
  publicAt?: string;
  /** Promotional showcase only: visible in the catalogue, not openable. */
  vipLocked?: boolean;
  /** Explicit, verifiable age classification. Missing means "not classified". */
  ageRating?: string;
  minAge?: number;
  isAdult?: boolean;
  /** Where the title comes from: the personal library or the shared D1 catalogue. */
  source?: "local" | "shared";
  /** Remote media sources (Uqload, VidMoly) attached to a film or a video. */
  sources?: MediaSource[];
};
