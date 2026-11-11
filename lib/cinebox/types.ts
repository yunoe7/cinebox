export type Kind = "Film" | "Série" | "Vidéo";
export type Episode = { number: number; title: string; videoUrl?: string; thumbnailUrl?: string; videoAssetKey?: string; thumbnailAssetKey?: string; currentTime?: number; progress?: number; overview?: string; airDate?: string; runtime?: number; tmdbId?: number };
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
  /** Explicit, verifiable age classification. Missing means "not classified". */
  ageRating?: string;
  minAge?: number;
  isAdult?: boolean;
  /** Where the title comes from: the personal library or the shared D1 catalogue. */
  source?: "local" | "shared";
};

