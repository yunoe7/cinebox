"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Database,
  Edit3,
  EyeOff,
  Film,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
  Search,
  ShieldAlert,
  Tv,
  Video,
} from "lucide-react";
import { adminJson, getAdminSession, isAdminAuthError, loginAdmin, logoutAdmin } from "../../lib/cinebox/admin-session.mjs";
import { resolveRuntime } from "../../lib/cinebox/catalog-metadata.mjs";
import { AdminSessionPanel, type AdminAuthState } from "./AdminSessionPanel";

type Episode = {
  id: string;
  season_number: number;
  episode_number: number;
  title: string;
  overview?: string;
  duration_seconds: number | null;
  thumbnail_path?: string | null;
  metadata?: Record<string, unknown>;
};

type Metadata = Record<string, unknown>;

type Item = {
  id: string;
  kind: "movie" | "series" | "video";
  title: string;
  overview: string;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres?: string[];
  published: number;
  vip_exclusive?: number;
  vip_early_access?: number;
  public_at?: string | null;
  updated_at?: string;
  metadata?: Metadata;
  episodes?: Episode[];
};

type StatusFilter = "all" | "published" | "hidden";
type SortMode = "updated" | "title" | "year-desc" | "year-asc" | "episodes" | "duration";

const kindLabels = { movie: "Film", series: "Série", video: "Vidéo" } as const;
const kindIcons = { movie: Film, series: Tv, video: Video } as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaNumber(metadata: Metadata | undefined, key: string): number | null {
  return numeric(metadata?.[key]);
}

function tmdbImage(path: string | null | undefined, size = "w185"): string {
  if (!path) return "";
  return path.startsWith("http") ? path : `https://image.tmdb.org/t/p/${size}${path}`;
}

