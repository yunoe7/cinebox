"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Link2, LoaderCircle } from "lucide-react";
import { adminJson, getAdminSession, isAdminAuthError } from "../../lib/cinebox/admin-session.mjs";
import { AdminSessionPanel, type AdminAuthState } from "./AdminSessionPanel";

type Target = { id: string; kind: "movie" | "series" | "video"; title: string; episodes?: Array<{ id: string; title: string; season_number: number; episode_number: number }> };
type Source = { id: string; title_id: string; episode_id: string | null; file_code: string; playback_url: string; encoding_status: string; uploaded_at: string | null; title?: string; episode_title?: string | null };
type RemoteFile = { file_code: string; file_title?: string; title?: string; status?: string; size?: string | number };

export function UqloadManager() {
  const [auth, setAuth] = useState<AdminAuthState>("checking");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [url, setUrl] = useState("");
  const [titleId, setTitleId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setMessage(""); setError(false);
    try {
      const data = await adminJson("/api/uqload", { cache: "no-store" }) as { configured: boolean; targets: Target[]; sources: Source[]; files: RemoteFile[] };
      setTargets(data.targets || []); setSources(data.sources || []); setRemoteFiles(data.files || []);
      if (!data.configured) { setMessage("La clé Uqload n’est pas disponible côté serveur. Vérifie le secret UQLOAD_API_KEY dans Cloudflare Pages."); setError(true); }
    } catch (e) {
      if (isAdminAuthError(e) && e.status === 401) setAuth("anonymous");
      setMessage(e instanceof Error ? e.message : "Chargement Uqload impossible."); setError(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void getAdminSession().then(s => setAuth(s.authenticated ? "authenticated" : "anonymous")); }, []);
  useEffect(() => { if (auth === "authenticated") void refresh(); }, [auth, refresh]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!password || loggingIn) return;
    setLoggingIn(true);
    try {
      const { loginAdmin } = await import("../../lib/cinebox/admin-session.mjs");
      await loginAdmin(password); setPassword(""); setAuth("authenticated");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Connexion impossible."); setError(true); }
    finally { setLoggingIn(false); }
  };

  const importUrl = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim() || !titleId || busy) return;
    setBusy(true); setMessage(""); setError(false);
    try {
      await adminJson("/api/uqload/import", { method: "POST", body: JSON.stringify({ url: url.trim(), titleId, episodeId: episodeId || null }) });
      setUrl(""); setEpisodeId(""); setMessage("Vidéo importée et associée au catalogue."); await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Import Uqload impossible."); setError(true); }
    finally { setBusy(false); }
  };

  const selectedTarget = targets.find(t => t.id === titleId);
  return <section className="admin-shared-catalog" aria-label="Gestion Uqload">
    <header className="admin-shared-header"><div className="admin-shared-heading"><div className="eyebrow">HÉBERGEMENT VIDÉO · UQLOAD</div><h3>Sources vidéo Uqload</h3><p>Importe une URL hébergée sur Uqload puis associe-la à un film ou à un épisode du catalogue D1.</p></div>
      {auth === "authenticated" && <button type="button" className="admin-shared-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/> Actualiser</button>}
    </header>
    <AdminSessionPanel authState={auth} password={password} loggingIn={loggingIn} onPasswordChange={setPassword} onLogin={login} onLogout={() => { setAuth("anonymous"); setSources([]); setTargets([]); setRemoteFiles([]); }} description="La gestion Uqload est protégée par la session administrateur." status={auth === "authenticated" ? `${sources.length} source(s) liée(s) · ${remoteFiles.length} fichier(s) Uqload` : "Connexion requise"} className="admin-shared-session"/>
    {auth === "authenticated" && <>
      <form onSubmit={importUrl} className="admin-shared-toolbar" style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) minmax(220px,1fr) minmax(180px,1fr) auto",gap:12,alignItems:"end"}}>
        <label><span>URL Uqload</span><input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://uqload.to/…"/></label>
        <label><span>Film ou série</span><select required value={titleId} onChange={e=>{setTitleId(e.target.value);setEpisodeId("");}}><option value="">Choisir un contenu…</option>{targets.map(t=><option key={t.id} value={t.id}>{t.kind==="series"?"Série":"Film"} · {t.title}</option>)}</select></label>
        <label><span>Épisode (facultatif)</span><select value={episodeId} onChange={e=>setEpisodeId(e.target.value)} disabled={!selectedTarget || selectedTarget.kind!=="series"}><option value="">Film / vidéo entière</option>{(selectedTarget?.episodes||[]).map(ep=><option key={ep.id} value={ep.id}>S{ep.season_number} E{ep.episode_number} · {ep.title}</option>)}</select></label>
        <button type="submit" className="admin-shared-refresh" disabled={busy || !titleId}>{busy?<LoaderCircle size={14} className="admin-spin"/>:<Link2 size={14}/>} Associer</button>
      </form>
      {message && <p role={error?"alert":"status"} className={`admin-shared-message ${error?"is-error":"is-success"}`}>{message}</p>}
      <div className="admin-shared-list">{sources.map(source=><article key={source.id} className="admin-shared-row"><div><strong>{source.title || source.title_id}</strong><p>{source.episode_title || "Vidéo principale"} · Code {source.file_code} · {source.encoding_status}</p></div><a href={source.playback_url} target="_blank" rel="noreferrer">Ouvrir la vidéo</a></article>)}{!sources.length&&!loading&&<p className="admin-shared-state">Aucune source Uqload associée pour le moment.</p>}</div>
      {remoteFiles.length>0 && <details className="admin-shared-list"><summary>Fichiers détectés dans le compte Uqload ({remoteFiles.length})</summary>{remoteFiles.map(file=><p key={file.file_code}>{file.file_title || file.title || "Sans titre"} · {file.file_code} · {file.status || "statut inconnu"}</p>)}</details>}
      <p className="local-note">Les clés Uqload restent côté serveur. L’import par URL demande à Uqload de récupérer une vidéo dont tu possèdes les droits de diffusion.</p>
    </>}
  </section>;
}
