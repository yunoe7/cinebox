export type Kind = "Film" | "Série" | "Vidéo";
export type Episode = { number: number; title: string; videoUrl?: string; thumbnailUrl?: string; currentTime?: number; progress?: number };
export type Season = { number: number; episodes: Episode[] };
export type Title = {
  id: number; name: string; kind: Kind; year: number; genre: string;
  description: string; poster: string; backdrop: string; progress: number;
  duration: string; collection?: string; episodes?: string; seasons?: Season[]; currentTime?: number;
  videoUrl?: string; viewCount?: number;
};