function yearOf(item: Item): number {
  if (!item.release_date) return 0;
  const year = new Date(item.release_date).getUTCFullYear();
  return Number.isFinite(year) ? year : 0;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "Durée inconnue";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

function runtimeLabel(item: Item): string {
  const runtime = resolveRuntime(item.metadata);
  if (runtime && runtime > 0) return `${Math.round(runtime)} min`;
  const seconds = metaNumber(item.metadata, "durationSeconds");
  if (seconds && seconds > 0) return formatDuration(seconds);
  return "Durée inconnue";
}

function updatedLabel(value?: string): string {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function episodeCount(item: Item): number {
  return (item.episodes || []).length;
}

function seasonCount(item: Item): number {
  return new Set((item.episodes || []).map((episode) => episode.season_number)).size;
}

function searchable(item: Item): string {
  return [
    item.title,
    item.overview,
    item.release_date || "",
    kindLabels[item.kind],
    ...(item.genres || []),
    ...(item.episodes || []).map((episode) => episode.title),
  ].join(" ").toLocaleLowerCase("fr");
}

type MediaEntry = {
  key: string;
  item: Item;
  label: string;
  path: string;
  episode: Episode | null;
  size: "w185" | "w300";
};

/**
 * Builds the D1 media inventory. Only paths actually stored in the shared
 * catalogue are listed: nothing is invented and no local IndexedDB file is read.
 */
function collectMedia(items: Item[]): MediaEntry[] {
  const entries: MediaEntry[] = [];
  for (const item of items) {
    if (item.poster_path) entries.push({ key: `${item.id}:poster`, item, label: item.kind === "video" ? "Miniature vidéo" : "Affiche", path: item.poster_path, episode: null, size: "w185" });
    if (item.backdrop_path) entries.push({ key: `${item.id}:backdrop`, item, label: "Fond", path: item.backdrop_path, episode: null, size: "w300" });
    for (const episode of item.episodes || []) {
      if (episode.thumbnail_path) entries.push({ key: `${item.id}:episode:${episode.id}`, item, label: `Miniature S${episode.season_number} E${episode.episode_number}`, path: episode.thumbnail_path, episode, size: "w300" });
    }
  }
  return entries;
}

export function SharedCatalogManager({ kindFilter, mode = "catalog" }: { kindFilter?: "movie" | "series" | "video"; mode?: "catalog" | "media" }) {
  const isMediaMode = mode === "media";
  const headingId = useId();
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftOverview, setDraftOverview] = useState("");
  const [draftVipExclusive, setDraftVipExclusive] = useState(false);
  const [draftVipEarlyAccess, setDraftVipEarlyAccess] = useState(false);
  const [draftPublicAt, setDraftPublicAt] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [pendingConfirmation, setPendingConfirmation] = useState<{ item: Item; permanent: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAdminSession().then((session) => {
      if (!cancelled) setAuthState(session.authenticated ? "authenticated" : "anonymous");
    });
    return () => { cancelled = true; };
  }, []);

  const logout = async () => {
    await logoutAdmin();
    setAuthState("anonymous");
    setItems([]);
    setLoadedOnce(false);
    setLoadError("");
    setActionMessage("");
    setActionError(false);
  };

  const login = () => { void loginAdmin(); };

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    try {
      return await adminJson(path, init);
    } catch (reason) {
      if (isAdminAuthError(reason) && reason.status === 401) {
        setAuthState("anonymous");
        setItems([]);
        setLoadedOnce(false);
      }
      throw reason;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (authState !== "authenticated") {
      setItems([]);
      setLoadedOnce(false);
      setLoadError("");
      setActionError(false);
      setActionMessage("");
      return false;
    }
    setLoading(true);
    setLoadError("");
    setActionError(false);
    setActionMessage("");
    try {
      const payload = await request("/api/catalog/manage", { cache: "no-store" });
      const next = payload && typeof payload === "object" && Array.isArray((payload as { titles?: unknown }).titles)
        ? (payload as { titles: Item[] }).titles
        : null;
      // A malformed payload is a load failure, never a silent empty catalogue.
      if (!next) throw new Error("Le catalogue partagé a renvoyé une réponse inattendue.");
      setItems(next);
      setLoadedOnce(true);
      return true;
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Chargement du catalogue partagé impossible.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [authState, request]);

  useEffect(() => {
    if (authState === "authenticated") void refresh();
  }, [authState, refresh]);

  const kindItems = useMemo(
    () => items.filter((item) => !kindFilter || item.kind === kindFilter),
    [items, kindFilter],
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return kindItems
      .filter((item) => {
        if (statusFilter === "published" && Number(item.published) !== 1) return false;
        if (statusFilter === "hidden" && Number(item.published) === 1) return false;
        return !needle || searchable(item).includes(needle);
      })
      .sort((a, b) => {
        if (sortMode === "title") return a.title.localeCompare(b.title, "fr");
        if (sortMode === "year-desc") return yearOf(b) - yearOf(a) || a.title.localeCompare(b.title, "fr");
        if (sortMode === "year-asc") return yearOf(a) - yearOf(b) || a.title.localeCompare(b.title, "fr");
        if (sortMode === "episodes") return episodeCount(b) - episodeCount(a) || a.title.localeCompare(b.title, "fr");
        if (sortMode === "duration") return (resolveRuntime(b.metadata) || 0) - (resolveRuntime(a.metadata) || 0) || a.title.localeCompare(b.title, "fr");
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime() || a.title.localeCompare(b.title, "fr");
      });
  }, [kindItems, query, statusFilter, sortMode]);

  const publishedCount = kindItems.filter((item) => Number(item.published) === 1).length;
  const kindLabel = kindFilter ? kindLabels[kindFilter] : "fiche";
  const kindPlural = kindFilter === "movie" ? "films" : kindFilter === "series" ? "séries" : kindFilter === "video" ? "vidéos" : "fiches";
  const filtersActive = Boolean(query.trim()) || statusFilter !== "all" || sortMode !== "updated";

  const mediaEntries = useMemo(() => collectMedia(items), [items]);
  const visibleMedia = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return mediaEntries
      .filter((entry) => !needle || [
        entry.item.title,
        entry.label,
        kindLabels[entry.item.kind],
        ...(entry.item.genres || []),
        entry.episode?.title || "",
      ].join(" ").toLocaleLowerCase("fr").includes(needle))
      .sort((a, b) => {
        if (sortMode === "title") return a.item.title.localeCompare(b.item.title, "fr") || a.label.localeCompare(b.label, "fr");
        return new Date(b.item.updated_at || 0).getTime() - new Date(a.item.updated_at || 0).getTime()
          || a.item.title.localeCompare(b.item.title, "fr")
          || a.label.localeCompare(b.label, "fr");
      });
  }, [mediaEntries, query, sortMode]);
  const mediaFiltersActive = Boolean(query.trim()) || sortMode !== "updated";

  const save = async (item: Item) => {
    setBusy(item.id);
    setActionError(false);
    setActionMessage("");
    try {
      await request("/api/catalog/manage", { method: "PATCH", body: JSON.stringify({ id: item.id, title: draftTitle, overview: draftOverview, vip_exclusive: draftVipExclusive, vip_early_access: draftVipEarlyAccess, public_at: draftPublicAt ? new Date(draftPublicAt).toISOString() : null }) });
      setEditing(null);
      if (await refresh()) setActionMessage("Fiche mise à jour dans le catalogue partagé.");
    } catch (reason) {
      setActionError(true);
      setActionMessage(reason instanceof Error ? reason.message : "Modification impossible.");
    } finally {
      setBusy("");
    }
  };

  const republish = async (item: Item) => {
    setBusy(item.id);
    setActionError(false);
    setActionMessage("");
    try {
      await request("/api/catalog/manage", { method: "PATCH", body: JSON.stringify({ id: item.id, published: true }) });
      if (await refresh()) setActionMessage("Fiche republiée dans le catalogue partagé.");
    } catch (reason) {
      setActionError(true);
      setActionMessage(reason instanceof Error ? reason.message : "Publication impossible.");
    } finally {
      setBusy("");
    }
  };

  const unpublish = async (item: Item) => {
    setBusy(item.id);
    setActionError(false);
    setActionMessage("");
    try {
      await request("/api/catalog/manage", { method: "DELETE", body: JSON.stringify({ id: item.id }) });
      if (await refresh()) setActionMessage("Fiche retirée du catalogue partagé.");
    } catch (reason) {
      setActionError(true);
      setActionMessage(reason instanceof Error ? reason.message : "Retrait impossible.");
    } finally {
      setBusy("");
    }
  };

  const deletePermanently = async (item: Item) => {
    setBusy(item.id);
    setActionError(false);
    setActionMessage("");
    try {
      await request("/api/catalog/manage", { method: "DELETE", body: JSON.stringify({ id: item.id, permanent: true }) });
      setEditing(null);
      if (await refresh()) setActionMessage(`« ${item.title} » et ses données associées ont été supprimés définitivement.`);
    } catch (reason) {
      setActionError(true);
      setActionMessage(reason instanceof Error ? reason.message : "Suppression définitive impossible.");
    } finally {
      setBusy("");
      setPendingConfirmation(null);
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation) return;
    const { item, permanent } = pendingConfirmation;
    if (permanent) await deletePermanently(item);
    else await unpublish(item);
  };

  return (
    <section className={`admin-shared-catalog ${kindFilter === "video" ? "is-video-library" : ""} ${isMediaMode ? "is-media-inventory" : ""}`.trim()} aria-labelledby={headingId}>
      <header className="admin-shared-header">
        <div className="admin-shared-heading">
          <div className="eyebrow">{isMediaMode ? "MÉDIATHÈQUE · D1" : "CATALOGUE PARTAGÉ · D1"}</div>
          <h3 id={headingId}>{isMediaMode ? "Inventaire des médias" : `Fiches ${kindPlural}`} <span className="admin-source-badge is-d1">D1</span></h3>
          <p>{isMediaMode ? "Affiches, fonds et miniatures d’épisodes enregistrés dans D1. Aucun fichier de ce navigateur n’est lu." : "Source distante, visible par tous les utilisateurs. Les droits sont vérifiés côté serveur."}</p>
        </div>
        {authState === "authenticated" && (
          <button type="button" className="admin-shared-refresh" onClick={() => void refresh()} disabled={loading}>
            {loading ? <LoaderCircle size={14} className="admin-spin" /> : <RefreshCw size={14} />}
            Actualiser
          </button>
        )}
      </header>

      <AdminSessionPanel
        authState={authState}
        onLogin={login}
        onLogout={() => void logout()}
        description={isMediaMode ? "L’inventaire des médias D1 est protégé côté serveur. Connecte-toi avec ton compte Discord administrateur pour le charger." : "Le catalogue partagé est protégé côté serveur. Connecte-toi avec ton compte Discord administrateur pour charger et gérer les fiches D1."}
        status={
          isMediaMode
            ? <>{mediaEntries.length} média{mediaEntries.length === 1 ? "" : "s"} · {items.length} fiche{items.length === 1 ? "" : "s"}</>
            : <>{publishedCount} publié{publishedCount === 1 ? "" : "s"} · {kindItems.length} {kindLabel}{kindItems.length === 1 ? "" : "s"}</>
        }
        className="admin-shared-session"
      />

      {authState === "authenticated" && (
        <div className="admin-shared-toolbar" role="group" aria-label={isMediaMode ? "Recherche et tri des médias D1" : `Recherche, filtres et tri des ${kindPlural} partagés`}>
          <label className="admin-shared-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={isMediaMode ? "Rechercher un média…" : "Rechercher une fiche…"}
              aria-label={isMediaMode ? "Rechercher dans les médias D1" : "Rechercher dans le catalogue partagé"}
            />
          </label>
          {!isMediaMode && (
            <label>
              <span>Statut</span>
              <select aria-label="Filtrer le catalogue partagé par statut" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">Tous les statuts</option>
                <option value="published">Publiés</option>
                <option value="hidden">Masqués</option>
              </select>
            </label>
          )}
          <label>
            <span>Trier</span>
            <select aria-label={isMediaMode ? "Trier les médias D1" : "Trier le catalogue partagé"} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="updated">Mise à jour récente</option>
              <option value="title">Titre A à Z</option>
              {!isMediaMode && (
                <>
                  <option value="year-desc">Année décroissante</option>
                  <option value="year-asc">Année croissante</option>
                  <option value="episodes">Nombre d’épisodes</option>
                  <option value="duration">Durée décroissante</option>
                </>
              )}
            </select>
          </label>
          {(isMediaMode ? mediaFiltersActive : filtersActive) && (
            <button type="button" className="admin-shared-reset" onClick={() => { setQuery(""); setStatusFilter("all"); setSortMode("updated"); }}>
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {pendingConfirmation && (
        <div className="cinebox-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingConfirmation(null); }}>
          <section className="cinebox-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cinebox-confirm-title" aria-describedby="cinebox-confirm-description">
            <div className="cinebox-confirm-icon"><Trash2 size={20} /></div>
            <span className="eyebrow">GESTION DU CATALOGUE</span>
            <h3 id="cinebox-confirm-title">{pendingConfirmation.permanent ? "Supprimer définitivement ?" : "Retirer du catalogue ?"}</h3>
            <p id="cinebox-confirm-description">
              <strong>{pendingConfirmation.item.title}</strong>
              {pendingConfirmation.permanent
                ? " sera supprimé avec ses épisodes, ses vidéos associées, ses favoris et son historique. Cette action est irréversible."
                : " sera masqué du catalogue public. La fiche et ses données seront conservées et pourront être republiées."}
            </p>
            <div className="cinebox-confirm-actions">
              <button type="button" onClick={() => setPendingConfirmation(null)}>Annuler</button>
              <button type="button" className="is-danger" onClick={() => void confirmPendingAction()} disabled={busy === pendingConfirmation.item.id}>
                {busy === pendingConfirmation.item.id ? <LoaderCircle size={14} className="admin-spin" /> : <Trash2 size={14} />}
                {pendingConfirmation.permanent ? "Supprimer définitivement" : "Retirer"}
              </button>
            </div>
          </section>
        </div>
      )}

      {actionMessage && <p role={actionError ? "alert" : "status"} className={`admin-shared-message ${actionError ? "is-error" : "is-success"}`}>{actionMessage}</p>}

      {loadError && (isMediaMode ? mediaEntries.length > 0 : kindItems.length > 0) && (
        <div className="admin-shared-load-error" role="alert">
          <ShieldAlert size={15} aria-hidden="true" />
          <div>
            <strong>Catalogue partagé indisponible</strong>
            <span>{loadError} Les données affichées peuvent être obsolètes.</span>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? <LoaderCircle size={13} className="admin-spin" /> : <RefreshCw size={13} />} Réessayer
          </button>
        </div>
      )}

      {authState === "authenticated" && (loading && !loadedOnce ? (
        <div className="admin-shared-skeletons" aria-label="Chargement du catalogue partagé">
          {[0, 1, 2].map((entry) => <div className="admin-shared-skeleton" key={entry}><i /><span><b /><b /><b /></span></div>)}
        </div>
      ) : loadError && !(isMediaMode ? mediaEntries.length : kindItems.length) ? (
        <div className="admin-shared-state is-error" role="alert">
          <Database size={22} aria-hidden="true" />
          <strong>Catalogue partagé indisponible</strong>
          <span>{loadError || "La requête D1 n'a pas abouti. Vérifie la session administrateur et réessaie."}</span>
          <button type="button" onClick={() => void refresh()}>Réessayer</button>
        </div>
      ) : !(isMediaMode ? mediaEntries.length : kindItems.length) ? (
        <div className="admin-shared-state">
          <Database size={22} aria-hidden="true" />
          <strong>{isMediaMode ? "Aucun média dans le catalogue partagé" : `Aucune fiche ${kindLabel} dans le catalogue partagé`}</strong>
          <span>{isMediaMode ? "Les fiches D1 ne contiennent encore aucune affiche, aucun fond ni aucune miniature d’épisode." : "Publie un contenu depuis l’onglet Médias pour le retrouver ici."}</span>
        </div>
      ) : !(isMediaMode ? visibleMedia.length : visibleItems.length) ? (
        <div className="admin-shared-state">
          <Search size={22} aria-hidden="true" />
          <strong>{isMediaMode ? "Aucun média ne correspond" : "Aucune fiche ne correspond"}</strong>
          <span>{isMediaMode ? "Modifie la recherche pour retrouver les médias D1." : `Modifie la recherche ou le filtre de statut pour retrouver les fiches ${kindPlural}.`}</span>
          <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setSortMode("updated"); }}>Effacer les filtres</button>
        </div>
      ) : isMediaMode ? (
        <div className="admin-shared-media-grid">
          {visibleMedia.map((entry) => (
            <article className="admin-shared-media-card" key={entry.key}>
              <div className="admin-shared-media-preview">
                <img src={tmdbImage(entry.path, entry.size)} alt={`${entry.label} de ${entry.item.title}`} loading="lazy" />
                <span className="admin-shared-media-label">{entry.label}</span>
              </div>
              <div className="admin-shared-media-body">
                <strong>{entry.item.title}</strong>
                <small>{kindLabels[entry.item.kind]} · {yearOf(entry.item) || "Année inconnue"}{entry.episode ? ` · ${entry.episode.title}` : ""}</small>
                <span className="admin-shared-media-path">{entry.path}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={`admin-shared-list ${kindFilter === "video" ? "is-video-library" : ""}`.trim()}>
          {visibleItems.map((item) => {
            const KindIcon = kindIcons[item.kind];
            const episodes = item.episodes || [];
            const totalEpisodes = episodeCount(item);
            const poster = item.kind === "video"
              ? tmdbImage(item.backdrop_path, "w300") || tmdbImage(item.poster_path, "w300")
              : tmdbImage(item.poster_path, "w185");
            const year = yearOf(item);
            const isPublished = Number(item.published) === 1;
            const isEditing = editing === item.id;
            return (
              <article className={`admin-shared-item ${item.kind === "video" ? "is-video" : ""} ${isEditing ? "is-editing" : ""}`} key={item.id}>
                <div className={`admin-shared-poster ${item.kind === "video" ? "is-wide" : ""}`}>
                  {poster ? <img src={poster} alt={`Affiche de ${item.title}`} loading="lazy" /> : <span aria-hidden="true"><Video size={19} /></span>}
                </div>

                <div className="admin-shared-body">
                  <div className="admin-shared-title-row">
                    <KindIcon size={14} aria-hidden="true" />
                    <strong>{item.title}</strong>
                    <span className={`admin-status-chip ${isPublished ? "is-published" : "is-hidden"}`}>{isPublished ? "Publié" : "Masqué"}</span>
                    <span className="admin-kind-chip">{kindLabels[item.kind]}</span>
                  </div>

                  <div className="admin-shared-meta-row">
                    <span>{year || "Année inconnue"}</span>
                    <span>{(item.genres || []).join(" · ") || "Genre non renseigné"}</span>
                    <span><Clock3 size={11} aria-hidden="true" /> {item.kind === "series" ? `${seasonCount(item)} saison${seasonCount(item) === 1 ? "" : "s"} · ${totalEpisodes} épisode${totalEpisodes === 1 ? "" : "s"}` : runtimeLabel(item)}</span>
                    <span>Mise à jour {updatedLabel(item.updated_at)}</span>
                  </div>

                  <p className="admin-shared-overview">{item.overview || "Synopsis non renseigné."}</p>

                  {item.kind === "series" && (
                    <div className="admin-shared-series">
                      {episodes.length > 0 && (
                        <details className="admin-shared-episodes">
                          <summary>Saisons &amp; épisodes <ChevronDown size={13} aria-hidden="true" /></summary>
                          <div className="admin-shared-episode-list">
                            {episodes.map((episode) => (
                              <div className="admin-shared-episode" key={episode.id}>
                                <span className="admin-episode-code">S{episode.season_number} E{episode.episode_number}</span>
                                <span className="admin-episode-name">{episode.title}</span>
                                <span className="admin-episode-duration">{formatDuration(episode.duration_seconds)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {item.kind === "video" && (
                    <div className="admin-shared-video-meta">
                      <span><Clock3 size={11} aria-hidden="true" /> {runtimeLabel(item)}</span>
                    </div>
                  )}

                  <div className="admin-shared-actions">
                    <button type="button" className={isEditing ? "is-active" : ""} onClick={() => { setEditing(isEditing ? null : item.id); setDraftTitle(item.title); setDraftOverview(item.overview); setDraftVipExclusive(Boolean(item.vip_exclusive)); setDraftVipEarlyAccess(Boolean(item.vip_early_access)); setDraftPublicAt(item.public_at ? new Date(item.public_at).toISOString().slice(0,16) : ""); }}>
                      <Edit3 size={13} /> {isEditing ? "Fermer" : "Modifier"}
                    </button>
                    {isPublished
                      ? <button type="button" onClick={() => setPendingConfirmation({ item, permanent: false })} disabled={busy === item.id}><EyeOff size={13} /> Retirer</button>
                      : <button type="button" onClick={() => void republish(item)} disabled={busy === item.id}><Check size={13} /> Republier</button>}
                    <button type="button" className="admin-shared-delete" onClick={() => setPendingConfirmation({ item, permanent: true })} disabled={busy === item.id} title="Supprimer définitivement ce titre et ses données associées"><Trash2 size={13} /> Supprimer définitivement</button>
                    <span className="admin-shared-source"><HardDrive size={12} aria-hidden="true" /> D1 · {item.id.slice(0, 14)}{item.id.length > 14 ? "…" : ""}</span>
                  </div>

                  {isEditing && (
                    <div className="admin-shared-editor">
                      <label><span>Titre</span><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="Titre" maxLength={300} /></label>
                      <label><span>Synopsis</span><textarea value={draftOverview} onChange={(event) => setDraftOverview(event.target.value)} aria-label="Synopsis" rows={4} maxLength={12000} /></label>
                      <fieldset className="admin-vip-access-fields"><legend>Accès VIP CinéBox</legend>
                        <label><input type="checkbox" checked={draftVipExclusive} onChange={(event) => { setDraftVipExclusive(event.target.checked); if (event.target.checked) setDraftVipEarlyAccess(false); }} /> Réserver ce titre aux membres VIP</label>
                        <label><input type="checkbox" checked={draftVipEarlyAccess} disabled={draftVipExclusive} onChange={(event) => { setDraftVipEarlyAccess(event.target.checked); if (event.target.checked) setDraftVipExclusive(false); }} /> Avant-première VIP (48 h)</label>
                        <label><span>Date et heure d’ouverture au public</span><input type="datetime-local" value={draftPublicAt} onChange={(event) => setDraftPublicAt(event.target.value)} disabled={!draftVipEarlyAccess} /></label>
                        <small>Les VIP peuvent voir le titre 48 h avant cette date. Les autres comptes le verront à la date indiquée.</small>
                      </fieldset>
                      <div>
                        <button type="button" className="is-primary" disabled={busy === item.id || !draftTitle.trim()} onClick={() => void save(item)}>
                          {busy === item.id ? <LoaderCircle size={13} className="admin-spin" /> : <Save size={13} />} Enregistrer les modifications
                        </button>
                        <button type="button" onClick={() => setEditing(null)}>Annuler</button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
