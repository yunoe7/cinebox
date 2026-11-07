"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Film, LoaderCircle, Play, RefreshCw, Video } from "lucide-react";

type BunnyVideo = {
  id: string;
  title: string;
  status: number | null;
  durationSeconds: number | null;
  uploadedAt: string | null;
  thumbnailUrl: string | null;
  availableResolutions: string | null;
};

type BunnyList = { libraryId: string; total: number; videos: BunnyVideo[] };

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "Durée en préparation";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours} h ${minutes.toString().padStart(2, "0")} min` : `${minutes} min ${rest.toString().padStart(2, "0")} s`;
}

export function BunnyLibraryPanel() {
  const [data, setData] = useState<BunnyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<BunnyVideo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bunny/videos", { cache: "no-store", headers: { accept: "application/json" } });
      const payload = await response.json() as BunnyList | { error?: string };
      if (!response.ok || !("videos" in payload) || !Array.isArray(payload.videos)) {
        throw new Error("error" in payload && payload.error ? payload.error : "La liste Bunny est indisponible.");
      }
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="admin-panel" aria-labelledby="bunny-library-title" style={{ marginTop: 24, padding: 22 }}>
      <div className="admin-panel-heading" style={{ alignItems: "center" }}>
        <div>
          <span className="eyebrow">STOCKAGE VIDÉO CONNECTÉ</span>
          <h3 id="bunny-library-title"><Video size={17} style={{ verticalAlign: "middle", marginRight: 8 }}/>Bunny Stream · CinéBox</h3>
        </div>
        <button type="button" className="admin-media-edit" onClick={() => void refresh()} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Actualiser
        </button>
      </div>
      <p className="subtle" style={{ margin: "8px 0 16px", lineHeight: 1.6 }}>
        Les vidéos de cette bibliothèque sont stockées chez Bunny et pourront être associées au catalogue partagé CinéBox.
      </p>
      {loading && !data ? <p className="subtle">Chargement de la bibliothèque vidéo…</p> : null}
      {error ? <p role="alert" className="subtle">{error}</p> : null}
      {data && (
        <>
          <div className="admin-media-summary" style={{ marginBottom: 16 }}>
            <div><Film size={17}/><span><strong>{data.total}</strong> vidéo{data.total === 1 ? "" : "s"} dans Bunny Stream</span></div>
            <div><span className="subtle">Bibliothèque</span><strong>{data.libraryId}</strong></div>
          </div>
          {data.videos.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
              {data.videos.map((video) => (
                <article key={video.id} style={{ minWidth: 0, overflow: "hidden", border: "1px solid rgba(220,195,146,.14)", borderRadius: 9, background: "rgba(255,255,255,.025)" }}>
                  <div style={{ aspectRatio: "16 / 9", background: "#090a0c", overflow: "hidden" }}>
                    {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : <div style={{ height: "100%", display: "grid", placeItems: "center" }}><Video size={26}/></div>}
                  </div>
                  <div style={{ padding: 12 }}>
                    <strong style={{ display: "block", overflowWrap: "anywhere" }}>{video.title}</strong>
                    <small className="subtle">{formatDuration(video.durationSeconds)}{video.availableResolutions ? ` · ${video.availableResolutions}` : ""}</small>
                    <button type="button" className="admin-media-edit" style={{ marginTop: 10 }} onClick={() => setPlaying(video)}><Play size={13}/> Prévisualiser</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="admin-empty-panel"><Video size={24}/><strong>Aucune vidéo dans Bunny Stream</strong><span>La bibliothèque est connectée. Ajoutez une première vidéo depuis Bunny Stream ; elle apparaîtra ici après actualisation.</span></div>}
          {playing && (
            <div role="dialog" aria-modal="true" aria-label={`Lecture de ${playing.title}`} style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 20, background: "rgba(0,0,0,.88)" }} onClick={(event) => { if (event.target === event.currentTarget) setPlaying(null); }}>
              <div style={{ width: "min(100%, 1050px)", background: "#111", border: "1px solid rgba(220,195,146,.2)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12 }}>
                  <strong>{playing.title}</strong>
                  <button type="button" className="admin-media-edit" onClick={() => setPlaying(null)}>Fermer</button>
                </div>
                <div style={{ aspectRatio: "16 / 9", background: "#000" }}>
                  <iframe title={`Lecteur de ${playing.title}`} src={`https://iframe.mediadelivery.net/embed/${data.libraryId}/${playing.id}`} loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }}/>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
