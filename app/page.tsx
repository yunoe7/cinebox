"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { deleteAssetKeys, readAsset, saveVersionedAsset } from "../lib/cinebox/storage";
import { initialValueFor, readLocalJson, writeLocalJson } from "../lib/cinebox/local-storage.mjs";
import { createAccountLibrary, fetchAccountLibrary, saveAccountLibrary } from "../lib/cinebox/account-library.mjs";
import * as mediaLifecycle from "../lib/cinebox/media-lifecycle.mjs";
import { processMediaCleanupJobs, publishWithMediaCleanupJournal, withMediaReferencesLock } from "../lib/cinebox/media-cleanup.mjs";
import { buildSeasonEditDraft } from "../lib/cinebox/series-edit.mjs";
import { playbackStateAfterEpisodeReplacement } from "../lib/cinebox/episode-playback.mjs";
import { clearBlobUrlOwner, createProvisionalBlobUrlBatch, syncBlobUrlOwner } from "../lib/cinebox/blob-url-manager.mjs";
import DetailModal from "../components/cinebox/DetailModal";
import EpisodeEditor from "../components/cinebox/EpisodeEditor";
import TitleEditor from "../components/cinebox/TitleEditor";
import { AppToast, DeleteConfirmation } from "../components/cinebox/FeedbackDialogs";
import type { Kind, Title } from "../lib/cinebox/types";
import { SpotlightSurface } from "../components/ui/spotlight-surface";
import { MagicCard } from "../components/magicui/magic-card";
import { ShimmerButton } from "../components/magicui/shimmer-button";
import { BlurFade } from "../components/magicui/blur-fade";
import { NumberTicker } from "../components/magicui/number-ticker";
import { TextAnimate } from "../components/magicui/text-animate";
import { AnimatedGridPattern } from "../components/magicui/animated-grid-pattern";
import { AnimatedShinyText } from "../components/magicui/animated-shiny-text";
import { ProfileMenu } from "../components/cinebox/ProfileMenu";
import { CineboxLogo } from "../components/cinebox/CineboxLogo";
import { SharedCatalogManager } from "../components/cinebox/SharedCatalogManager";
import { DiscordAccessGate } from "../components/cinebox/DiscordAccessGate";

import { emptyAccountData, overlayAccountData, addAccountView } from "../lib/cinebox/account-data.mjs";
import { favoriteTypeCounts as computeFavoriteTypeCounts, visibleFavoriteIds } from "../lib/cinebox/favorites.mjs";
import { matchesTitleQuery, mergeCatalogTitles } from "../lib/cinebox/catalog-search.mjs";
import { loadSharedCatalog } from "../lib/cinebox/shared-catalog.mjs";
import { resolveSharedId } from "../lib/cinebox/shared-id.mjs";
import { adminJson, getAdminSession } from "../lib/cinebox/admin-session.mjs";

import {
  Clapperboard, Film, Heart, Home, Play, Plus, Search, Settings,
  Tv, X, ChevronRight, Trash2, ShieldCheck,
  LayoutDashboard, Image as ImageIcon, Database, Pencil,
  HardDrive, Library, Star, LoaderCircle, RefreshCw, ShieldAlert
} from "lucide-react";

const { stageAssets } = mediaLifecycle;
type UnpublishedCleanupResult =
  | { status: "cleaned"; deletedKeys: string[]; retainedKeys: string[] }
  | { status: "references-unavailable"; candidateKeys: string[]; error: unknown }
  | { status: "cleanup-failed"; unresolvedKeys: string[]; retainedKeys: string[]; error: unknown };
const cleanupUnpublishedAssets = (mediaLifecycle as unknown as {
  cleanupUnpublishedAssets: (
    candidateKeys: string[],
    readReferencedKeys: () => Set<string> | Promise<Set<string>>,
    deleteAssets: (keys: string[]) => Promise<void>,
  ) => Promise<UnpublishedCleanupResult>;
}).cleanupUnpublishedAssets;

const MAX_ADMIN_IMAGE_BYTES = 20 * 1024 * 1024;

const adminSections = [
  { id: "overview", label: "Vue d’ensemble", icon: LayoutDashboard },
  { id: "films", label: "Films", icon: Film },
  { id: "series", label: "Séries", icon: Tv },
  { id: "videos", label: "Vidéos", icon: Clapperboard },
  { id: "media", label: "Médias", icon: ImageIcon },
] as const;

const navItems = [
  { label: "Accueil", icon: Home }, { label: "Films", icon: Film },
  { label: "Séries", icon: Tv }, { label: "Vidéos", icon: Clapperboard },
  { label: "Ma liste", icon: Heart }, { label: "Administration", icon: Settings }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isEpisodeRecord(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.number) && typeof value.title === "string" &&
    isOptionalString(value.videoUrl) && isOptionalString(value.thumbnailUrl) &&
    isOptionalString(value.videoAssetKey) && isOptionalString(value.thumbnailAssetKey) &&
    isOptionalString(value.overview) && isOptionalString(value.airDate) && isOptionalNumber(value.runtime) && isOptionalNumber(value.tmdbId) &&
    isOptionalNumber(value.currentTime) && isOptionalNumber(value.progress);
}

function isTitleRecord(value: unknown): value is Title {
  if (!isRecord(value)) return false;
  const validKind = value.kind === "Film" || value.kind === "Série" || value.kind === "Vidéo";
  const validSeasons = value.seasons === undefined || (Array.isArray(value.seasons) && value.seasons.every((season) =>
    isRecord(season) && Number.isSafeInteger(season.number) && Array.isArray(season.episodes) && season.episodes.every(isEpisodeRecord) &&
    isOptionalString(season.name) && isOptionalString(season.overview) && isOptionalString(season.airDate) && isOptionalString(season.posterUrl) && isOptionalString(season.posterAssetKey) && isOptionalNumber(season.episodeCount) && isOptionalNumber(season.tmdbId),
  ));
  return Number.isSafeInteger(value.id) && typeof value.name === "string" && validKind &&
    Number.isFinite(value.year) && typeof value.genre === "string" && typeof value.description === "string" &&
    typeof value.poster === "string" && isOptionalString(value.backdrop) && Number.isFinite(value.progress) &&
    typeof value.duration === "string" && isOptionalString(value.collection) && isOptionalString(value.episodes) &&
    isOptionalString(value.posterAssetKey) && isOptionalString(value.backdropAssetKey) && isOptionalString(value.videoAssetKey) &&
    isOptionalNumber(value.currentTime) && isOptionalString(value.videoUrl) && isOptionalNumber(value.viewCount) && validSeasons;
}

function isTitleList(value: unknown): value is Title[] {
  return Array.isArray(value) && value.every(isTitleRecord);
}

function isFavoriteList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((id) => Number.isSafeInteger(id));
}

function preserveLegacyPlaybackFields(next: Title[]): Title[] | null {
  const current = readLocalJson(() => window.localStorage, "cinebox-titles", isTitleList);
  if (current.status === "missing") return next;
  if (current.status !== "valid") return null;
  const currentById = new Map(current.value.map((title) => [title.id, title]));
  const preserve = <T extends Record<string, unknown>>(target: T, source: Record<string, unknown>, fields: string[]): T => {
    const result = { ...target } as T;
    for (const field of fields) {
      if (Object.hasOwn(source, field)) result[field as keyof T] = source[field] as T[keyof T];
      else delete result[field as keyof T];
    }
    return result;
  };
  return next.map((title) => {
    const old = currentById.get(title.id);
    if (!old) return title;
    const nextTitle = preserve(title as unknown as Record<string, unknown>, old, ["currentTime", "progress", "viewCount"]) as unknown as Title;
    if (!title.seasons) return nextTitle;
    return {
      ...nextTitle,
      seasons: title.seasons.map((season) => {
        const oldSeason = old.seasons?.find((entry) => entry.number === season.number);
        return {
          ...season,
          episodes: season.episodes.map((episode) => {
            const oldEpisode = oldSeason?.episodes.find((entry) => entry.number === episode.number);
            return oldEpisode ? preserve(episode as unknown as Record<string, unknown>, oldEpisode, ["currentTime", "progress"]) as unknown as typeof episode : episode;
          }),
        };
      }),
    };
  });
}

function serializeTitles(value: Title[]) {
  return value.map(({ videoUrl, ...item }) => ({
    ...item,
    poster: item.poster.startsWith("blob:") || item.poster.includes("images.unsplash.com/photo-1489599849927-2ee91cede3ba") ? "" : item.poster,
    seasons: item.seasons?.map((season) => ({ ...season, episodes: season.episodes.map(({ videoUrl: episodeVideoUrl, thumbnailUrl, ...episode }) => ({
      ...episode,
      ...(thumbnailUrl?.startsWith("blob:") ? { thumbnailUrl: undefined } : { thumbnailUrl })
    })) }))
  }));
}

async function loadAssetWithLegacyFallback(key: string, legacyKey: string): Promise<Blob | undefined> {
  const primary = await readAsset(key);
  if (primary.status === "found") return primary.blob;
  if (key === legacyKey) return undefined;
  const legacy = await readAsset(legacyKey);
  return legacy.status === "found" ? legacy.blob : undefined;
}

function getSeriesProgress(title: Title): number {
  const episodes = (title.seasons || []).flatMap((season) => season.episodes);
  if (!episodes.length) return Math.max(0, Math.min(100, title.progress || 0));
  const total = episodes.reduce((sum, episode) => sum + Math.max(0, Math.min(100, episode.progress || 0)), 0);
  return Math.round(total / episodes.length);
}

function getSeriesViewingStatus(title: Title): "unwatched" | "in-progress" | "watched" {
  const episodes = (title.seasons || []).flatMap((season) => season.episodes);
  if (title.progress >= 100 || (episodes.length > 0 && episodes.every((episode) => (episode.progress || 0) >= 100))) return "watched";
  if (title.progress > 0 || episodes.some((episode) => (episode.progress || 0) > 0)) return "in-progress";
  return "unwatched";
}

const videoDurationBands = [
  { value: "under-10", label: "Moins de 10 min", min: 0, max: 10 },
  { value: "10-30", label: "10 à 30 min", min: 10, max: 30 },
  { value: "30-60", label: "30 à 60 min", min: 30, max: 60 },
  { value: "60-plus", label: "60 min et plus", min: 60, max: Number.POSITIVE_INFINITY },
] as const;

function parseDurationMinutes(value: string): number | null {
  const text = value.trim().toLocaleLowerCase("fr").replace(",", ".");
  const clock = text.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (clock) return clock[3] === undefined ? Number(clock[1]) + Number(clock[2]) / 60 : Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60;
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*h(?:eures?)?/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:min(?:utes?)?|m)\b/)?.[1] || 0);
  return hours || minutes ? hours * 60 + minutes : null;
}

