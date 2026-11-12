"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
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

export function SharedCatalogManager({ kindFilter }: { kindFilter?: "movie" | "series" | "video" }) {
  const headingId = useId();
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");

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
    setPassword("");
    setItems([]);
    setLoadedOnce(false);
    setLoadError("");
    setActionMessage("");
    setActionError(false);
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loggingIn || password.length === 0) return;
    setLoggingIn(true);
    setActionError(false);
    setActionMessage("");
    try {
      await loginAdmin(password);
      setPassword("");
      setAuthState("authenticated");
    } catch (reason) {
      setActionError(true);
      setActionMessage(reason instanceof Error ? reason.message : "Connexion administrateur impossible.");
    } finally {
      setLoggingIn(false);
    }
  };

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

  const save = async (item: Item) => {
    setBusy(item.id);
    setActionError(false);
    setActionMessage("");
    try {
      await request("/api/catalog/manage", { method: "PATCH", body: JSON.stringify({ id: item.id, title: draftTitle, overview: draftOverview }) });
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
    if (!window.confirm(`Retirer « ${item.title} » du catalogue partagé ? La fiche sera masquée.`)) return;
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

  return (
    <section className={`admin-shared-catalog ${kindFilter === "video" ? "is-video-library" : ""}`} aria-labelledby={headingId}>
      <header className="admin-shared-header">
        <div className="admin-shared-heading">
          <div className="eyebrow">CATALOGUE PARTAGÉ · D1</div>
          <h3 id={headingId}>Fiches {kindPlural} <span className="admin-source-badge is-d1">D1</span></h3>
          <p>Source distante, visible par tous les utilisateurs. Les droits sont vérifiés côté serveur.</p>
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
        password={password}
        loggingIn={loggingIn}
        onPasswordChange={setPassword}
        onLogin={login}
        onLogout={() => void logout()}
        description="Le catalogue partagé est protégé côté serveur. Saisis le mot de passe administrateur pour charger et gérer les fiches D1."
        status={
          <>
            {publishedCount} publié{publishedCount === 1 ? "" : "s"} · {kindItems.length} {kindLabel}{kindItems.length === 1 ? "" : "s"}
          </>
        }
        className="admin-shared-session"
      />

      {authState === "authenticated" && (
        <div className="admin-shared-toolbar" role="group" aria-label={`Recherche, filtres et tri des ${kindPlural} partagés`}>
          <label className="admin-shared-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher une fiche…"
              aria-label="Rechercher dans le catalogue partagé"
            />
          </label>
          <label>
            <span>Statut</span>
            <select aria-label="Filtrer le catalogue partagé par statut" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">Tous les statuts</option>
              <option value="published">Publiés</option>
              <option value="hidden">Masqués</option>
            </select>
          </label>
          <label>
            <span>Trier</span>
            <select aria-label="Trier le catalogue partagé" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="updated">Mise à jour récente</option>
              <option value="title">Titre A à Z</option>
              <option value="year-desc">Année décroissante</option>
              <option value="year-asc">Année croissante</option>
              <option value="episodes">Nombre d’épisodes</option>
              <option value="duration">Durée décroissante</option>
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="admin-shared-reset" onClick={() => { setQuery(""); setStatusFilter("all"); setSortMode("updated"); }}>
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {actionMessage && <p role={actionError ? "alert" : "status"} className={`admin-shared-message ${actionError ? "is-error" : "is-success"}`}>{actionMessage}</p>}

      {loadError && kindItems.length > 0 && (
        <div className="admin-shared-load-error" role="alert">
          <ShieldAlert size={15} aria-hidden="true" />
          <div>
            <strong>Catalogue partagé indisponible</strong>
            <span>{loadError} Les fiches affichées peuvent être obsolètes.</span>
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
      ) : loadError && !kindItems.length ? (
        <div className="admin-shared-state is-error" role="alert">
          <Database size={22} aria-hidden="true" />
          <strong>Catalogue partagé indisponible</strong>
          <span>{loadError || "La requête D1 n'a pas abouti. Vérifie la session administrateur et réessaie."}</span>
          <button type="button" onClick={() => void refresh()}>Réessayer</button>
        </div>
      ) : !kindItems.length ? (
        <div className="admin-shared-state">
          <Database size={22} aria-hidden="true" />
          <strong>Aucune fiche {kindLabel} dans le catalogue partagé</strong>
          <span>Publie un contenu depuis l’onglet Médias pour le retrouver ici.</span>
        </div>
      ) : !visibleItems.length ? (
        <div className="admin-shared-state">
          <Search size={22} aria-hidden="true" />
          <strong>Aucune fiche ne correspond</strong>
          <span>Modifie la recherche ou le filtre de statut pour retrouver les fiches {kindPlural}.</span>
          <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setSortMode("updated"); }}>Effacer les filtres</button>
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
                    <button type="button" className={isEditing ? "is-active" : ""} onClick={() => { setEditing(isEditing ? null : item.id); setDraftTitle(item.title); setDraftOverview(item.overview); }}>
                      <Edit3 size={13} /> {isEditing ? "Fermer" : "Modifier"}
                    </button>
                    {isPublished
                      ? <button type="button" onClick={() => void unpublish(item)} disabled={busy === item.id}><EyeOff size={13} /> Retirer</button>
                      : <button type="button" onClick={() => void republish(item)} disabled={busy === item.id}><Check size={13} /> Republier</button>}
                    <span className="admin-shared-source"><HardDrive size={12} aria-hidden="true" /> D1 · {item.id.slice(0, 14)}{item.id.length > 14 ? "…" : ""}</span>
                  </div>

                  {isEditing && (
                    <div className="admin-shared-editor">
                      <label><span>Titre</span><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="Titre" maxLength={300} /></label>
                      <label><span>Synopsis</span><textarea value={draftOverview} onChange={(event) => setDraftOverview(event.target.value)} aria-label="Synopsis" rows={4} maxLength={12000} /></label>
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
