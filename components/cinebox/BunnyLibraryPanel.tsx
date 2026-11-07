"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Film, LoaderCircle, Play, RefreshCw, ShieldCheck, UploadCloud, Video, X } from "lucide-react";

type BunnyVideo = { id: string; title: string; durationSeconds: number | null; thumbnailUrl: string | null };
type BunnyList = { libraryId: string; total: number; videos: BunnyVideo[] };
type CatalogItem = { id: string; title: string; kind: string };
type Ticket = { libraryId: string; videoId: string; endpoint: string; signature: string; expires: number; title: string };

const b64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
};
const prettySize = (bytes: number) => bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} Mo` : `${(bytes / 1024 ** 3).toFixed(2)} Go`;
const kindLabel = (kind: string) => kind === "movie" || kind === "Film" ? "Film" : kind === "series" || kind === "Série" ? "Série" : "Vidéo";

async function tusUpload(file: File, ticket: Ticket, onProgress: (value: number) => void) {
  const headers = {
    AuthorizationSignature: ticket.signature, AuthorizationExpire: String(ticket.expires),
    LibraryId: ticket.libraryId, VideoId: ticket.videoId, "Tus-Resumable": "1.0.0",
    "Upload-Length": String(file.size),
    "Upload-Metadata": `filetype ${b64(file.type || "application/octet-stream")},title ${b64(ticket.title)}`,
  };
  const init = await fetch(ticket.endpoint, { method: "POST", headers });
  if (!init.ok) throw new Error("Bunny a refusé de démarrer l'envoi.");
  const location = init.headers.get("Location");
  if (!location) throw new Error("Adresse de transfert absente dans la réponse Bunny.");
  const url = new URL(location, ticket.endpoint).toString();
  let offset = Number(init.headers.get("Upload-Offset") || 0);
  const chunkSize = 8 * 1024 * 1024;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        AuthorizationSignature: ticket.signature, AuthorizationExpire: String(ticket.expires),
        LibraryId: ticket.libraryId, VideoId: ticket.videoId, "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream",
      },
      body: file.slice(offset, end),
    });
    if (!response.ok) throw new Error("L'envoi a été interrompu. Vérifie ta connexion puis relance l'import.");
    const next = Number(response.headers.get("Upload-Offset") || end);
    if (next <= offset) throw new Error("Bunny n'a pas confirmé la progression.");
    offset = next;
    onProgress(Math.round(offset / file.size * 100));
  }
}

export function BunnyLibraryPanel() {
  const [data, setData] = useState<BunnyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<BunnyVideo | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [token, setToken] = useState("");
  const [titleId, setTitleId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/bunny/videos", { cache: "no-store" });
      const payload = await response.json() as BunnyList | { error?: string };
      if (!response.ok || !("videos" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "Bibliothèque Bunny indisponible.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur inconnue.");
    } finally { setLoading(false); }
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/catalog?limit=50", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { titles?: CatalogItem[] };
      if (Array.isArray(payload.titles)) setCatalog(payload.titles);
    } catch { /* catalogue réessayé au prochain rafraîchissement */ }
  }, []);

  useEffect(() => { void refresh(); void refreshCatalog(); }, [refresh, refreshCatalog]);
  useEffect(() => {
    if (token.length >= 32) window.sessionStorage.setItem("cinebox-admin-token", token);
    else window.sessionStorage.removeItem("cinebox-admin-token");
  }, [token]);

  const upload = async () => {
    if (!file || !titleId || token.length < 32) return;
    setUploading(true); setProgress(0); setMessage("");
    try {
      const ticketResponse = await fetch("/api/bunny/upload-ticket", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ title: catalog.find(item => item.id === titleId)?.title || file.name, fileName: file.name, fileSize: file.size, titleId }),
      });
      const ticket = await ticketResponse.json() as Ticket | { error?: string };
      if (!ticketResponse.ok || !("videoId" in ticket)) throw new Error("error" in ticket && ticket.error ? ticket.error : "Préparation de l'envoi impossible.");
      await tusUpload(file, ticket, setProgress);
      const completeResponse = await fetch("/api/bunny/upload-complete", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ videoId: ticket.videoId, titleId }),
      });
      const complete = await completeResponse.json() as { error?: string; linked?: boolean };
      if (!completeResponse.ok || !complete.linked) throw new Error(complete.error || "Vidéo envoyée mais association impossible.");
      setMessage("Votre vidéo est envoyée et associée au titre.");
      setFile(null);
      const input = document.getElementById("bunny-video-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "L'envoi a échoué.");
    } finally { setUploading(false); }
  };

  const inputStyle: CSSProperties = {
    width: "100%", minHeight: 46, borderRadius: 10, padding: "0 14px",
    border: "1px solid rgba(220,195,146,.19)", background: "#0b0c0f",
    color: "#f5f1e9", outline: "none", font: "inherit", fontSize: 13,
  };
  const labelStyle: CSSProperties = { display: "block", color: "#b6b0a4", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 };

  return (
    <section aria-labelledby="bunny-library-title" style={{ marginTop: 26, border: "1px solid rgba(220,195,146,.18)", borderRadius: 18, overflow: "hidden", background: "linear-gradient(145deg,rgba(24,23,21,.98),rgba(13,14,17,.98))", boxShadow: "0 18px 55px rgba(0,0,0,.18)" }}>
      <header style={{ padding: "22px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, borderBottom: "1px solid rgba(255,255,255,.07)", background: "radial-gradient(ellipse at 10% 0%,rgba(202,166,103,.10),transparent 55%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", borderRadius: 13, color: "#d9bb82", background: "rgba(213,180,122,.11)", border: "1px solid rgba(213,180,122,.18)" }}><Video size={20}/></div>
          <div>
            <span style={{ display: "block", color: "#c6a66e", fontSize: 9, letterSpacing: ".2em", fontWeight: 800, marginBottom: 5 }}>ESPACE DE DIFFUSION</span>
            <h3 id="bunny-library-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f4f0e8" }}>Bunny Stream <span style={{ color: "#c9a86e", fontWeight: 400 }}>· CinéBox</span></h3>
            <p style={{ margin: "5px 0 0", color: "#888b92", fontSize: 11 }}>Vos fichiers vidéo, prêts à être diffusés dans votre cinéma.</p>
          </div>
        </div>
        <button type="button" onClick={() => { void refresh(); void refreshCatalog(); }} disabled={loading} aria-label="Actualiser les vidéos" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 9, border: "1px solid rgba(213,180,122,.2)", background: "rgba(213,180,122,.06)", color: "#d9bb82", fontSize: 11, cursor: "pointer" }}>
          {loading ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Actualiser
        </button>
      </header>

      <div style={{ padding: 22 }}>
        {error && <div role="alert" style={{ padding: 12, borderRadius: 10, color: "#ffb5a8", background: "rgba(180,65,50,.10)", border: "1px solid rgba(180,65,50,.24)", fontSize: 12, marginBottom: 16 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 20 }}>
          <div style={{ padding: "15px 16px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}>
            <span style={{ color: "#888b92", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>Vidéos hébergées</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5 }}><strong style={{ color: "#f3eee4", fontSize: 25 }}>{data?.total ?? "—"}</strong><span style={{ color: "#92949a", fontSize: 11 }}>dans Bunny Stream</span></div>
          </div>
          <div style={{ padding: "15px 16px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}>
            <span style={{ color: "#888b92", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>Bibliothèque</span>
            <div style={{ color: "#f3eee4", fontSize: 17, fontWeight: 700, marginTop: 9 }}>{data?.libraryId ?? "Connexion…"}</div>
          </div>
          <div style={{ padding: "15px 16px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}>
            <span style={{ color: "#888b92", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>Catalogue partagé</span>
            <div style={{ color: "#f3eee4", fontSize: 17, fontWeight: 700, marginTop: 9 }}>{catalog.length} titre{catalog.length === 1 ? "" : "s"} publié{catalog.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(280px,.9fr)", gap: 18 }}>
          <div style={{ padding: 20, borderRadius: 14, border: "1px solid rgba(213,180,122,.2)", background: "linear-gradient(145deg,rgba(213,180,122,.075),rgba(255,255,255,.018))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}><div style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 10, background: "rgba(213,180,122,.13)", color: "#d9bb82" }}><UploadCloud size={17}/></div><div><h4 style={{ margin: 0, color: "#f3eee4", fontSize: 14 }}>Ajouter une vidéo</h4><span style={{ color: "#8f9197", fontSize: 10 }}>Import direct vers votre bibliothèque</span></div></div>
            <p style={{ color: "#96979d", fontSize: 11, lineHeight: 1.6, margin: "12px 0 18px" }}>Associez un fichier vidéo à une fiche du catalogue. L'envoi est effectué directement vers Bunny, sans transiter par votre navigateur serveur.</p>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="bunny-admin-token" style={labelStyle}>Code administrateur temporaire</label>
              <input id="bunny-admin-token" name="cinebox-temporary-admin-code" type="password" autoComplete="new-password" autoCorrect="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="Saisis ton code administrateur" style={inputStyle}/>
              <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7, color: "#85878e", fontSize: 10 }}><ShieldCheck size={12} color="#bda06b"/> Vérifié côté serveur · jamais enregistré dans le catalogue</span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="bunny-title-select" style={labelStyle}>Titre à associer</label>
              <select id="bunny-title-select" value={titleId} onChange={event => setTitleId(event.target.value)} style={{ ...inputStyle, color: titleId ? "#f5f1e9" : "#85878e" }}>
                <option value="">Choisir un titre publié…</option>
                {catalog.map(item => <option key={item.id} value={item.id}>{item.title} · {kindLabel(item.kind)}</option>)}
              </select>
              {catalog.length === 0 && <div style={{ marginTop: 7 }}><p style={{ color: "#d4b77f", fontSize: 10, lineHeight: 1.5, margin: "0 0 7px" }}>Aucun titre publié pour le moment. Ce menu ne permet pas de saisir un titre : il faut d’abord publier une fiche dans le catalogue partagé.</p><button type="button" onClick={() => void refreshCatalog()} style={{ border: "1px solid rgba(213,180,122,.25)", borderRadius: 7, padding: "6px 9px", background: "rgba(213,180,122,.07)", color: "#d9bb82", fontSize: 10, cursor: "pointer" }}>Actualiser le catalogue partagé</button></div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="bunny-video-file" style={labelStyle}>Fichier vidéo <span style={{ color: "#777b82", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· 5 Go maximum</span></label>
              <label htmlFor="bunny-video-file" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "10px 12px", border: "1px dashed rgba(213,180,122,.35)", borderRadius: 10, background: "rgba(0,0,0,.16)", cursor: "pointer" }}>
                <div style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 9, background: "rgba(213,180,122,.12)", color: "#d9bb82", flexShrink: 0 }}><Video size={16}/></div>
                <div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: file ? "#f2eee6" : "#a5a5a8", fontSize: 11 }}>{file?.name || "Choisir un fichier vidéo"}</strong><span style={{ color: "#777b82", fontSize: 10 }}>{file ? prettySize(file.size) : "MP4, WebM, MOV… · Cliquez pour parcourir"}</span></div>
                <span style={{ color: "#d9bb82", fontSize: 10, fontWeight: 700 }}>Parcourir</span>
              </label>
              <input id="bunny-video-file" type="file" accept="video/*,.mkv,.avi,.mov" disabled={uploading} onChange={event => setFile(event.target.files?.[0] || null)} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}/>
            </div>

            {uploading && <div style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", fontSize: 10, marginBottom: 7 }}><span>Transfert en cours</span><strong style={{ color: "#d9bb82" }}>{progress}%</strong></div><div style={{ height: 6, background: "rgba(255,255,255,.08)", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: progress + "%", background: "linear-gradient(90deg,#a9854d,#e7cb91)", borderRadius: 99, transition: "width .2s" }}/></div></div>}
            {message && <p role="status" style={{ padding: 10, borderRadius: 9, background: "rgba(115,153,112,.10)", color: "#b8d5ae", fontSize: 11, lineHeight: 1.5 }}>{message}</p>}
            <button type="button" disabled={uploading || !file || !titleId || token.length < 32} onClick={() => void upload()} style={{ width: "100%", minHeight: 46, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, border: "1px solid rgba(235,211,166,.35)", borderRadius: 10, background: uploading || !file || !titleId || token.length < 32 ? "rgba(213,180,122,.12)" : "linear-gradient(110deg,#c6a36b,#e2c38b)", color: uploading || !file || !titleId || token.length < 32 ? "#8d816d" : "#17130d", fontSize: 11, fontWeight: 800, cursor: uploading || !file || !titleId || token.length < 32 ? "not-allowed" : "pointer" }}>
              {uploading ? <><LoaderCircle size={15}/> Envoi en cours · {progress}%</> : <><UploadCloud size={15}/> Envoyer vers Bunny Stream</>}
            </button>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}><div><h4 style={{ margin: 0, color: "#f3eee4", fontSize: 13 }}>Vidéos hébergées</h4><p style={{ margin: "4px 0 0", color: "#85878e", fontSize: 10 }}>Contenus présents dans votre bibliothèque Bunny</p></div><span style={{ padding: "5px 8px", borderRadius: 99, background: "rgba(213,180,122,.10)", color: "#d9bb82", fontSize: 10 }}>{data?.videos.length ?? 0} fichier(s)</span></div>
            {loading && !data ? <div style={{ minHeight: 220, display: "grid", placeItems: "center", color: "#999", fontSize: 11 }}><LoaderCircle size={18} className="animate-spin"/></div> : data?.videos.length ? <div style={{ display: "grid", gap: 9, maxHeight: 430, overflowY: "auto", paddingRight: 3 }}>{data.videos.map(video => <article key={video.id} style={{ display: "flex", gap: 11, alignItems: "center", padding: 9, border: "1px solid rgba(255,255,255,.07)", borderRadius: 11, background: "rgba(255,255,255,.025)" }}><div style={{ width: 92, aspectRatio: "16/9", borderRadius: 7, overflow: "hidden", background: "#090a0c", flexShrink: 0 }}>{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#b99c68" }}><Video size={19}/></div>}</div><div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e9e4da", fontSize: 11 }}>{video.title}</strong><span style={{ color: "#81848b", fontSize: 9 }}>ID · {video.id.slice(0, 9)}…</span></div><button type="button" onClick={() => setPlaying(video)} aria-label={"Prévisualiser " + video.title} style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, border: "1px solid rgba(213,180,122,.22)", background: "rgba(213,180,122,.08)", color: "#d9bb82", cursor: "pointer" }}><Play size={14}/></button></article>)}</div> : <div style={{ minHeight: 230, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: 22, border: "1px dashed rgba(255,255,255,.10)", borderRadius: 12, background: "rgba(255,255,255,.015)" }}><div style={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 15, background: "rgba(213,180,122,.09)", color: "#c5a56d", marginBottom: 13 }}><Video size={21}/></div><strong style={{ color: "#e8e2d7", fontSize: 12 }}>Votre vidéothèque est vide</strong><span style={{ maxWidth: 230, color: "#85878e", fontSize: 10, lineHeight: 1.6, marginTop: 6 }}>Importez votre premier épisode ou film : il apparaîtra ici après traitement.</span></div>}
          </div>
        </div>
      </div>

      {playing && data && <div role="dialog" aria-modal="true" aria-label={"Lecture de " + playing.title} onClick={event => { if (event.target === event.currentTarget) setPlaying(null); }} style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 20, background: "rgba(0,0,0,.9)", backdropFilter: "blur(8px)" }}><div style={{ width: "min(100%,1050px)", overflow: "hidden", border: "1px solid rgba(213,180,122,.25)", borderRadius: 15, background: "#101114", boxShadow: "0 25px 90px rgba(0,0,0,.6)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", color: "#eee8dd" }}><strong style={{ fontSize: 13 }}>{playing.title}</strong><button type="button" onClick={() => setPlaying(null)} aria-label="Fermer le lecteur" style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.05)", color: "#ddd" }}><X size={16}/></button></div><div style={{ aspectRatio: "16/9" }}><iframe title={"Lecture " + playing.title} src={"https://iframe.mediadelivery.net/embed/" + data.libraryId + "/" + playing.id} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }}/></div></div></div>}
    </section>
  );
}