function getDurationBand(value: string): string | null {
  const minutes = parseDurationMinutes(value);
  if (minutes === null) return null;
  return videoDurationBands.find((band) => minutes >= band.min && minutes < band.max)?.value || null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function getTitleAssetKeys(title: Title): Set<string> {
  const keys = new Set<string>();
  if (title.posterAssetKey) keys.add(title.posterAssetKey);
  else if (!title.poster || title.poster.startsWith("blob:")) keys.add(`${title.id}:poster`);
  if (title.videoAssetKey) keys.add(title.videoAssetKey);
  else if (title.kind !== "Série") keys.add(`${title.id}:video`);
  if (title.backdropAssetKey) keys.add(title.backdropAssetKey);
  for (const season of title.seasons || []) {
    if (season.posterAssetKey) keys.add(season.posterAssetKey);
    for (const episode of season.episodes) {
      const baseKey = `${title.id}:episode:${season.number}:${episode.number}`;
      keys.add(episode.videoAssetKey || baseKey);
      keys.add(episode.thumbnailAssetKey || `${baseKey}:thumbnail`);
    }
  }
  return keys;
}

function getTitlesAssetKeys(titles: Title[]): Set<string> {
  return new Set(titles.flatMap((title) => [...getTitleAssetKeys(title)]));
}

function getTitleBlobUrls(title: Title | null): Set<string> {
  if (!title) return new Set();
  const urls = new Set<string>();
  const add = (url: string | undefined) => { if (url?.startsWith("blob:")) urls.add(url); };
  add(title.poster);
  add(title.backdrop);
  add(title.videoUrl);
  for (const season of title.seasons || []) {
    for (const episode of season.episodes) {
      add(episode.videoUrl);
      add(episode.thumbnailUrl);
    }
    add(season.posterUrl);
  }
  return urls;
}

function getTitlesBlobUrls(titles: Title[]): Set<string> {
  return new Set(titles.flatMap((title) => [...getTitleBlobUrls(title)]));
}

function readFailureMessage(label: string, reason: "access" | "parse" | "invalid") {
  if (reason === "parse" || reason === "invalid") return `Les données de ${label} sont illisibles. Elles ont été conservées et ne seront pas remplacées automatiquement.`;
  return `Le navigateur ne permet pas de lire ${label}. Aucune donnée ne sera remplacée automatiquement.`;
}

function writeFailureMessage(label: string, reason: "quota" | "access" | "serialize") {
  if (reason === "quota") return `Le stockage local est plein : ${label} n’a pas été sauvegardé. Libérez de l’espace puis réessayez. Les données précédentes sont conservées.`;
  if (reason === "access") return `Le navigateur a refusé l’écriture de ${label}. Les données précédentes sont conservées.`;
  return `Une erreur a empêché la préparation de ${label}. Les données précédentes sont conservées.`;
}

function sharedCatalogErrorMessage(reason?: string) {
  if (reason === "network") return "La connexion au catalogue partagé a échoué.";
  if (reason === "http") return "Le serveur du catalogue partagé a répondu avec une erreur.";
  if (reason === "invalid-response") return "La réponse du catalogue partagé est illisible.";
  if (reason === "unavailable") return "Le catalogue partagé n’est pas disponible dans cet environnement.";
  return "Le catalogue partagé n’a pas pu être chargé.";
}

/** Decorative artwork for streaming rows: never renders an empty `src` attribute. */
function StreamingArtwork({ src }: { src?: string }) {
  return src
    ? <img src={src} alt="" loading="lazy"/>
    : <span className="streaming-artwork-empty" aria-hidden="true"/>;
}

export default function HomePage() {
  const [titles, setTitles] = useState<Title[]>([]);
  const [sharedCatalogTitles, setSharedCatalogTitles] = useState<Title[]>([]);
  const [sharedCatalogStatus, setSharedCatalogStatus] = useState<{ status: "loading" | "success" | "error"; reason?: string }>({ status: "loading" });
  const [sharedCatalogRetryKey, setSharedCatalogRetryKey] = useState(0);
  const [sharedAdminStats, setSharedAdminStats] = useState<{titles:number;films:number;series:number;videos:number;episodes:number;loaded:boolean}>({titles:0,films:0,series:0,videos:0,episodes:0,loaded:false});
  const [favorites, setFavorites] = useState<number[]>([]);
  const [activePage, setActivePage] = useState("Accueil");
  const [filter, setFilter] = useState("Tout");
  const [genreFilter, setGenreFilter] = useState("Tous les genres");
  const [heroIndex, setHeroIndex] = useState(0);
  const [sortBy, setSortBy] = useState("recent");
  const [listSortBy, setListSortBy] = useState("recent");
  const [query, setQuery] = useState("");
  const [filmGenreFilter, setFilmGenreFilter] = useState("all");
  const [filmYearFilter, setFilmYearFilter] = useState("all");
  const [filmViewingFilter, setFilmViewingFilter] = useState("all");
  const [filmSortBy, setFilmSortBy] = useState("recent");
  const [seriesGenreFilter, setSeriesGenreFilter] = useState("all");
  const [seriesYearFilter, setSeriesYearFilter] = useState("all");
  const [seriesViewingFilter, setSeriesViewingFilter] = useState("all");
  const [seriesSortBy, setSeriesSortBy] = useState("recent");
  const [videoCategoryFilter, setVideoCategoryFilter] = useState("all");
  const [videoDurationFilter, setVideoDurationFilter] = useState("all");
  const [videoSortBy, setVideoSortBy] = useState("recent");
  const [adminSection, setAdminSection] = useState<(typeof adminSections)[number]["id"]>("overview");
  const [selected, setSelected] = useState<Title | null>(null);
  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<{ season: number; episode: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submittingTitle, setSubmittingTitle] = useState(false);
  const [addKind, setAddKind] = useState<Kind>("Film");
  const [editingTitle, setEditingTitle] = useState<Title | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Title | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [accountData, setAccountData] = useState(emptyAccountData);
  const [editingEpisode, setEditingEpisode] = useState<{ season: number; episode: number; title: string } | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const componentId = useId();
  const blobOwnerPrefix = `cinebox:${componentId}`;
  const [ready, setReady] = useState(false);
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated" | "error">("checking");
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const titlesRef = useRef<Title[]>([]);
  const favoritesRef = useRef<number[]>([]);
  const catalogTitlesRef = useRef<Title[]>([]);
  const sharedCatalogTitlesRef = useRef<Title[]>([]);
  const accountDataRef = useRef(emptyAccountData);
  const accountLibraryRevisionRef = useRef(0);
  const accountLibraryWriteRef = useRef(Promise.resolve());
  const accountLibraryReadyRef = useRef(false);
  const canWriteTitlesRef = useRef(false);
  const canWriteFavoritesRef = useRef(false);
  const browseTitles = useMemo(() => overlayAccountData(mergeCatalogTitles(titles, sharedCatalogTitles), accountData), [titles, sharedCatalogTitles, accountData]);
  const visibleFavorites = useMemo((() => {
    const ids = visibleFavoriteIds(browseTitles, favorites);
    return { ids, idSet: new Set(ids), count: ids.length };
  }, [browseTitles, favorites]);

  useEffect(() => { syncBlobUrlOwner(`${blobOwnerPrefix}:library`, getTitlesBlobUrls(titles)); }, [blobOwnerPrefix, titles]);
  useEffect(() => { syncBlobUrlOwner(`${blobOwnerPrefix}:selected`, getTitleBlobUrls(selected)); }, [blobOwnerPrefix, selected]);
  useEffect(() => { syncBlobUrlOwner(`${blobOwnerPrefix}:editor`, getTitleBlobUrls(editingTitle)); }, [blobOwnerPrefix, editingTitle]);
  useEffect(() => { syncBlobUrlOwner(`${blobOwnerPrefix}:delete-confirmation`, getTitleBlobUrls(confirmDelete)); }, [blobOwnerPrefix, confirmDelete]);
  useEffect(() => { syncBlobUrlOwner(`${blobOwnerPrefix}:playback`, selectedEpisodeUrl ? [selectedEpisodeUrl] : []); }, [blobOwnerPrefix, selectedEpisodeUrl]);
  useEffect(() => () => {
    clearBlobUrlOwner(`${blobOwnerPrefix}:library`);
    clearBlobUrlOwner(`${blobOwnerPrefix}:selected`);
    clearBlobUrlOwner(`${blobOwnerPrefix}:editor`);
    clearBlobUrlOwner(`${blobOwnerPrefix}:delete-confirmation`);
    clearBlobUrlOwner(`${blobOwnerPrefix}:playback`);
  }, [blobOwnerPrefix]);

  const reportWriteFailure = (label: string, reason: "quota" | "access" | "serialize") => {
    setNotice({ title: "Sauvegarde impossible", message: writeFailureMessage(label, reason) });
  };

  const blockForPendingRecovery = () => {
    canWriteTitlesRef.current = false;
    canWriteFavoritesRef.current = false;
    setNotice({ title: "Récupération en attente", message: "Un journal de récupération est présent ou n’a pas pu être vérifié. Toute modification est bloquée jusqu’à sa résolution." });
  };

  const saveActiveProfileData = async (updater: (data: typeof accountData) => typeof accountData): Promise<boolean> => {
    if (!accountLibraryReadyRef.current) return false;
    const next = updater(structuredClone(accountDataRef.current));
    const library = createAccountLibrary(next, catalogTitlesRef.current);
    const operation = accountLibraryWriteRef.current.then(async () => {
      const result = await saveAccountLibrary(library, accountLibraryRevisionRef.current);
      if (result.status !== "saved") throw new Error(result.status === "conflict" ? "La bibliothèque a été modifiée dans un autre onglet. Rechargez la page avant de continuer." : "Session expirée.");
      accountLibraryRevisionRef.current = result.revision;
    });
    accountLibraryWriteRef.current = operation.catch(() => {});
    try { await operation; accountDataRef.current = next; setAccountData(next); return true; }
    catch (error) { setNotice({ title: "Bibliothèque non synchronisée", message: error instanceof Error ? error.message : "La sauvegarde distante a échoué." }); return false; }
  };

  const commitTitlesUnlocked = (next: Title[]) => {
    if (!canWriteTitlesRef.current || !accountLibraryReadyRef.current) {
      setNotice({ title: "Bibliothèque indisponible", message: "Connectez-vous à votre compte Discord avant de modifier la bibliothèque." });
      return false;
    }
    const safeTitles = next.map((title) => ({ ...title, videoUrl: undefined, videoAssetKey: undefined, posterAssetKey: undefined, backdropAssetKey: undefined }));
    catalogTitlesRef.current = safeTitles;
    const displayed = overlayAccountData(safeTitles, accountDataRef.current);
    titlesRef.current = displayed;
    setTitles(displayed);
    if (accountLibraryReadyRef.current) {
      const library = createAccountLibrary(accountDataRef.current, safeTitles);
      const operation = accountLibraryWriteRef.current.then(async () => {
        const result = await saveAccountLibrary(library, accountLibraryRevisionRef.current);
        if (result.status !== "saved") throw new Error(result.status === "conflict" ? "Conflit de synchronisation : rechargez la page." : "Session expirée.");
        accountLibraryRevisionRef.current = result.revision;
      });
      accountLibraryWriteRef.current = operation.catch(() => {});
      void operation.catch(() => setNotice({ title: "Synchronisation impossible", message: "La fiche est visible dans cette session mais n’a pas été enregistrée sur votre compte." }));
    }
    return true;
  };

  const commitTitles = async (next: Title[]) => {
    const locked = await withMediaReferencesLock(() => commitTitlesUnlocked(next));
    if (locked.status === "locked") return locked.value;
    setNotice({ title: "Enregistrement différé", message: "Le verrou de protection des références médias est indisponible. Aucune modification du catalogue n’a été enregistrée." });
    return false;
  };

  const commitFavorites = async (next: number[]) => saveActiveProfileData((data) => ({ ...data, favorites: next }));

  const savePlaybackForActive = (titleId: number, episodeSelection: { season: number; episode: number } | null, second: number, progress: number) => saveActiveProfileData((data) => {
    const id = String(titleId);
    const previous = data.playback[id] || { currentTime: 0, progress: 0, episodes: {} };
    const title = catalogTitlesRef.current.find((item) => item.id === titleId)
      || sharedCatalogTitlesRef.current.find((item) => item.id === titleId);
    if (!episodeSelection) return { ...data, playback: { ...data.playback, [id]: { ...previous, assetKey: title?.videoAssetKey || `${titleId}:video`, currentTime: second, progress } } };
    const episodeKey = `${episodeSelection.season}:${episodeSelection.episode}`;
    const episode = title?.seasons?.find((season) => season.number === episodeSelection.season)?.episodes.find((item) => item.number === episodeSelection.episode);
    return {
      ...data,
      playback: {
        ...data.playback,
        [id]: {
          ...previous,
          episodes: {
            ...previous.episodes,
            [episodeKey]: {
              assetKey: episode?.videoAssetKey || `${titleId}:episode:${episodeSelection.season}:${episodeSelection.episode}`,
              currentTime: second,
              progress,
            },
          },
        },
      },
    };
  });

  const recordAccountView = (titleId: number) => saveActiveProfileData((data) => addAccountView(data, titleId));

  const commitCatalogAndFavorites = (nextTitles: Title[], nextFavorites: number[]) => {
    if (!canWriteTitlesRef.current) {
      setNotice({ title: "Bibliothèque protégée", message: "Le catalogue n’a pas pu être lu correctement. Aucune suppression ne sera enregistrée." });
      return false;
    }
    const keptIds = new Set(nextTitles.map((item) => item.id));
    const removedIds = new Set(catalogTitlesRef.current.filter((item) => !keptIds.has(item.id)).map((item) => String(item.id)));
    if (!commitTitlesUnlocked(nextTitles)) return false;
    if (accountLibraryReadyRef.current) {
      void saveActiveProfileData((data) => {
        const playback = { ...data.playback };
        const viewCounts = { ...data.viewCounts };
        for (const id of removedIds) { delete playback[id]; delete viewCounts[id]; }
        return { ...data, favorites: nextFavorites, playback, viewCounts, history: data.history.filter((entry) => !removedIds.has(String(entry.titleId))) };
      }).then((saved) => {
        if (!saved) setNotice({ title: "Titre supprimé", message: "Le titre a été retiré. Le favori de ce profil reste conservé jusqu’à ce que son stockage soit disponible." });
      });
    }
    return true;
  };

  const readPersistedReferencedKeys = () => {
    const persisted = readLocalJson(() => window.localStorage, "cinebox-titles", isTitleList);
    if (persisted.status === "missing") return new Set<string>();
    if (persisted.status !== "valid") throw new Error("Le catalogue courant ne peut pas être validé.");
    return getTitlesAssetKeys(persisted.value);
  };

  const cleanupStagedReferences = async (references: Record<string, string>) => {
    const locked = await withMediaReferencesLock(() => cleanupUnpublishedAssets(
      Object.values(references),
      () => {
        const persisted = readLocalJson(() => window.localStorage, "cinebox-titles", isTitleList);
        if (persisted.status === "missing") return new Set(getTitlesAssetKeys(titlesRef.current));
        if (persisted.status !== "valid") throw new Error("Le catalogue courant ne peut pas être validé.");
        return new Set([
          ...getTitlesAssetKeys(titlesRef.current),
          ...getTitlesAssetKeys(persisted.value),
        ]);
      },
      deleteAssetKeys,
    ));
    if (locked.status === "locked") return locked.value;
    return { status: "references-unavailable" as const, candidateKeys: Object.values(references), error: locked.status === "failed" ? locked.error : new Error("Le verrou des références médias est indisponible.") };
  };

  const reportUnpublishedCleanupIssue = (operation: string, result: UnpublishedCleanupResult) => {
    if (result.status === "cleaned") return;
    const reason = result.status === "cleanup-failed"
      ? "La suppression des nouvelles clés a échoué ; elles ont été conservées dans IndexedDB."
      : "Les références actives n’ont pas pu être validées ; aucune nouvelle clé n’a été supprimée.";
    setNotice({
      title: "Nettoyage incomplet",
      message: `${operation} n’a pas été publiée. Les anciens médias et métadonnées restent intacts. ${reason}`,
    });
  };

  useEffect(() => {
    let cancelled = false;
    async function restoreLibrary() {
      try {
        const sessionResponse = await fetch("/api/account/session", { cache: "no-store" });
        const session = sessionResponse.ok ? await sessionResponse.json() : null;
        if (!session?.authenticated) {
          if (!cancelled) {
            setAuthStatus("unauthenticated");
            canWriteTitlesRef.current = false;
            canWriteFavoritesRef.current = false;
            setNotice({ title: "Connexion requise", message: "Connectez-vous avec Discord pour accéder à votre bibliothèque personnelle." });
            setReady(true);
          }
          return;
        }
        if (!cancelled) setAuthStatus("authenticated");
        const remote = await fetchAccountLibrary();
        if (remote.status !== "ready") throw new Error("Votre session a expiré. Reconnectez-vous.");
        if (cancelled) return;
        accountLibraryRevisionRef.current = remote.revision;
        const library = remote.library;
        const data = emptyAccountData();
        if (library) {
          catalogTitlesRef.current = library.titles as Title[];
          data.favorites = library.favorites;
          data.playback = library.playback as typeof data.playback;
          data.history = library.history;
          data.viewCounts = library.viewCounts;
          data.preferences = library.preferences;
        } else {
          catalogTitlesRef.current = [];
        }
        accountDataRef.current = data;
        setAccountData(data);
        const displayed = overlayAccountData(catalogTitlesRef.current, data);
        titlesRef.current = displayed;
        favoritesRef.current = data.favorites;
        setTitles(displayed);
        setFavorites(data.favorites);
        accountLibraryReadyRef.current = true;
        canWriteTitlesRef.current = true;
        canWriteFavoritesRef.current = true;
        setReady(true);
      } catch {
        if (!cancelled) {
          setAuthStatus(current => current === "checking" ? "error" : current);
          accountLibraryReadyRef.current = false;
          canWriteTitlesRef.current = false;
          canWriteFavoritesRef.current = false;
          setNotice({ title: "Bibliothèque indisponible", message: "Impossible de charger les données du compte. Aucune donnée locale n’a été utilisée ni écrasée." });
          setReady(true);
        }
      }
    }
    void restoreLibrary();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activePage !== "Administration") return;
    const controller = new AbortController();
    fetch("/api/catalog?limit=1", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Catalogue central indisponible");
        const payload = await response.json();
        const stats = payload.stats || {};
        setSharedAdminStats({ titles: Number(stats.titles)||0, films: Number(stats.films)||0, series: Number(stats.series)||0, videos: Number(stats.videos)||0, episodes: Number(stats.episodes)||0, loaded: true });
      })
      .catch(() => { if (!controller.signal.aborted) setSharedAdminStats(current => ({ ...current, loaded: false })); });
    return () => controller.abort();
  }, [activePage]);

  // Shared catalogue for all Discord accounts.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setSharedCatalogStatus({ status: "loading" });
    loadSharedCatalog({
      maxAge: null,
      signal: controller.signal,
    }).then((result) => {
      if (cancelled || result.status === "aborted") return;
      if (result.status === "success") {
        sharedCatalogTitlesRef.current = result.titles;
        setSharedCatalogTitles(result.titles);
        setSharedCatalogStatus({ status: "success" });
        return;
      }
      setSharedCatalogStatus({ status: "error", reason: result.reason });
    }).catch(() => {
      if (cancelled) return;
      setSharedCatalogStatus({ status: "error", reason: "invalid-response" });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [sharedCatalogRetryKey]);

  const filmTitles = useMemo(() => browseTitles.filter((item) => item.kind === "Film"), [browseTitles]);
  const filmGenres = useMemo(() => Array.from(new Set(filmTitles.map((item) => item.genre).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [filmTitles]);
  const filmYears = useMemo(() => Array.from(new Set(filmTitles.map((item) => item.year))).sort((a, b) => b - a), [filmTitles]);
  const seriesTitles = useMemo(() => browseTitles.filter((item) => item.kind === "Série"), [browseTitles]);
  const seriesGenres = useMemo(() => Array.from(new Set(seriesTitles.map((item) => item.genre).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [seriesTitles]);
  const seriesYears = useMemo(() => Array.from(new Set(seriesTitles.map((item) => item.year))).sort((a, b) => b - a), [seriesTitles]);
  const videoTitles = useMemo(() => browseTitles.filter((item) => item.kind === "Vidéo"), [browseTitles]);
  const favoriteTypeCounts = useMemo(() => computeFavoriteTypeCounts(browseTitles, favorites), [browseTitles, favorites]);
  const videoCategories = useMemo(() => Array.from(new Set(videoTitles.map((item) => item.genre).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [videoTitles]);
  const availableVideoDurationBands = useMemo(() => videoDurationBands.filter((band) => videoTitles.some((item) => getDurationBand(item.duration) === band.value)), [videoTitles]);
  const visibleTitles = useMemo(() => browseTitles.filter((item) => {
    const pageMatch = activePage === "Accueil" ||
      (activePage === "Ma liste" ? visibleFavorites.idSet.has(item.id) : item.kind === activePage.slice(0, -1) || (activePage === "Séries" && item.kind === "Série"));
    const filmPage = activePage === "Films";
    const seriesPage = activePage === "Séries";
    const videoPage = activePage === "Vidéos";
    const filterMatch = filmPage ? item.kind === "Film" : seriesPage ? item.kind === "Série" : videoPage ? item.kind === "Vidéo" : filter === "Tout" || item.kind === filter;
    const genreMatch = filmPage ? filmGenreFilter === "all" || item.genre === filmGenreFilter : seriesPage ? seriesGenreFilter === "all" || item.genre === seriesGenreFilter : videoPage ? videoCategoryFilter === "all" || item.genre === videoCategoryFilter : genreFilter === "Tous les genres" || item.genre === genreFilter;
    const yearMatch = filmPage ? filmYearFilter === "all" || String(item.year) === filmYearFilter : seriesPage ? seriesYearFilter === "all" || String(item.year) === seriesYearFilter : true;
    const durationMatch = videoPage ? videoDurationFilter === "all" || getDurationBand(item.duration) === videoDurationFilter : true;
    const progress = item.progress || 0;
    const viewingStatus = seriesPage ? getSeriesViewingStatus(item) : null;
    const viewingMatch = filmPage
      ? filmViewingFilter === "all" || (filmViewingFilter === "unwatched" && progress === 0) || (filmViewingFilter === "in-progress" && progress > 0 && progress < 100) || (filmViewingFilter === "watched" && progress >= 100)
      : seriesPage ? seriesViewingFilter === "all" || viewingStatus === seriesViewingFilter
      : true;
    const searchMatch = matchesTitleQuery(item, query);
    return pageMatch && filterMatch && genreMatch && yearMatch && durationMatch && viewingMatch && searchMatch;
  }).sort((a, b) => activePage === "Films"
    ? filmSortBy === "title" ? a.name.localeCompare(b.name, "fr")
      : filmSortBy === "year-desc" ? b.year - a.year || b.id - a.id
      : filmSortBy === "year-asc" ? a.year - b.year || b.id - a.id
      : filmSortBy === "progress" ? (b.progress || 0) - (a.progress || 0) || b.id - a.id
      : b.id - a.id
    : activePage === "Séries"
      ? seriesSortBy === "title" ? a.name.localeCompare(b.name, "fr")
        : seriesSortBy === "year-asc" ? a.year - b.year || b.id - a.id
        : seriesSortBy === "progress" ? getSeriesProgress(b) - getSeriesProgress(a) || b.id - a.id
        : seriesSortBy === "year-desc" ? b.year - a.year || b.id - a.id
        : b.id - a.id
      : activePage === "Ma liste"
        ? listSortBy === "title" ? a.name.localeCompare(b.name, "fr")
          : listSortBy === "title-desc" ? b.name.localeCompare(a.name, "fr")
          : listSortBy === "oldest" ? favorites.indexOf(a.id) - favorites.indexOf(b.id)
          : favorites.indexOf(b.id) - favorites.indexOf(a.id)
        : activePage === "Vidéos"
        ? videoSortBy === "title" ? a.name.localeCompare(b.name, "fr")
          : videoSortBy === "duration-asc" ? (parseDurationMinutes(a.duration) ?? Number.POSITIVE_INFINITY) - (parseDurationMinutes(b.duration) ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name, "fr")
          : videoSortBy === "duration-desc" ? (parseDurationMinutes(b.duration) ?? -1) - (parseDurationMinutes(a.duration) ?? -1) || a.name.localeCompare(b.name, "fr")
          : videoSortBy === "progress" ? (b.progress || 0) - (a.progress || 0) || b.id - a.id
          : b.id - a.id
        : sortBy === "title" ? a.name.localeCompare(b.name, "fr") : sortBy === "oldest" ? a.year - b.year : sortBy === "popular" ? (b.viewCount || 0) - (a.viewCount || 0) || b.year - a.year : b.year - a.year), [browseTitles, activePage, favorites, visibleFavorites, filter, genreFilter, query, sortBy, filmGenreFilter, filmYearFilter, filmViewingFilter, filmSortBy, seriesGenreFilter, seriesYearFilter, seriesViewingFilter, seriesSortBy, videoCategoryFilter, videoDurationFilter, videoSortBy, listSortBy]);

  const featuredTitles = useMemo(() => [...browseTitles].sort((a, b) => b.year - a.year).slice(0, 5), [browseTitles]);
  const activeFeatured = featuredTitles[heroIndex % Math.max(1, featuredTitles.length)];
  useEffect(() => {
    if (featuredTitles.length < 2 || prefersReducedMotion) return;
    const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % featuredTitles.length), 7000);
    return () => window.clearInterval(timer);
  }, [featuredTitles.length, prefersReducedMotion]);
  const ongoing = browseTitles.flatMap(item => {
    if (item.kind === "Série") {
      const watchedEpisodes = (item.seasons || []).flatMap(season => season.episodes)
        .filter(episode => Boolean(episode.videoUrl) && (episode.progress || 0) > 0 && (episode.progress || 0) < 100);
      if (watchedEpisodes.length === 0) return [];
      const latestEpisode = [...watchedEpisodes].sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0))[0];
      return [{ ...item, progress: latestEpisode.progress || 0, currentTime: latestEpisode.currentTime || 0 }];
    }
    return item.progress > 0 ? [item] : [];
  });
  const personalizedPicks = useMemo(() => {
    const favoriteGenres = favorites
      .map(id => browseTitles.find(item => item.id === id)?.genre)
      .filter((genre): genre is string => Boolean(genre));
    const genreCounts = favoriteGenres.reduce<Record<string, number>>((counts, genre) => {
      counts[genre] = (counts[genre] || 0) + 1;
      return counts;
    }, {});
    return browseTitles
      .filter(item => !favorites.includes(item.id) && item.progress === 0)
      .map(item => ({ item, score: genreCounts[item.genre] || 0 }))
      .sort((a, b) => b.score - a.score || b.item.year - a.item.year)
      .slice(0, 4)
      .map(entry => entry.item);
  }, [browseTitles, favorites]);
  const homeGenres = useMemo(() => Array.from(new Set(browseTitles.map(item => item.genre).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [browseTitles]);
  const topTenFilms = useMemo(() => [...browseTitles].filter(item => item.kind === "Film" && (item.viewCount || 0) > 0).sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 10), [browseTitles]);
  const topTenSeries = useMemo(() => [...browseTitles].filter(item => item.kind === "Série" && (item.viewCount || 0) > 0).sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 10), [browseTitles]);
  const upNext = useMemo(() => browseTitles.flatMap(item => {
    if (item.kind !== "Série") return [];
    const episodes = (item.seasons || []).flatMap(season => season.episodes.map(episode => ({ season: season.number, episode })))
      .sort((a, b) => a.season - b.season || a.episode.number - b.episode.number);
    const currentIndex = episodes.reduce((latest, entry, index) => (entry.episode.progress || 0) > 0 ? index : latest, -1);
    if (currentIndex < 0) return [];
    const next = episodes.slice(currentIndex + 1).find(entry => Boolean(entry.episode.videoUrl));
    return next ? [{ item, ...next }] : [];
  }), [browseTitles]);
  const collections = useMemo(() => {
    const groups = new Map<string, Title[]>();
    browseTitles.forEach(item => {
      const name = item.collection?.trim();
      if (name) groups.set(name, [...(groups.get(name) || []), item]);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [browseTitles]);
  const homeRows = useMemo(() => [
    { title: "Films à explorer", kicker: "LE GRAND ÉCRAN", items: browseTitles.filter(item => item.kind === "Film").sort((a, b) => b.year - a.year).slice(0, 10) },
    { title: "Séries à découvrir", kicker: "À SUIVRE", items: browseTitles.filter(item => item.kind === "Série").sort((a, b) => b.year - a.year).slice(0, 10) },
    { title: "Ajouts récents", kicker: "FRAÎCHEMENT AJOUTÉS", items: [...browseTitles].sort((a, b) => b.id - a.id).slice(0, 10) }
  ].filter(row => row.items.length), [browseTitles]);
  const withActiveProfilePlayback = (item: Title): Title => overlayAccountData([item], accountDataRef.current)[0];

  const openTitle = (item: Title) => {
    setSelectedEpisodeUrl(null);
    setSelectedEpisode(null);
    setSelected(withActiveProfilePlayback(item));
  };

  const resumeTitle = (item: Title) => {
    const episode = (item.seasons || []).flatMap(season => season.episodes.map(entry => ({ season: season.number, episode: entry })))
      .filter(entry => Boolean(entry.episode.videoUrl) && (entry.episode.progress || 0) > 0 && (entry.episode.progress || 0) < 100)
      .sort((a, b) => (b.episode.currentTime || 0) - (a.episode.currentTime || 0))[0];
    setSelected(item);
    if (episode?.episode.videoUrl) {
      setSelectedEpisode({ season: episode.season, episode: episode.episode.number });
      setSelectedEpisodeUrl(episode.episode.videoUrl);
    } else {
      setSelectedEpisode(null);
      setSelectedEpisodeUrl(null);
    }
  };
  const toggleFavorite = async (id: number) => {
    const current = favoritesRef.current;
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    await commitFavorites(next);
  };


  const addTitle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (submittingTitle) return;
    if (!canWriteTitlesRef.current) {
      setNotice({ title: "Bibliothèque protégée", message: "Les données existantes n’ont pas pu être lues. Elles sont conservées ; corrigez le problème de stockage avant toute modification." });
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let smartImport: (Partial<Title> & { tmdbId: number; name: string; releaseDate?: string; runtime?: number; genres?: string[]; seasons?: Title["seasons"]; posterPath?: string | null; backdropPath?: string | null }) | null = null;
    try {
      const value = String(form.get("smartImport") || "");
      if (value) {
        const parsed = JSON.parse(value);
        if (parsed && Number.isInteger(parsed.tmdbId) && typeof parsed.name === "string") smartImport = parsed;
      }
    } catch { /* Invalid optional metadata is ignored; the manual form remains usable. */ }
    const file = fileRef.current?.files?.[0];
    const episodeFiles = Array.from(document.querySelector<HTMLInputElement>('input[name="episodeVideos"]')?.files || []);
    const posterFile = posterRef.current?.files?.[0];
    const smartAssetFiles = Array.from(form.entries()).flatMap(([fieldName, value]) => fieldName.startsWith("smartAsset:") && value instanceof File && value.size > 0
      ? [{ slot: fieldName.slice("smartAsset:".length), file: value }]
      : []);
    const smartAssetMap = new Map(smartAssetFiles.map(({ slot, file: assetFile }) => [slot, assetFile]));
    if (file || episodeFiles.length || posterFile || smartAssetFiles.length) {
      setNotice({ title: "Import média temporairement désactivé", message: "Les fichiers locaux ne sont plus stockés dans le navigateur. L’ajout de vidéos et d’images sera réactivé après l’intégration des hébergeurs vidéo et du stockage média distant." });
      setSubmittingTitle(false);
      return;
    }
    const kind = form.get("kind") as Kind;
    const seasonCount = Math.max(1, Math.min(20, Number(form.get("seasonCount")) || 1));
    const episodeCount = Math.max(0, Math.min(100, Number(form.get("episodeCount")) || 0));
    const episodeNames = String(form.get("episodeTitles") || "").split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
    const removedEpisodeKeys = form.getAll("removeEpisode").map(String);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    setSubmittingTitle(true);
    const newId = editingTitle?.id ?? Date.now();
    const editingSeasons = editingTitle?.kind === "Série" ? editingTitle.seasons || [] : [];
    const initialEpisodeCount = episodeCount || Math.ceil(Math.max(episodeNames.length, episodeFiles.length) / seasonCount);
    const seasonDraft = kind === "Série" ? buildSeasonEditDraft({
      existingSeasons: editingSeasons,
      seasonCount,
      episodeCount: editingSeasons.length ? episodeCount : initialEpisodeCount,
      episodeNames,
      episodeFiles,
      removedEpisodeKeys,
    }) : null;
    const episodeUploads = kind === "Série" && smartImport?.seasons
      ? episodeFiles.flatMap((episodeFile, index) => {
          const target = smartImport!.seasons!.flatMap(season => season.episodes.map(episode => ({ season: season.number, episode: episode.number })))[index];
          return target ? [{ ...target, file: episodeFile }] : [];
        })
      : seasonDraft?.episodeUploads || [];
    const mediaFiles: Array<{ slot: string; baseKey: string; blob: Blob }> = [];
    if (posterFile) mediaFiles.push({ slot: "poster", baseKey: `${newId}:poster`, blob: posterFile });
    if (file) mediaFiles.push({ slot: "video", baseKey: `${newId}:video`, blob: file });
    smartAssetFiles.forEach(({ slot, file: assetFile }) => mediaFiles.push({ slot, baseKey: `${newId}:${slot}`, blob: assetFile }));
    episodeUploads.forEach(({ season: seasonNumber, episode: episodeNumber, file: episodeFile }) => {
      mediaFiles.push({ slot: `episode:${seasonNumber}:${episodeNumber}`, baseKey: `${newId}:episode:${seasonNumber}:${episodeNumber}`, blob: episodeFile });
    });
    const staging = await stageAssets(mediaFiles, saveVersionedAsset);
    if (staging.status === "failed") {
      const cleanup = await cleanupStagedReferences(staging.references);
      if (cleanup.status === "cleaned") {
        setNotice({ title: "Sauvegarde impossible", message: "Un ou plusieurs nouveaux fichiers n’ont pas pu être préparés. Les médias déjà enregistrés restent disponibles ; réessayez." });
        window.setTimeout(() => setNotice(null), 4500);
      } else {
        reportUnpublishedCleanupIssue("La préparation du titre", cleanup);
      }
      setSubmittingTitle(false);
      return;
    }
    const stagedKeys = staging.references;
    const importBatch = createProvisionalBlobUrlBatch();
    const createStagedObjectUrl = (blob: Blob) => importBatch.create(blob);
    let newTitle: Title;
    try {
      newTitle = {
      id: newId, name, kind,
      tmdbId: smartImport?.tmdbId ?? editingTitle?.tmdbId,
      sharedId: resolveSharedId({ tmdbId: smartImport?.tmdbId ?? editingTitle?.tmdbId, kind, localId: newId, existingSharedId: editingTitle?.sharedId }),
      source: "local",
      ageRating: editingTitle?.ageRating,
      minAge: editingTitle?.minAge,
      isAdult: editingTitle?.isAdult,
      year: Number(form.get("year")) || new Date().getFullYear(),
      genre: String(form.get("genre") || "À découvrir"),
      collection: String(form.get("collection") || "").trim() || undefined,
      description: String(form.get("description") || "Ajouté à votre bibliothèque personnelle."),
      poster: posterFile ? createStagedObjectUrl(posterFile) : editingTitle?.poster || "",
      posterAssetKey: stagedKeys.poster || editingTitle?.posterAssetKey,
      backdrop: editingTitle?.backdrop?.includes("images.unsplash.com/photo-1489599849927-2ee91cede3ba") ? "" : editingTitle?.backdrop || "",
      backdropAssetKey: editingTitle?.backdropAssetKey,
      progress: editingTitle?.progress || 0, currentTime: editingTitle?.currentTime, viewCount: editingTitle?.viewCount, duration: kind === "Série" ? `${seasonDraft?.seasons.length || seasonCount} saison${(seasonDraft?.seasons.length || seasonCount) > 1 ? "s" : ""}` : String(form.get("duration") || "Non renseigné"),
      episodes: kind === "Série"
        ? `${seasonDraft?.seasons.reduce((count, season) => count + season.episodes.length, 0) || 0} épisodes`
        : editingTitle?.kind === "Série" ? editingTitle.episodes : undefined,
      seasons: kind === "Série" ? seasonDraft!.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => {
          const slot = `episode:${season.number}:${episode.number}`;
          const uploadFile = seasonDraft!.episodeUploads.find((entry) => entry.season === season.number && entry.episode === episode.number)?.file;
          return {
            ...episode,
            videoUrl: uploadFile ? createStagedObjectUrl(uploadFile) : episode.videoUrl,
            videoAssetKey: stagedKeys[slot] || episode.videoAssetKey,
            currentTime: uploadFile ? 0 : episode.currentTime,
            progress: uploadFile ? 0 : episode.progress,
          };
        }),
      })) : editingTitle?.kind === "Série" ? editingTitle.seasons : undefined,
      videoUrl: kind !== "Série" ? (file ? createStagedObjectUrl(file) : editingTitle?.kind !== "Série" ? editingTitle?.videoUrl : undefined) : undefined,
      videoAssetKey: kind !== "Série" ? (stagedKeys.video || (editingTitle?.kind !== "Série" ? editingTitle?.videoAssetKey : undefined)) : undefined
      };
      if (smartImport) {
        newTitle.originalName = smartImport.originalName;
        newTitle.releaseDate = smartImport.releaseDate;
        newTitle.originalLanguage = smartImport.originalLanguage;
        newTitle.productionCountries = smartImport.productionCountries;
        newTitle.cast = smartImport.cast;
        newTitle.director = smartImport.director;
        newTitle.rating = smartImport.rating;
        newTitle.voteCount = smartImport.voteCount;
        newTitle.tmdbId = smartImport.tmdbId;
        newTitle.status = smartImport.status;
        newTitle.totalSeasons = smartImport.totalSeasons;
        newTitle.totalEpisodes = smartImport.totalEpisodes;
        newTitle.genres = smartImport.genres;
        newTitle.ageRating = smartImport.ageRating;
        newTitle.minAge = smartImport.minAge;
        newTitle.isAdult = smartImport.minAge === 18;
        newTitle.backdrop = smartImport.backdrop || newTitle.backdrop;
        newTitle.backdropAssetKey = stagedKeys["smart:backdrop"] || editingTitle?.backdropAssetKey;
        if (smartAssetMap.has("smart:backdrop")) newTitle.backdrop = createStagedObjectUrl(smartAssetMap.get("smart:backdrop")!);
        if (kind === "Série" && smartImport.seasons) {
          const previousEpisodes = new Map((editingTitle?.seasons || []).flatMap(season => season.episodes.map(episode => [`${season.number}:${episode.number}`, episode] as const)));
          newTitle.seasons = smartImport.seasons.map(season => ({
            ...season,
            posterAssetKey: stagedKeys[`smart:season:${season.number}:poster`] || season.posterAssetKey,
            posterUrl: smartAssetMap.has(`smart:season:${season.number}:poster`) ? createStagedObjectUrl(smartAssetMap.get(`smart:season:${season.number}:poster`)!) : season.posterUrl,
            episodes: season.episodes.map(episode => {
              const previous = previousEpisodes.get(`${season.number}:${episode.number}`);
              const uploaded = episodeUploads.find(entry => entry.season === season.number && entry.episode === episode.number)?.file;
              const slot = `episode:${season.number}:${episode.number}`;
              return {
                ...episode,
                thumbnailAssetKey: stagedKeys[`smart:episode:${season.number}:${episode.number}:thumbnail`] || episode.thumbnailAssetKey || previous?.thumbnailAssetKey,
                thumbnailUrl: smartAssetMap.has(`smart:episode:${season.number}:${episode.number}:thumbnail`) ? createStagedObjectUrl(smartAssetMap.get(`smart:episode:${season.number}:${episode.number}:thumbnail`)!) : episode.thumbnailUrl || previous?.thumbnailUrl,
                videoUrl: uploaded ? createStagedObjectUrl(uploaded) : previous?.videoUrl,
                videoAssetKey: stagedKeys[slot] || previous?.videoAssetKey,
                currentTime: uploaded ? 0 : previous?.currentTime,
                progress: uploaded ? 0 : previous?.progress,
              };
            }),
          }));
        }
      }
    } catch {
      importBatch.release();
      const cleanup = await cleanupStagedReferences(stagedKeys);
      if (cleanup.status === "cleaned") setNotice({ title: "Import impossible", message: "Une URL temporaire n’a pas pu être créée. Les anciennes métadonnées et les médias restent inchangés." });
      else reportUnpublishedCleanupIssue("La préparation des URL du titre", cleanup);
      setSubmittingTitle(false);
      return;
    }
    const nextTitles = editingTitle
      ? titlesRef.current.map(item => item.id === editingTitle.id ? newTitle : item)
      : [newTitle, ...titlesRef.current];
    const publishing = await publishWithMediaCleanupJournal({
      operation: editingTitle ? "title-update" : "title-add",
      commitMetadata: () => commitTitlesUnlocked(nextTitles),
      obsoleteKeys: editingTitle ? [...getTitleAssetKeys(editingTitle)] : [],
      readReferencedKeys: readPersistedReferencedKeys,
      deleteAssets: deleteAssetKeys
    });
    if (["commit-failed", "journal-failed", "catalog-unavailable", "deferred"].includes(publishing.status)) {
      const cleanup = await cleanupStagedReferences(stagedKeys);
      importBatch.release();
      if (publishing.status === "deferred") {
        setNotice({ title: "Publication différée", message: "Le verrou des références médias est indisponible. L’ancien catalogue et ses médias sont conservés." });
      } else {
        reportUnpublishedCleanupIssue("La publication du titre", cleanup);
      }
      setSubmittingTitle(false);
      return;
    }
    importBatch.transferTo(`${blobOwnerPrefix}:library`);
    let sharedPublishMessage = "";
    const adminSession = await getAdminSession();
    if (adminSession.authenticated) {
      try {
        const imagePath = (value?: string) => {
          if (!value) return null;
          try {
            const parsed = new URL(value, window.location.origin);
            return parsed.searchParams.get("path") || (parsed.hostname === "image.tmdb.org" ? parsed.pathname : null);
          } catch { return null; }
        };
        const publishTmdbId = smartImport?.tmdbId ?? editingTitle?.tmdbId;
        const sharedId = resolveSharedId({
          tmdbId: publishTmdbId,
          kind,
          localId: newId,
          existingSharedId: editingTitle?.sharedId,
        });
        const result = await adminJson("/api/catalog/publish", {
          method: "POST",
          body: JSON.stringify({
            id: sharedId, ...(publishTmdbId ? { tmdbId: publishTmdbId } : {}),
            kind: kind === "Série" ? "series" : kind === "Film" ? "movie" : "video",
            title: newTitle.name, overview: newTitle.description,
            releaseDate: smartImport?.releaseDate || (newTitle.year ? `${newTitle.year}-01-01` : ""),
            posterPath: smartImport?.posterPath || imagePath(newTitle.poster),
            backdropPath: smartImport?.backdropPath || imagePath(newTitle.backdrop),
            genres: newTitle.genres || newTitle.genre.split(",").map(value => value.trim()).filter(Boolean),
            metadata: {
              originalName: newTitle.originalName, originalLanguage: newTitle.originalLanguage,
              productionCountries: newTitle.productionCountries, cast: newTitle.cast,
              director: newTitle.director, rating: newTitle.rating, voteCount: newTitle.voteCount,
              status: newTitle.status, totalSeasons: newTitle.totalSeasons, totalEpisodes: newTitle.totalEpisodes,
              collection: newTitle.collection, duration: newTitle.duration,
              ageRating: newTitle.ageRating, minAge: newTitle.minAge, adult: newTitle.isAdult === true,
            },
            seasons: (newTitle.seasons || []).map(season => ({
              number: season.number, name: season.name, overview: season.overview,
              airDate: season.airDate, tmdbId: season.tmdbId,
              episodes: season.episodes.map(episode => ({
                number: episode.number, title: episode.title, overview: episode.overview,
                airDate: episode.airDate, runtime: episode.runtime, tmdbId: episode.tmdbId,
                thumbnailPath: imagePath(episode.thumbnailUrl),
              })),
            })),
          }),
        }) as { published?: boolean; error?: string };
        sharedPublishMessage = result.published
          ? " La fiche est publiée dans le catalogue partagé."
          : " Publication partagée échouée : " + (result.error || "erreur inconnue");
      } catch { sharedPublishMessage = " Le catalogue partagé n'a pas répondu ; la fiche reste enregistrée localement."; }
    } else {
      sharedPublishMessage = " Pour publier cette fiche pour tous, connecte-toi comme administrateur dans Administration > Médias.";
    }
    setEditingTitle(null);
    setShowAdd(false);
    formElement.reset();
    if (fileRef.current) fileRef.current.value = "";
    if (posterRef.current) posterRef.current.value = "";
    if (activePage === "Administration") setAdminSection(kind === "Série" ? "series" : kind === "Vidéo" ? "videos" : "films");
    else setActivePage("Accueil");
    setFilter("Tout");
    setNotice(publishing.status === "cleanup-pending"
      ? { title: "Contenu enregistré", message: `« ${name} » est enregistré. Le travail de nettoyage sera réessayé au prochain démarrage.${sharedPublishMessage}` }
      : { title: editingTitle ? "Modifications enregistrées" : "Ajout à la bibliothèque réussi", message: `« ${name} » a été sauvegardé dans votre collection.${sharedPublishMessage}` });
    window.setTimeout(() => setNotice(null), 3600);
    setSubmittingTitle(false);
  };

  const pageTitle = activePage === "Accueil" ? <>Le plaisir de <em>choisir.</em></> :
    activePage === "Films" ? <>Films</> :
    activePage === "Séries" ? <>Séries</> :
    activePage === "Vidéos" ? <>Vidéos</> :
    activePage === "Ma liste" ? <>Ma <em>liste.</em></> :
    activePage === "Administration" ? <>Gérez votre <em>bibliothèque.</em></> :
    <>Explorez les <em>{activePage.toLowerCase()}.</em></>;

  if (authStatus === "unauthenticated" || authStatus === "error") {
    return <DiscordAccessGate connectionError={authStatus === "error"} />;
  }

  if (!ready) {
    return (
      <main className="app-shell app-loading" aria-label="Chargement de votre bibliothèque">
        <div className="app-loading-brand"><CineboxLogo variant="loading" /></div>
        <div className="app-loading-indicator"><span/><span/><span/></div>
        <p>Préparation de votre cinéma personnel…</p>
      </main>
    );
  }

  return (
    <main className={`app-shell ${activePage === "Films" ? "films-screen" : activePage === "Séries" ? "series-screen" : activePage === "Vidéos" ? "videos-screen" : activePage === "Ma liste" ? "ma-list-screen" : activePage === "Administration" ? "admin-screen" : ""}`}>
      <aside className="sidebar" aria-label="Navigation principale">
        <header className="topbar">
          <BlurFade className="topbar-inner" duration={0.42}>
            <a className="brand topbar-brand" href="#" aria-label="CinéBox, accueil" onClick={(event) => { event.preventDefault(); setActivePage("Accueil"); setFilter("Tout"); }}><CineboxLogo variant="sidebar" /></a>
            <MagicCard className="primary-nav-surface">
              <nav className="side-nav primary-nav" aria-label="Rubriques CinéBox">
                {navItems.map(({ label }) => <button key={label} type="button" aria-current={activePage === label ? "page" : undefined} className={`nav-item ${activePage === label ? "active" : ""}`} onClick={() => { setActivePage(label); setFilter("Tout"); if (label === "Administration") setAdminSection("overview"); }}><span>{label}</span>{label === "Ma liste" && <small>{visibleFavorites.count}</small>}</button>)}
              </nav>
            </MagicCard>
            <div className="top-actions">
              {activePage !== "Administration" && <label className="search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={activePage === "Séries" ? "Rechercher une série…" : activePage === "Vidéos" ? "Rechercher une vidéo…" : activePage === "Ma liste" ? "Rechercher dans ma liste…" : "Rechercher dans ma collection…"} aria-label={activePage === "Séries" ? "Rechercher une série" : activePage === "Vidéos" ? "Rechercher une vidéo" : activePage === "Ma liste" ? "Rechercher dans ma liste" : "Rechercher dans ma collection"}/>{query && <button type="button" className="search-clear" aria-label="Effacer la recherche" onClick={() => setQuery("")}><X size={14}/></button>}</label>}

              <ProfileMenu />
            </div>
          </BlurFade>
        </header>
      </aside>

      <section className="main-area">

        <div className={`page-content ${activePage === "Films" ? "films-page" : activePage === "Séries" ? "series-page" : activePage === "Vidéos" ? "videos-page" : activePage === "Ma liste" ? "ma-list-page" : activePage === "Administration" ? "admin-page" : ""}`}>
          {activePage !== "Administration" && sharedCatalogStatus.status !== "success" && (
            <div
              className={`shared-catalog-status ${sharedCatalogStatus.status === "error" ? "is-error" : "is-loading"}`}
              role={sharedCatalogStatus.status === "error" ? "alert" : "status"}
              aria-live={sharedCatalogStatus.status === "error" ? "assertive" : "polite"}
            >
              {sharedCatalogStatus.status === "error" ? <ShieldAlert size={15} aria-hidden="true"/> : <LoaderCircle size={15} className="admin-spin" aria-hidden="true"/>}
              <div>
                <strong>{sharedCatalogStatus.status === "error" ? "Catalogue partagé indisponible" : "Chargement du catalogue partagé…"}</strong>
                {sharedCatalogStatus.status === "error" && <small>{sharedCatalogErrorMessage(sharedCatalogStatus.reason)}</small>}
              </div>
              {sharedCatalogStatus.status === "error" && (
                <button type="button" onClick={() => setSharedCatalogRetryKey((key) => key + 1)}><RefreshCw size={13} aria-hidden="true"/> Réessayer</button>
              )}
            </div>
          )}
          {activePage !== "Accueil" && <div className="welcome welcome-redesign"><div><div className="eyebrow">{activePage === "Films" ? "VOTRE BIBLIOTHÈQUE CINÉMA" : activePage === "Séries" ? "VOTRE COLLECTION DE SÉRIES" : activePage === "Vidéos" ? "VOTRE MÉDIATHÈQUE" : activePage === "Ma liste" ? "VOS FAVORIS" : activePage === "Administration" ? "CONSOLE DE GESTION" : "VOTRE COLLECTION PERSONNELLE"}</div><h1>{pageTitle}</h1><p className="welcome-subtitle">{activePage === "Films" ? `${filmTitles.length} film${filmTitles.length === 1 ? "" : "s"} dans votre collection` : activePage === "Séries" ? `${seriesTitles.length} série${seriesTitles.length === 1 ? "" : "s"} dans votre collection` : activePage === "Vidéos" ? `${videoTitles.length} vidéo${videoTitles.length === 1 ? "" : "s"} dans votre collection` : activePage === "Ma liste" ? `${visibleFavorites.count} favori${visibleFavorites.count === 1 ? "" : "s"} dans votre liste` : activePage === "Administration" ? `${titles.length} contenu${titles.length === 1 ? "" : "s"} · ${favorites.length} favori${favorites.length === 1 ? "" : "s"}` : "Votre cinéma privé, soigneusement composé."}</p></div><p className="welcome-quote">Un espace à vous.<span>Des histoires à l’infini.</span></p></div>}
          {activePage === "Accueil" && (activeFeatured ? <section className={`hero-cinema ${activeFeatured.backdrop ? "has-backdrop" : activeFeatured.poster ? "has-poster" : "is-empty"}`} aria-label="Sélection à la une">
            <AnimatedGridPattern className="hero-cinema-grid" numSquares={8} maxOpacity={0.06} duration={6} />
            <div className={`hero-cinema-bg ${activeFeatured.backdrop ? "hero-bg-landscape" : "hero-bg-poster"}`} style={{ backgroundImage: activeFeatured.backdrop || activeFeatured.poster ? `url("${activeFeatured.backdrop || activeFeatured.poster}")` : "none" }}/>
            <div className="hero-cinema-overlay"/>
            <BlurFade className="hero-cinema-copy" key={activeFeatured.id} direction="up" offset={14} duration={0.55}>
              <div className="hero-cinema-kicker"><AnimatedShinyText shimmerWidth={140}>À LA UNE · SÉLECTION CINÉBOX</AnimatedShinyText></div>
              <div className="hero-cinema-tag">{activeFeatured.kind.toUpperCase()} À DÉCOUVRIR</div>
              <h1 className="hero-cinema-title"><TextAnimate by="word" animation="blurInUp" duration={0.7} delay={0.05} once>{activeFeatured.name}</TextAnimate></h1>
              <div className="hero-cinema-meta">{activeFeatured.year} <span>·</span> {activeFeatured.genre} <span>·</span> {activeFeatured.duration}</div>
              <p className="hero-cinema-desc">{activeFeatured.description}</p>
              <div className="hero-cinema-actions">
                <ShimmerButton className="hero-cinema-play" onClick={() => setSelected(withActiveProfilePlayback(activeFeatured))}><Play size={15} fill="currentColor"/> Lecture</ShimmerButton>
                <button className="hero-cinema-info" onClick={() => setSelected(withActiveProfilePlayback(activeFeatured))}>Détails</button>
              </div>
            </BlurFade>
            {featuredTitles.length > 1 && <div className="hero-cinema-controls">
              <button type="button" className="hero-cinema-nav" aria-label="Titre précédent" onClick={() => setHeroIndex(index => (index - 1 + featuredTitles.length) % featuredTitles.length)}><ChevronRight size={16} className="hero-prev-icon"/></button>
              <span className="hero-cinema-counter" aria-live="polite">{(heroIndex % featuredTitles.length) + 1} <em>/</em> {featuredTitles.length}</span>
              <button type="button" className="hero-cinema-nav" aria-label="Titre suivant" onClick={() => setHeroIndex(index => (index + 1) % featuredTitles.length)}><ChevronRight size={16}/></button>
            </div>}
          </section> : <section className="hero-cinema hero-cinema-empty" aria-label="Bienvenue dans CinéBox">
            <AnimatedGridPattern className="hero-cinema-grid" numSquares={10} maxOpacity={0.08} duration={6} />
            <div className="hero-cinema-empty-content">
              <span className="hero-cinema-kicker"><AnimatedShinyText shimmerWidth={140}>VOTRE CINÉMA PERSONNEL</AnimatedShinyText></span>
              <h1 className="hero-cinema-title"><TextAnimate by="word" animation="blurInUp" duration={0.7} once>Votre prochaine histoire commence ici.</TextAnimate></h1>
              <p className="hero-cinema-desc">Ajoutez vos films et séries pour composer une collection à votre image.</p>

            </div>
          </section>)}



          {activePage === "Accueil" && ongoing.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
            <section className="section-block">
              <div className="section-head"><div><div className="eyebrow">REPRENDRE LÀ OÙ VOUS EN ÉTIEZ</div><h2>À continuer <em>pour vous</em></h2></div><span className="subtle">{ongoing.length} titre{ongoing.length > 1 ? "s" : ""} en cours</span></div>
              <div className="continue-grid">
                {ongoing.map((item) => <button className="continue-card" key={item.id} onClick={() => resumeTitle(item)}>{item.poster ? <img src={item.poster} alt=""/> : <span className="artwork-empty" aria-hidden="true"/>}<div className="continue-info"><small>{item.kind.toUpperCase()} · {item.year}</small><b>{item.name}</b><span>{item.progress}% regardé</span><div className="progress"><i style={{ width: `${item.progress}%` }}/></div></div><Play className="continue-play" size={17}/></button>)}
              </div>
            </section>
          </BlurFade>}

          {activePage === "Accueil" && personalizedPicks.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
            <section className="section-block discovery-block">
              <div className="section-head"><div><div className="eyebrow">SELON VOS ENVIES</div><h2>À découvrir <em>ensuite</em></h2></div><span className="subtle">Une sélection issue de vos favoris</span></div>
              <div className="discovery-grid">
                {personalizedPicks.map(item => <SpotlightSurface className="discovery-spotlight" key={item.id}><button className="discovery-card" onClick={() => openTitle(item)}>
                  {item.poster ? <img src={item.poster} alt="" loading="lazy"/> : <span className="artwork-empty" aria-hidden="true"/>}
                  <span className="discovery-copy"><small>{item.kind.toUpperCase()} · {item.genre}</small><strong>{item.name}</strong><i>{item.year}</i></span>
                  <Play className="discovery-play" size={16}/>
                </button></SpotlightSurface>)}
              </div>
            </section>
          </BlurFade>}

          {activePage === "Accueil" && <>
            <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
              <section className="streaming-genres section-block">
                <div className="section-head"><div><div className="eyebrow">TROUVEZ VOTRE PROCHAINE HISTOIRE</div><h2>Explorer par <em>genre</em></h2></div></div>
                <div className="genre-pills">
                  <button className={genreFilter === "Tous les genres" ? "active" : ""} onClick={() => setGenreFilter("Tous les genres")}>Tout voir</button>
                  {homeGenres.map(genre => <button key={genre} className={genreFilter === genre ? "active" : ""} onClick={() => { setGenreFilter(genre); document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" }); }}>{genre}</button>)}
                </div>
              </section>
            </BlurFade>
            {upNext.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
              <section className="section-block streaming-row-section">
                <div className="section-head"><div><div className="eyebrow">VOTRE PROCHAINE ÉTAPE</div><h2>À <em>suivre</em></h2></div></div>
                <div className="streaming-row">{upNext.map(({ item, season, episode }) => <button className="streaming-card" key={`${item.id}-${season}-${episode.number}`} onClick={() => { setSelected(item); setSelectedEpisode({ season, episode: episode.number }); setSelectedEpisodeUrl(episode.videoUrl || null); }}><StreamingArtwork src={episode.thumbnailUrl || item.poster}/><span className="streaming-card-info"><small>{item.name} · S{season} E{episode.number}</small><strong>{episode.title}</strong></span></button>)}</div>
              </section>
            </BlurFade>}
            {collections.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
              <section className="section-block streaming-row-section collections-section">
                <div className="section-head"><div><div className="eyebrow">À RETROUVER ENSEMBLE</div><h2>Collections & <em>sagas</em></h2></div><span className="subtle">{collections.length} collection{collections.length > 1 ? "s" : ""}</span></div>
                {collections.map(([name, items]) => <div className="collection-saga" key={name}>
                  <div className="collection-saga-heading"><strong>{name}</strong><span>{items.length} titre{items.length > 1 ? "s" : ""}</span></div>
                  <div className="streaming-row">{[...items].sort((a, b) => a.year - b.year).map(item => <button className="streaming-card" key={item.id} onClick={() => openTitle(item)}><StreamingArtwork src={item.poster}/><span className="streaming-card-info"><small>{item.kind} · {item.year}</small><strong>{item.name}</strong></span></button>)}</div>
                </div>)}
              </section>
            </BlurFade>}
            {topTenFilms.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
              <section className="section-block streaming-row-section">
                <div className="section-head"><div><div className="eyebrow">VOS FILMS LES PLUS REGARDÉS</div><h2>Top 10 <em>Films</em></h2></div><span className="subtle">Selon vos lectures</span></div>
                <div className="streaming-row top-ten-row">{topTenFilms.map((item, index) => <button className="streaming-card top-ten-card" key={item.id} onClick={() => openTitle(item)}><span className="top-ten-number">{index + 1}</span><StreamingArtwork src={item.poster}/><span className="streaming-card-info"><small>{item.year}</small><strong>{item.name}</strong></span></button>)}</div>
              </section>
            </BlurFade>}
            {topTenSeries.length > 0 && <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap">
              <section className="section-block streaming-row-section">
                <div className="section-head"><div><div className="eyebrow">VOS SÉRIES LES PLUS REGARDÉES</div><h2>Top 10 <em>Séries</em></h2></div><span className="subtle">Selon vos lectures</span></div>
                <div className="streaming-row top-ten-row">{topTenSeries.map((item, index) => <button className="streaming-card top-ten-card" key={item.id} onClick={() => openTitle(item)}><span className="top-ten-number">{index + 1}</span><StreamingArtwork src={item.poster}/><span className="streaming-card-info"><small>{item.year}</small><strong>{item.name}</strong></span></button>)}</div>
              </section>
            </BlurFade>}
            {homeRows.map(row => <BlurFade inView direction="up" offset={12} duration={0.45} className="section-block-wrap" key={row.title}>
              <section className="section-block streaming-row-section">
                <div className="section-head"><div><div className="eyebrow">{row.kicker}</div><h2>{row.title}</h2></div><span className="subtle">{row.items.length} contenu{row.items.length > 1 ? "s" : ""}</span></div>
                <div className="streaming-row">{row.items.map(item => <button className="streaming-card" key={item.id} onClick={() => openTitle(item)}><StreamingArtwork src={item.poster}/><span className="streaming-card-info"><small>{item.kind} · {item.year} · {item.genre}</small><strong>{item.name}</strong></span></button>)}</div>
              </section>
            </BlurFade>)}
          </>}
          {activePage === "Administration" && <nav className="admin-section-nav" aria-label="Sections d’administration">
            {adminSections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={adminSection === id ? "active" : ""} aria-current={adminSection === id ? "page" : undefined} onClick={() => { setAdminSection(id); setFilter("Tout"); }}><Icon size={16}/><span>{label}</span></button>)}
          </nav>}

          {activePage === "Administration" && adminSection === "overview" && <BlurFade inView direction="up" offset={10} duration={0.4} className="admin-overview-wrap">
            <section className="admin-overview" aria-labelledby="admin-dashboard-title">
              <AnimatedGridPattern className="admin-overview-grid" numSquares={10} maxOpacity={0.06} duration={6} />
              <div className="admin-heading"><div><div className="eyebrow">CATALOGUE CENTRAL</div><h2 id="admin-dashboard-title"><ShieldCheck size={19}/> Tableau de bord <span className={`admin-source-badge ${sharedAdminStats.loaded ? "is-d1" : "is-local"}`}>{sharedAdminStats.loaded ? "D1" : "INDISPONIBLE"}</span></h2><p>Le catalogue partagé D1 est la source unique des fiches de contenus. Gérez les films, séries, vidéos et médias depuis les sections dédiées.</p></div></div>
              <div className="admin-stats">
                <div><span><Library size={14}/> TITRES</span><strong>{sharedAdminStats.loaded ? <NumberTicker value={sharedAdminStats.titles} /> : "—"}</strong><small>catalogue partagé D1</small></div>
                <div><span><Film size={14}/> FILMS</span><strong>{sharedAdminStats.loaded ? <NumberTicker value={sharedAdminStats.films} /> : "—"}</strong><small>fiches films D1</small></div>
                <div><span><Tv size={14}/> SÉRIES</span><strong>{sharedAdminStats.loaded ? <NumberTicker value={sharedAdminStats.series} /> : "—"}</strong><small>fiches séries D1</small></div>
                <div><span><Play size={14}/> ÉPISODES</span><strong>{sharedAdminStats.loaded ? <NumberTicker value={sharedAdminStats.episodes} /> : "—"}</strong><small>épisodes D1</small></div>
                <div><span><Clapperboard size={14}/> VIDÉOS</span><strong>{sharedAdminStats.loaded ? <NumberTicker value={sharedAdminStats.videos} /> : "—"}</strong><small>fiches vidéos D1</small></div>
              </div>
            </section>
          </BlurFade>}

          {activePage === "Administration" && adminSection === "media" && <BlurFade inView direction="up" offset={10} duration={0.4} className="admin-type-wrap">
            <section className="admin-type-page" aria-labelledby="admin-media-title">
              <AnimatedGridPattern className="admin-type-grid-bg" numSquares={8} maxOpacity={0.05} duration={6} />
              <div className="admin-page-heading">
                <div>
                  <div className="eyebrow">CATALOGUE PARTAGÉ · D1</div>
                  <h2 id="admin-media-title">Médias du catalogue <span className="admin-source-badge is-d1">D1</span></h2>
                  <p>Affiches, fonds et miniatures d’épisodes enregistrés dans D1. Les fichiers de ce navigateur ne sont pas listés ici.</p>
                </div>
              </div>
              <SharedCatalogManager mode="media" />
            </section>
          </BlurFade>}

          {activePage === "Administration" && (adminSection === "films" || adminSection === "series" || adminSection === "videos") && <BlurFade inView direction="up" offset={10} duration={0.4} className="admin-type-wrap">
            <section className="admin-type-page" aria-labelledby="admin-type-title">
              <AnimatedGridPattern className="admin-type-grid-bg" numSquares={8} maxOpacity={0.05} duration={6} />
              <div className="admin-page-heading">
                <div>
                  <div className="eyebrow">CATALOGUE PARTAGÉ · D1</div>
                  <h2 id="admin-type-title">{adminSection === "films" ? "Gérer les films" : adminSection === "series" ? "Gérer les séries" : "Gérer les vidéos"} <span className="admin-source-badge is-d1">D1</span></h2>
                  <p>{adminSection === "films" ? "Fiches films publiées ou masquées dans le catalogue partagé. Les droits sont vérifiés côté serveur." : adminSection === "series" ? "Fiches séries, saisons et épisodes du catalogue partagé. Les droits sont vérifiés côté serveur." : "Fiches vidéos du catalogue partagé. Les droits sont vérifiés côté serveur."}</p>
                </div>

              </div>
              <SharedCatalogManager kindFilter={adminSection === "films" ? "movie" : adminSection === "series" ? "series" : "video"} />
            </section>
          </BlurFade>}

          {activePage !== "Administration" && <section className={`section-block catalogue ${activePage === "Films" ? "films-catalogue" : activePage === "Séries" ? "series-catalogue" : activePage === "Vidéos" ? "videos-catalogue" : activePage === "Ma liste" ? "ma-list-catalogue" : ""}`} id="catalogue">
            <div className="section-head"><div><div className="eyebrow">{activePage === "Films" ? "VOTRE CINÉMATHÈQUE" : activePage === "Séries" ? "VOTRE ESPACE SÉRIES" : activePage === "Vidéos" ? "VOTRE COLLECTION VIDÉO" : activePage === "Ma liste" ? "VOTRE SÉLECTION PERSONNELLE" : "À PORTÉE DE MAIN"}</div><h2>{activePage === "Films" ? "Tous vos films" : activePage === "Séries" ? "Toutes vos séries" : activePage === "Vidéos" ? "Toutes vos vidéos" : activePage === "Ma liste" ? "Vos favoris" : "Votre collection"} <em>{activePage === "Ma liste" ? "à retrouver" : "à explorer"}</em></h2></div>
              {activePage === "Films" ? <div className="films-result-count" aria-live="polite" aria-atomic="true">{visibleTitles.length} résultat{visibleTitles.length === 1 ? "" : "s"} <span>sur {filmTitles.length} film{filmTitles.length === 1 ? "" : "s"}</span></div> : activePage === "Séries" ? <div className="films-result-count" aria-live="polite" aria-atomic="true">{visibleTitles.length} résultat{visibleTitles.length === 1 ? "" : "s"} <span>sur {seriesTitles.length} série{seriesTitles.length === 1 ? "" : "s"}</span></div> : activePage === "Vidéos" ? <div className="films-result-count" aria-live="polite" aria-atomic="true">{visibleTitles.length} résultat{visibleTitles.length === 1 ? "" : "s"} <span>sur {videoTitles.length} vidéo{videoTitles.length === 1 ? "" : "s"}</span></div> : activePage === "Ma liste" ? <div className="films-result-count" aria-live="polite" aria-atomic="true">{visibleTitles.length} affiché{visibleTitles.length === 1 ? "" : "s"} <span>sur {visibleFavorites.count} favori{visibleFavorites.count === 1 ? "" : "s"}</span></div> : <div className="catalogue-tools"><span className="result-count" aria-live="polite" aria-atomic="true">{visibleTitles.length} TITRE{visibleTitles.length > 1 ? "S" : ""}</span><div className="filters" role="group" aria-label="Filtrer par type">{["Tout", "Film", "Série", "Vidéo"].map((f) => <button key={f} type="button" className={filter === f ? "selected" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "Tout" ? "Tout" : f + "s"}</button>)}</div><select className="sort-select genre-select" aria-label="Filtrer par genre" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}><option value="Tous les genres">Tous les genres</option>{Array.from(new Set(browseTitles.map(item => item.genre).filter(Boolean))).sort((a,b) => a.localeCompare(b,"fr")).map(genre => <option key={genre} value={genre}>{genre}</option>)}</select><select className="sort-select" aria-label="Trier la collection" value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="recent">Plus récents</option><option value="oldest">Plus anciens</option><option value="title">Ordre alphabétique</option><option value="popular">Les plus vus</option></select></div>}
            </div>
            {activePage === "Ma liste" && <div className="list-library-controls">
              <div className="filters list-type-filters" role="group" aria-label="Filtrer mes favoris par type">
                <button type="button" className={filter === "Tout" ? "selected" : ""} aria-pressed={filter === "Tout"} onClick={() => setFilter("Tout")}>Tout <small>{visibleFavorites.count}</small></button>
                <button type="button" className={filter === "Film" ? "selected" : ""} aria-label={`Films, ${favoriteTypeCounts.Film} favoris`} aria-pressed={filter === "Film"} onClick={() => setFilter("Film")}>Films <small>{favoriteTypeCounts.Film}</small></button>
                <button type="button" className={filter === "Série" ? "selected" : ""} aria-label={`Séries, ${favoriteTypeCounts.Série} favoris`} aria-pressed={filter === "Série"} onClick={() => setFilter("Série")}>Séries <small>{favoriteTypeCounts.Série}</small></button>
                <button type="button" className={filter === "Vidéo" ? "selected" : ""} aria-label={`Vidéos, ${favoriteTypeCounts.Vidéo} favoris`} aria-pressed={filter === "Vidéo"} onClick={() => setFilter("Vidéo")}>Vidéos <small>{favoriteTypeCounts.Vidéo}</small></button>
              </div>
              <label className="list-sort-control"><span>Trier par</span><select className="sort-select" aria-label="Trier mes favoris" value={listSortBy} onChange={(event) => setListSortBy(event.target.value)}><option value="recent">Ajoutés récemment</option><option value="oldest">Ajoutés en premier</option><option value="title">Titre A à Z</option><option value="title-desc">Titre Z à A</option></select></label>
            </div>}
            {activePage === "Films" && <div className="films-filters" aria-label="Filtres et tri des films">
              <label><span>Genre</span><select aria-label="Filtrer les films par genre" value={filmGenreFilter} onChange={(event) => setFilmGenreFilter(event.target.value)}><option value="all">Tous les genres</option>{filmGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select></label>
              <label><span>Année</span><select aria-label="Filtrer les films par année" value={filmYearFilter} onChange={(event) => setFilmYearFilter(event.target.value)}><option value="all">Toutes les années</option>{filmYears.map((year) => <option key={year} value={String(year)}>{year}</option>)}</select></label>
              <label><span>Visionnage</span><select aria-label="Filtrer les films par état de visionnage" value={filmViewingFilter} onChange={(event) => setFilmViewingFilter(event.target.value)}><option value="all">Tous les états</option><option value="unwatched">À voir</option><option value="in-progress">En cours</option><option value="watched">Terminés</option></select></label>
              <label><span>Trier par</span><select aria-label="Trier les films" value={filmSortBy} onChange={(event) => setFilmSortBy(event.target.value)}><option value="recent">Ajouts récents</option><option value="title">Titre A à Z</option><option value="year-desc">Année décroissante</option><option value="year-asc">Année croissante</option><option value="progress">Progression</option></select></label>
            </div>}
            {activePage === "Séries" && <div className="films-filters" aria-label="Filtres et tri des séries">
              <label><span>Genre</span><select aria-label="Filtrer les séries par genre" value={seriesGenreFilter} onChange={(event) => setSeriesGenreFilter(event.target.value)}><option value="all">Tous les genres</option>{seriesGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select></label>
              <label><span>Année</span><select aria-label="Filtrer les séries par année" value={seriesYearFilter} onChange={(event) => setSeriesYearFilter(event.target.value)}><option value="all">Toutes les années</option>{seriesYears.map((year) => <option key={year} value={String(year)}>{year}</option>)}</select></label>
              <label><span>Visionnage</span><select aria-label="Filtrer les séries par état de visionnage" value={seriesViewingFilter} onChange={(event) => setSeriesViewingFilter(event.target.value)}><option value="all">Tous les états</option><option value="unwatched">À découvrir</option><option value="in-progress">En cours</option><option value="watched">Épisodes terminés</option></select></label>
              <label><span>Trier par</span><select aria-label="Trier les séries" value={seriesSortBy} onChange={(event) => setSeriesSortBy(event.target.value)}><option value="recent">Ajouts récents</option><option value="title">Titre A à Z</option><option value="year-desc">Année décroissante</option><option value="year-asc">Année croissante</option><option value="progress">Progression</option></select></label>
            </div>}
            {activePage === "Vidéos" && <div className="films-filters video-library-filters" aria-label="Filtres et tri des vidéos">
              <label><span>Catégorie</span><select aria-label="Filtrer les vidéos par catégorie" value={videoCategoryFilter} onChange={(event) => setVideoCategoryFilter(event.target.value)}><option value="all">Toutes les catégories</option>{videoCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              {availableVideoDurationBands.length > 0 && <label><span>Durée</span><select aria-label="Filtrer les vidéos par durée" value={videoDurationFilter} onChange={(event) => setVideoDurationFilter(event.target.value)}><option value="all">Toutes les durées</option>{availableVideoDurationBands.map((band) => <option key={band.value} value={band.value}>{band.label}</option>)}</select></label>}
              <label><span>Trier par</span><select aria-label="Trier les vidéos" value={videoSortBy} onChange={(event) => setVideoSortBy(event.target.value)}><option value="recent">Ajouts récents</option><option value="title">Titre A à Z</option><option value="duration-asc">Durée croissante</option><option value="duration-desc">Durée décroissante</option><option value="progress">Progression</option></select></label>
            </div>}
            <div className={`poster-grid ${activePage === "Films" || activePage === "Séries" ? "films-poster-grid" : activePage === "Vidéos" ? "video-library-grid" : activePage === "Ma liste" ? "ma-list-poster-grid" : ""} ${(activePage === "Films" || activePage === "Séries") && visibleTitles.length > 4 && visibleTitles.length % 4 === 1 ? "films-poster-grid-balanced" : ""}`}>
              {visibleTitles.map((item, index) => <motion.article layout key={item.id} className={`poster-card ${activePage === "Vidéos" ? "video-library-card" : activePage === "Ma liste" ? "favorite-card" : ""}`} initial={{ opacity: 0, y: 16, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} whileHover={{ y: -6, scale: 1.018 }} whileTap={{ scale: .992 }} transition={{ layout: { duration: .28 }, opacity: { duration: .32, delay: Math.min(index * .035, .25) }, y: { type: "spring", stiffness: 280, damping: 22 }, scale: { type: "spring", stiffness: 300, damping: 24 } }}>
                <button className="poster-open" onClick={() => openTitle(item)} aria-label={`Ouvrir ${item.name}`}><div className={`poster-image ${activePage === "Vidéos" ? "video-thumbnail" : ""}`}>{(activePage === "Vidéos" ? item.backdrop || item.poster : item.poster) ? <img src={activePage === "Vidéos" ? item.backdrop || item.poster : item.poster} alt={item.name} loading="lazy"/> : <span className="artwork-empty" aria-hidden="true"/>}<span className="kind-chip">{item.kind}</span>{activePage === "Vidéos" && item.duration && <span className="video-duration-chip">{item.duration}</span>}<span className="poster-play"><Play size={20} fill="currentColor"/></span></div>{activePage === "Vidéos" ? <><div className="video-card-meta"><span>{item.genre || "Vidéo"}</span><span>{item.year}</span></div><strong>{item.name}</strong>{item.progress > 0 && <div className="video-card-progress"><div className="video-progress-track" role="progressbar" aria-label={`Progression de ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, item.progress))}><i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}/></div><small>{Math.round(item.progress)} % regardé</small></div>}</> : <><div className="poster-meta"><span>{item.genre}</span><span>{item.year}</span></div><strong>{item.name}</strong>{activePage === "Séries" && (item.seasons?.length || getSeriesProgress(item) > 0) && <div className="series-card-details">{Boolean(item.seasons?.length) && <span>{item.seasons!.length} saison{item.seasons!.length === 1 ? "" : "s"} · {item.seasons!.reduce((sum, season) => sum + season.episodes.length, 0)} épisode{item.seasons!.reduce((sum, season) => sum + season.episodes.length, 0) === 1 ? "" : "s"}</span>}{getSeriesProgress(item) > 0 && <><div className="series-progress-track" role="progressbar" aria-label={`Progression de ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={getSeriesProgress(item)}><i style={{ width: `${getSeriesProgress(item)}%` }}/></div><small>{getSeriesProgress(item)} % visionné</small></>}</div>}</>}</button>
                <button type="button" className={`heart-btn ${favorites.includes(item.id) ? "is-fav" : ""}`} onClick={() => toggleFavorite(item.id)} aria-label={favorites.includes(item.id) ? `Retirer ${item.name} des favoris` : `Ajouter ${item.name} aux favoris`} aria-pressed={favorites.includes(item.id)}><Heart size={16} fill={favorites.includes(item.id) ? "currentColor" : "none"}/></button>
              </motion.article>)}
              {!visibleTitles.length && activePage === "Films" && filmTitles.length === 0 && <div className="empty-state films-empty"><strong>Aucun film dans le catalogue</strong><span>Les films publiés dans le catalogue partagé apparaîtront ici.</span></div>}
              {!visibleTitles.length && activePage === "Films" && filmTitles.length > 0 && <div className="empty-state films-empty"><strong>Aucun film ne correspond à votre recherche</strong><span>Essayez un autre terme ou réinitialisez les filtres.</span><button type="button" onClick={() => { setQuery(""); setFilmGenreFilter("all"); setFilmYearFilter("all"); setFilmViewingFilter("all"); setFilmSortBy("recent"); }}>Effacer la recherche et les filtres</button></div>}
              {!visibleTitles.length && activePage === "Séries" && seriesTitles.length === 0 && <div className="empty-state films-empty"><strong>Aucune série dans le catalogue</strong><span>Les séries publiées dans le catalogue partagé apparaîtront ici.</span></div>}
              {!visibleTitles.length && activePage === "Séries" && seriesTitles.length > 0 && <div className="empty-state films-empty"><strong>Aucune série ne correspond à votre recherche</strong><span>Essayez un autre terme ou réinitialisez les filtres.</span><button type="button" onClick={() => { setQuery(""); setSeriesGenreFilter("all"); setSeriesYearFilter("all"); setSeriesViewingFilter("all"); setSeriesSortBy("recent"); }}>Effacer la recherche et les filtres</button></div>}
              {!visibleTitles.length && activePage === "Vidéos" && videoTitles.length === 0 && <div className="empty-state videos-empty"><strong>Aucune vidéo dans le catalogue</strong><span>Les vidéos publiées dans le catalogue partagé apparaîtront ici.</span></div>}
              {!visibleTitles.length && activePage === "Vidéos" && videoTitles.length > 0 && <div className="empty-state videos-empty"><strong>Aucune vidéo ne correspond à votre recherche</strong><span>Modifiez votre recherche ou vos filtres pour retrouver vos vidéos.</span><button type="button" onClick={() => { setQuery(""); setVideoCategoryFilter("all"); setVideoDurationFilter("all"); setVideoSortBy("recent"); }}>Effacer la recherche et les filtres</button></div>}
              {!visibleTitles.length && activePage === "Ma liste" && favorites.length === 0 && <div className="empty-state favorites-empty"><span className="favorites-empty-mark"><Heart size={21}/></span><strong>Votre liste commence avec vos coups de cœur</strong><span>Ajoutez des films, séries ou vidéos à vos favoris pour les retrouver ici.</span></div>}
              {!visibleTitles.length && activePage === "Ma liste" && favorites.length > 0 && <div className="empty-state favorites-empty"><span className="favorites-empty-mark"><Search size={20}/></span><strong>Aucun favori ne correspond à votre recherche</strong><span>Essayez un autre titre ou affichez tous vos favoris.</span><button type="button" onClick={() => { setQuery(""); setFilter("Tout"); }}>Effacer la recherche et les filtres</button></div>}
              {!visibleTitles.length && activePage === "Accueil" && <div className="empty-state"><strong>Aucun titre trouvé</strong><span>Modifiez votre recherche ou réinitialisez les filtres pour retrouver votre collection.</span><button type="button" onClick={() => { setQuery(""); setFilter("Tout"); setGenreFilter("Tous les genres"); }}>Réinitialiser la recherche et les filtres</button></div>}
            </div>
          </section>}
          <footer><span>© 2026 CINÉBOX</span><span>VOTRE CINÉMA PERSONNEL <Star size={10} aria-hidden="true"/></span></footer>
        </div>
      </section>

      <AnimatePresence>
        {confirmDelete && <DeleteConfirmation key="delete-confirmation"
          title={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const target = confirmDelete;
            const nextTitles = titlesRef.current.filter((item) => item.id !== target.id);
            const nextFavorites = favoritesRef.current.filter((id) => id !== target.id);
            const publishing = await publishWithMediaCleanupJournal({
              operation: "title-delete",
              commitMetadata: () => commitCatalogAndFavorites(nextTitles, nextFavorites),
              obsoleteKeys: [...getTitleAssetKeys(target)],
              readReferencedKeys: readPersistedReferencedKeys,
              deleteAssets: deleteAssetKeys
            });
            if (publishing.status === "commit-failed" || publishing.status === "journal-failed" || publishing.status === "catalog-unavailable" || publishing.status === "deferred") {
              if (publishing.status === "deferred") setNotice({ title: "Suppression différée", message: "Le verrou des références médias est indisponible. Le titre et ses médias sont conservés." });
              else if (publishing.status === "journal-failed") setNotice({ title: "Suppression impossible", message: "Le travail de nettoyage n’a pas pu être enregistré. Le titre et ses médias restent inchangés." });
              else if (publishing.status === "catalog-unavailable") setNotice({ title: "Suppression protégée", message: "Le catalogue ne peut pas être validé ou une récupération est en attente. Le titre et ses médias sont conservés." });
              return;
            }
            setConfirmDelete(null);
            if (publishing.status === "cleanup-pending") {
              setNotice({ title: "Titre supprimé, nettoyage incomplet", message: "La suppression est enregistrée. Les médias restants ont été conservés et leur nettoyage pourra être retenté." });
            } else {
              setNotice({ title: "Titre supprimé", message: "Le contenu a été supprimé de votre bibliothèque." });
              window.setTimeout(() => setNotice(null), 3600);
            }
          }}
        />}
        {notice && <AppToast key="app-toast" notice={notice} onClose={() => setNotice(null)} />}
        {showAdd && <TitleEditor key="title-editor"
          addKind={addKind}
          setAddKind={setAddKind}
          editingTitle={editingTitle}
          existingTitles={titlesRef.current}
          setEditingTitle={setEditingTitle}
          adminMode={activePage === "Administration"}
          fileRef={fileRef}
          posterRef={posterRef}
          submitting={submittingTitle}
          onClose={() => { setShowAdd(false); setEditingTitle(null); setSubmittingTitle(false); }}
          onSubmit={addTitle}
        />}
        <EpisodeEditor key="episode-editor"
          selected={selected}
          editingEpisode={editingEpisode}
          onClose={() => setEditingEpisode(null)}
          onSave={async (target, file, thumbnailFile) => {
            if (!selected) return;
            if (!canWriteTitlesRef.current) {
              setNotice({ title: "Bibliothèque protégée", message: "Les données existantes n’ont pas pu être lues. Aucune modification ne sera enregistrée." });
              return;
            }
            const key = `${selected.id}:episode:${target.season}:${target.episode}`;
            const assets = [
              ...(file ? [{ slot: "episode", baseKey: key, blob: file }] : []),
              ...(thumbnailFile ? [{ slot: "thumbnail", baseKey: `${key}:thumbnail`, blob: thumbnailFile }] : []),
            ];
            const staging = await stageAssets(assets, saveVersionedAsset);
            if (staging.status === "failed") {
              const cleanup = await cleanupStagedReferences(staging.references);
              if (cleanup.status === "cleaned") {
                setNotice({ title: "Sauvegarde impossible", message: "Un ou plusieurs nouveaux fichiers de l’épisode n’ont pas pu être préparés. Les anciennes associations et progressions restent disponibles." });
              } else {
                reportUnpublishedCleanupIssue("La préparation de l’épisode", cleanup);
              }
              return;
            }
            const versionedKey = staging.references.episode;
            const versionedThumbnailKey = staging.references.thumbnail;
            const importBatch = createProvisionalBlobUrlBatch();
            let videoUrl: string | undefined;
            let thumbnailUrl: string | undefined;
            try {
              videoUrl = file ? importBatch.create(file) : undefined;
              thumbnailUrl = thumbnailFile ? importBatch.create(thumbnailFile) : undefined;
            } catch {
              importBatch.release();
              const cleanup = await cleanupStagedReferences(staging.references);
              reportUnpublishedCleanupIssue("La préparation des URL de l’épisode", cleanup);
              return;
            }
            const update = (item: Title): Title => ({
              ...item,
              seasons: item.seasons?.map(season => season.number !== target.season ? season : {
                ...season,
                episodes: season.episodes.map(episode => episode.number !== target.episode ? episode : {
                  ...episode, title: target.title,
                  ...(videoUrl ? { videoUrl, videoAssetKey: versionedKey, currentTime: 0, progress: 0 } : {}),
                  ...(thumbnailUrl ? { thumbnailUrl, thumbnailAssetKey: versionedThumbnailKey } : {})
                })
              })
            });
            const nextTitles = titlesRef.current.map((item) => item.id === selected.id ? update(item) : item);
            const oldEpisode = selected.seasons?.find(season => season.number === target.season)?.episodes.find(episode => episode.number === target.episode);
            const oldEpisodeKey = oldEpisode?.videoAssetKey || key;
            const oldThumbnailKey = oldEpisode?.thumbnailAssetKey || `${key}:thumbnail`;
            const publishing = await publishWithMediaCleanupJournal({
              operation: "episode-update",
              commitMetadata: () => commitTitlesUnlocked(nextTitles),
              obsoleteKeys: [...(file ? [oldEpisodeKey] : []), ...(thumbnailFile ? [oldThumbnailKey] : [])],
              readReferencedKeys: readPersistedReferencedKeys,
              deleteAssets: deleteAssetKeys
            });
            if (["commit-failed", "journal-failed", "catalog-unavailable", "deferred"].includes(publishing.status)) {
              const cleanup = await cleanupStagedReferences(staging.references);
              importBatch.release();
              if (publishing.status === "deferred") setNotice({ title: "Publication différée", message: "Le verrou des références médias est indisponible. Les anciennes associations et progressions restent intactes." });
              else reportUnpublishedCleanupIssue("La publication de l’épisode", cleanup);
              return;
            }
            importBatch.transferTo(`${blobOwnerPrefix}:library`);
            const updatedTitle = nextTitles.find(item => item.id === selected.id);
            if (updatedTitle) setSelected(updatedTitle);
            if (file) {
              const playback = playbackStateAfterEpisodeReplacement(target.season, target.episode, videoUrl, selectedEpisodeUrl);
              setSelectedEpisode(playback.selectedEpisode);
              setSelectedEpisodeUrl(playback.selectedEpisodeUrl);
            }
            setEditingEpisode(null);
            setNotice(publishing.status === "cleanup-pending"
              ? { title: "Épisode enregistré", message: "La nouvelle association est active. Le travail de nettoyage est conservé et sera réessayé au prochain démarrage." }
              : { title: "Épisode mis à jour", message: "Les informations de l’épisode ont été enregistrées." });
            window.setTimeout(() => setNotice(null), 3600);
          }}
        />
        <DetailModal key="detail-modal"
          selected={selected}
          selectedEpisodeUrl={selectedEpisodeUrl}
          selectedEpisode={selectedEpisode}
          activePage={activePage}
          favorites={favorites}
          onClose={() => { setSelected(null); setSelectedEpisodeUrl(null); setSelectedEpisode(null); }}
          onSelectEpisode={(season, episode, url) => {
            setSelectedEpisode({ season, episode });
            setSelectedEpisodeUrl(url || null);
          }}
          onEditEpisode={(season, episode, title) => setEditingEpisode({ season, episode, title })}
          onToggleFavorite={toggleFavorite}
          onView={async (titleId) => { await recordAccountView(titleId); }}
          onProgress={async (titleId, episodeSelection, second, progress) => {
            if (!await savePlaybackForActive(titleId, episodeSelection, second, progress)) return;
            if (episodeSelection) {
              const { season: seasonNumber, episode: episodeNumber } = episodeSelection;
              setSelected(old => old && old.id === titleId ? {
                ...old,
                seasons: old.seasons?.map(season => season.number !== seasonNumber ? season : {
                  ...season,
                  episodes: season.episodes.map(episode => episode.number === episodeNumber ? { ...episode, currentTime: second, progress } : episode)
                })
              } : old);
            } else {
              setSelected(old => old && old.id === titleId ? { ...old, currentTime: second, progress } : old);
            }
          }}
          onEnded={async (title, episodeSelection) => {
            if (!episodeSelection || !title.seasons) return;
            const episodeKey = `${episodeSelection.season}:${episodeSelection.episode}`;
            if (!await saveActiveProfileData((data) => {
              const id = String(title.id);
              const current = data.playback[id] || { currentTime: 0, progress: 0, episodes: {} };
              const episode = current.episodes[episodeKey] || { currentTime: 0, progress: 0 };
              return { ...data, playback: { ...data.playback, [id]: { ...current, episodes: { ...current.episodes, [episodeKey]: { ...episode, progress: 100 } } } } };
            })) return;
            setSelected(old => old && old.id === title.id ? {
              ...old,
              seasons: old.seasons?.map(season => season.number !== episodeSelection.season ? season : {
                ...season,
                episodes: season.episodes.map(episode => episode.number === episodeSelection.episode ? { ...episode, progress: 100 } : episode),
              }),
            } : old);
            const playable = title.seasons.flatMap(season => season.episodes
              .filter(episode => episode.videoUrl || (title.tmdbId && title.kind === "Série"))
              .map(episode => ({ season: season.number, episode: episode.number, url: episode.videoUrl || "" })));
            const currentIndex = playable.findIndex(item => item.season === episodeSelection.season && item.episode === episodeSelection.episode);
            const next = playable[currentIndex + 1];
            if (next && accountData.preferences.autoplayNext !== false) {
              setSelectedEpisode({ season: next.season, episode: next.episode });
              setSelectedEpisodeUrl(next.url);
            }
          }}
        />
      </AnimatePresence>
      <nav className="mobile-bottom-nav" aria-label="Navigation mobile">{navItems.map(({ label, icon: Icon }) => <button key={label} type="button" aria-current={activePage === label ? "page" : undefined} className={activePage === label ? "active" : ""} onClick={() => { setActivePage(label); setFilter("Tout"); }}><Icon size={18}/><span>{label === "Administration" ? "Admin" : label}</span>{label === "Ma liste" && visibleFavorites.count > 0 && <i>{visibleFavorites.count}</i>}</button>)}</nav>
    </main>
  );
}
