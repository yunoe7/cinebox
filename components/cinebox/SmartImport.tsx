"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Search, Sparkles, X } from "lucide-react";
import { MagicCard } from "../magicui/magic-card";
import { BlurFade } from "../magicui/blur-fade";
import { ShimmerButton } from "../magicui/shimmer-button";
import type { Episode, Kind, Season, Title } from "../../lib/cinebox/types";
import { displayTmdbRating, normalizeTmdbRating } from "../../lib/cinebox/tmdb-rating.mjs";

type SearchResult = { id: number; media_type?: "movie" | "tv" | "person"; title?: string; name?: string; original_title?: string; original_name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; backdrop_path?: string | null; overview?: string; original_language?: string; vote_average?: number; vote_count?: number };
type EpisodeDetail = { id: number; episode_number: number; name?: string; overview?: string; air_date?: string; runtime?: number | null; still_path?: string | null };
type SeasonDetail = { id: number; season_number: number; name?: string; overview?: string; air_date?: string; poster_path?: string | null; episodes?: EpisodeDetail[] };
type Detail = SearchResult & { genres?: Array<{ id: number; name: string }>; runtime?: number | null; number_of_seasons?: number; number_of_episodes?: number; status?: string; seasons?: Array<{ season_number: number; name?: string; episode_count?: number; air_date?: string }>; credits?: { cast?: Array<{ name: string; order: number }>; crew?: Array<{ name: string; job: string }> }; production_countries?: Array<{ name: string }>; seasonsLoaded?: SeasonDetail[] };
export type SmartImportData = { tmdbId: number; kind: "Film" | "Série"; name: string; originalName: string; description: string; releaseDate: string; originalLanguage: string; productionCountries: string[]; cast: string[]; director: string; rating: number; voteCount: number; runtime?: number; status?: string; totalSeasons?: number; totalEpisodes?: number; genres: string[]; seasons?: Season[]; backdrop?: string };
export type SmartImportedAsset = { slot: string; file: File };

type Props = { addKind: Kind; existingTitles: Title[]; onApply: (data: SmartImportData, poster: File | null, assets: SmartImportedAsset[]) => void; onDuplicate: (title: Title) => void };

function yearOf(value?: string) { return value?.slice(0, 4) || ""; }
function posterUrl(path?: string | null) { return path ? `/api/tmdb/image?path=${encodeURIComponent(path)}` : ""; }
function mediaKind(result: SearchResult): "movie" | "tv" | "person" { return result.media_type || (result.title || result.original_title ? "movie" : "tv"); }
function searchRating(value: unknown) { const rating = normalizeTmdbRating(value); return rating === undefined ? "—" : Math.round(rating * 10) / 10 || "—"; }

export function SmartImport({ addKind, existingTitles, onApply, onDuplicate }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [year, setYear] = useState("");
  const [searchKind, setSearchKind] = useState<"multi" | "movie" | "tv">(addKind === "Série" ? "tv" : "multi");
  const [applying, setApplying] = useState(false);
  const canSearch = query.trim().length >= 2;

  useEffect(() => {
    if (!canSearch) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ query: query.trim(), kind: searchKind });
        if (year) params.set("year", year);
        const response = await fetch(`/api/tmdb/search?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Recherche impossible.");
        if (!payload || !Array.isArray(payload.results)) throw new Error("Réponse invalide du catalogue externe.");
        setResults(payload.results.filter((item: SearchResult) => item && Number.isSafeInteger(item.id) && (item.title || item.name || item.original_title || item.original_name) && mediaKind(item) !== "person").slice(0, 12));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof TypeError ? "Connexion au catalogue impossible. Vérifiez votre réseau puis réessayez." : cause instanceof Error ? cause.message : "Recherche impossible.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 420);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, year, searchKind, canSearch]);

  const loadSelection = async (result: SearchResult) => {
    const kind = mediaKind(result);
    setLoading(true); setError("");
    try {
      if (kind === "person") return;
      const response = await fetch(`/api/tmdb/${kind}/${result.id}`);
      const detail = await response.json();
      if (!response.ok) throw new Error(detail?.error || "Fiche indisponible.");
      if (!detail || typeof detail !== "object" || detail.id !== result.id) throw new Error("Fiche invalide reçue du catalogue externe.");
      if (kind === "tv") {
        const seasons: Array<{ season_number: number }> = (detail.seasons || []).filter((season: { season_number: number }) => season.season_number >= 0);
        const seasonsLoaded = await Promise.all(seasons.map(async ({ season_number }) => {
          const seasonResponse = await fetch(`/api/tmdb/tv/${result.id}/season/${season_number}`);
          if (!seasonResponse.ok) return { id: 0, season_number, episodes: [] } as SeasonDetail;
          return seasonResponse.json() as Promise<SeasonDetail>;
        }));
        detail.seasonsLoaded = seasonsLoaded;
        setSelectedSeasons(seasonsLoaded.filter(season => season.season_number > 0).map(season => season.season_number));
      }
      setSelected({ ...detail, media_type: kind });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger cette fiche."); }
    finally { setLoading(false); }
  };

  const seasonDetails = selected?.seasonsLoaded || [];
  const duplicate = selected && existingTitles.find(title => title.tmdbId === selected.id && title.kind === (selected.media_type === "tv" ? "Série" : "Film"));
  const allSelected = useMemo(() => seasonDetails.filter(season => selectedSeasons.includes(season.season_number)), [seasonDetails, selectedSeasons]);
  const apply = async () => {
    if (!selected) return;
    setApplying(true); setError("");
    let poster: File | null = null;
    try {
      if (selected.poster_path) {
        const response = await fetch(posterUrl(selected.poster_path));
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith("image/") && blob.size <= 20 * 1024 * 1024) poster = new File([blob], `tmdb-${selected.id}-poster`, { type: blob.type });
        }
      }
      const seasons: Season[] = allSelected.map((season): Season => ({
        number: season.season_number,
        name: season.name || `Saison ${season.season_number}`,
        overview: season.overview || "",
        airDate: season.air_date || "",
        episodeCount: season.episodes?.length || 0,
        posterUrl: posterUrl(season.poster_path),
        tmdbId: season.id,
        episodes: (season.episodes || []).filter((episode) => Number.isInteger(episode.episode_number) && episode.episode_number > 0).map((episode): Episode => ({
          number: episode.episode_number,
          title: episode.name || `Épisode ${episode.episode_number}`,
          overview: episode.overview || "",
          airDate: episode.air_date || "",
          runtime: episode.runtime || undefined,
          thumbnailUrl: posterUrl(episode.still_path) || undefined,
          tmdbId: episode.id,
        })),
      }));
      const releaseDate = selected.release_date || selected.first_air_date || "";
      const imported: SmartImportData = {
        tmdbId: selected.id,
        kind: selected.media_type === "tv" ? "Série" : "Film",
        name: selected.title || selected.name || selected.original_title || selected.original_name || "",
        originalName: selected.original_title || selected.original_name || selected.title || selected.name || "",
        description: selected.overview || "",
        releaseDate,
        originalLanguage: selected.original_language || "",
        productionCountries: selected.production_countries?.map(country => country.name) || [],
        cast: selected.credits?.cast?.slice(0, 8).map(person => person.name) || [],
        director: selected.credits?.crew?.find(person => person.job === "Director")?.name || "",
        rating: normalizeTmdbRating(selected.vote_average) ?? 0,
        voteCount: selected.vote_count || 0,
        runtime: selected.runtime || undefined,
        status: selected.status,
        totalSeasons: selected.number_of_seasons,
        totalEpisodes: selected.number_of_episodes,
        genres: selected.genres?.map(genre => genre.name) || [],
        seasons: selected.media_type === "tv" ? seasons : undefined,
        backdrop: selected.backdrop_path ? posterUrl(selected.backdrop_path) : "",
      };
      const assetRequests: Array<{ slot: string; path?: string | null; filename: string }> = [];
      if (selected.backdrop_path) assetRequests.push({ slot: "smart:backdrop", path: selected.backdrop_path, filename: `tmdb-${selected.id}-backdrop` });
      for (const season of seasons) {
        const sourceSeason = allSelected.find(entry => entry.season_number === season.number);
        if (sourceSeason?.poster_path) assetRequests.push({ slot: `smart:season:${season.number}:poster`, path: sourceSeason.poster_path, filename: `tmdb-${selected.id}-season-${season.number}` });
        for (const episode of sourceSeason?.episodes || []) {
          if (episode.still_path) assetRequests.push({ slot: `smart:episode:${season.number}:${episode.episode_number}:thumbnail`, path: episode.still_path, filename: `tmdb-${selected.id}-s${season.number}-e${episode.episode_number}` });
        }
      }
      const importedAssets: SmartImportedAsset[] = [];
      let nextAsset = 0;
      let byteBudget = 48 * 1024 * 1024;
      const worker = async () => {
        while (nextAsset < assetRequests.length && importedAssets.length < 160 && byteBudget > 0) {
          const request = assetRequests[nextAsset++];
          try {
            const response = await fetch(posterUrl(request.path));
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith("image/") || blob.size > byteBudget) continue;
            byteBudget -= blob.size;
            importedAssets.push({ slot: request.slot, file: new File([blob], request.filename, { type: blob.type }) });
          } catch { /* Missing artwork is optional and does not block metadata import. */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, assetRequests.length) }, worker));
      onApply(imported, poster, importedAssets);
    } catch {
      // A poster is optional; preserve the metadata import if its image cannot be downloaded.
      onApply({ tmdbId: selected.id, kind: selected.media_type === "tv" ? "Série" : "Film", name: selected.title || selected.name || selected.original_title || selected.original_name || "", originalName: selected.original_title || selected.original_name || selected.title || selected.name || "", description: selected.overview || "", releaseDate: selected.release_date || selected.first_air_date || "", originalLanguage: selected.original_language || "", productionCountries: selected.production_countries?.map(country => country.name) || [], cast: selected.credits?.cast?.slice(0, 8).map(person => person.name) || [], director: selected.credits?.crew?.find(person => person.job === "Director")?.name || "", rating: normalizeTmdbRating(selected.vote_average) ?? 0, voteCount: selected.vote_count || 0, runtime: selected.runtime || undefined, status: selected.status, totalSeasons: selected.number_of_seasons, totalEpisodes: selected.number_of_episodes, genres: selected.genres?.map(genre => genre.name) || [], seasons: selected.media_type === "tv" ? allSelected.map(season => ({ number: season.season_number, name: season.name || "", overview: season.overview || "", airDate: season.air_date || "", tmdbId: season.id, episodes: (season.episodes || []).map(episode => ({ number: episode.episode_number, title: episode.name || `Épisode ${episode.episode_number}`, overview: episode.overview || "", airDate: episode.air_date || "", runtime: episode.runtime || undefined, thumbnailUrl: posterUrl(episode.still_path) || undefined, tmdbId: episode.id })) })) : undefined, backdrop: selected.backdrop_path ? posterUrl(selected.backdrop_path) : "" }, null, []);
    } finally { setApplying(false); }
  };

  return <section className="smart-import" aria-label="Import intelligent TMDB">
    <div className="smart-import-heading"><span><Sparkles size={16}/> Import intelligent</span><small>Catalogue TMDB · données modifiables</small></div>
    {!selected ? <>
      <div className="smart-import-search"><Search size={16}/><input aria-label="Rechercher un film ou une série" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nom du film ou de la série…"/><select aria-label="Type de recherche" value={searchKind} onChange={event => setSearchKind(event.target.value as typeof searchKind)}><option value="multi">Films et séries</option><option value="movie">Films</option><option value="tv">Séries</option></select><input aria-label="Année de sortie" className="smart-import-year" inputMode="numeric" maxLength={4} value={year} onChange={event => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Année"/></div>
      {loading && <p className="smart-import-state"><LoaderCircle size={15} className="smart-spin"/> Recherche du catalogue…</p>}
      {error && <p className="smart-import-error" role="alert">{error}</p>}
      {!loading && canSearch && !error && results.length === 0 && <p className="smart-import-state">Aucune correspondance. Vérifiez le titre ou l’année.</p>}
      {results.length > 0 && <div className="smart-import-results">{results.map((result, index) => <BlurFade key={`${mediaKind(result)}:${result.id}`} delay={index * .025}><MagicCard className="smart-result-card"><button type="button" onClick={() => void loadSelection(result)} aria-label={`Choisir ${result.title || result.name}`}>
        {result.poster_path ? <img src={posterUrl(result.poster_path)} alt="" loading="lazy"/> : <span className="smart-no-poster">Sans affiche</span>}
        <span><strong>{result.title || result.name || "Titre indisponible"}</strong><small>{result.original_title || result.original_name || "Titre original indisponible"}</small><small>{mediaKind(result) === "tv" ? "Série" : mediaKind(result) === "person" ? "Personne" : "Film"} · {yearOf(result.release_date || result.first_air_date) || "Date inconnue"} · {result.original_language?.toUpperCase() || "Langue inconnue"}</small><small>{result.overview || "Aucun résumé fourni par TMDB."}</small></span><i>{searchRating(result.vote_average)}</i></button></MagicCard></BlurFade>)}</div>}
    </> : <>
      <button type="button" className="smart-import-back" onClick={() => setSelected(null)}><ArrowLeft size={14}/> Retour aux résultats</button>
      <div className="smart-import-preview">{selected.poster_path ? <img src={posterUrl(selected.poster_path)} alt="Affiche TMDB"/> : <div className="smart-no-poster smart-no-poster-large">Sans affiche</div>}<div><small>{selected.media_type === "tv" ? "SÉRIE" : "FILM"} · {yearOf(selected.release_date || selected.first_air_date) || "Date inconnue"}</small><h3>{selected.title || selected.name}</h3><p>{selected.original_title || selected.original_name}</p><p>{selected.overview || "Aucun résumé fourni."}</p><small>{selected.genres?.map(g => g.name).join(" · ") || "Genres non renseignés"} · ★ {displayTmdbRating(selected.vote_average)} ({selected.vote_count || 0})</small></div></div>
      {duplicate && <p className="smart-import-duplicate" role="status">Ce titre est déjà dans votre bibliothèque. L’import mettra à jour ses métadonnées en conservant ses vidéos et progressions.</p>}
      {selected.media_type === "tv" && <div className="smart-season-picker"><strong>Saisons à importer</strong><small>Les saisons spéciales (0) restent décochées par défaut.</small>{seasonDetails.map(season => <div className="smart-season-option" key={season.season_number}><label><input type="checkbox" checked={selectedSeasons.includes(season.season_number)} onChange={event => setSelectedSeasons(current => event.target.checked ? [...current, season.season_number] : current.filter(value => value !== season.season_number))}/><span>Saison {season.season_number}{season.season_number === 0 ? " · spéciale" : ""} — {season.name || "Sans nom"}</span><small>{season.episodes?.length || 0} épisodes</small></label><details><summary>Aperçu des épisodes</summary>{(season.episodes || []).map(episode => <p key={episode.id}><strong>{episode.episode_number}. {episode.name || "Épisode sans titre"}</strong><small>{episode.air_date || "Date inconnue"}{episode.air_date && episode.air_date > new Date().toISOString().slice(0, 10) ? " · À venir" : ""} · {episode.runtime ? `${episode.runtime} min` : "Durée inconnue"}</small><span>{episode.overview || "Résumé indisponible"}</span></p>)}</details></div>)}</div>}
      <p className="smart-import-disclaimer">Les informations seront préremplies et resteront modifiables. Aucune vidéo n’est importée. Les images d’affiche sont conservées dans la bibliothèque locale lorsqu’elles sont disponibles.</p>
      {error && <p className="smart-import-error" role="alert">{error}</p>}
      <ShimmerButton type="button" className="smart-import-apply" disabled={applying || loading || (selected.media_type === "tv" && selectedSeasons.length === 0)} onClick={() => void apply().then(() => { if (duplicate) onDuplicate(duplicate); })}>{applying ? <><LoaderCircle size={15} className="smart-spin"/> Préparation…</> : <><Check size={15}/> {duplicate ? "Mettre à jour ce titre" : "Préremplir le formulaire"}</>}</ShimmerButton>
      <button type="button" className="smart-import-cancel" onClick={() => setSelected(null)}><X size={13}/> Annuler cette sélection</button>
    </>}
  </section>;
}
