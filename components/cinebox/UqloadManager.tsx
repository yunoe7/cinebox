"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Link2, LoaderCircle, Search } from "lucide-react";
import { adminJson, getAdminSession, isAdminAuthError, loginAdmin, logoutAdmin } from "../../lib/cinebox/admin-session.mjs";
import { AdminSessionPanel, type AdminAuthState } from "./AdminSessionPanel";

type Target = { id: string; kind: "movie" | "series" | "video"; title: string; published: number; episodes?: Array<{ id: string; title: string; season_number: number; episode_number: number }> };
type Source = { id: string; title_id: string; episode_id: string | null; file_code: string; playback_url: string; encoding_status: string; uploaded_at: string | null; title?: string; episode_title?: string | null };
type RemoteFile = { file_code: string; file_title?: string; title?: string; status?: string; size?: string | number };
type FileSelection = { titleId: string; episodeId: string };\ntype TmdbResult = { id: number; kind: "movie" | "series"; title: string; originalTitle: string; year: string; overview: string; posterPath: string | null };

export function UqloadManager() {
  const [auth, setAuth] = useState<AdminAuthState>("checking");
  const [targets, setTargets] = useState<Target[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [url, setUrl] = useState("");
  const [titleId, setTitleId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [fileSelections, setFileSelections] = useState<Record<string, FileSelection>>({});
  const [busy, setBusy] = useState(false);
  const [busyFile, setBusyFile] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);\n  const [tmdbFile, setTmdbFile] = useState<RemoteFile | null>(null);\n  const [tmdbQuery, setTmdbQuery] = useState("");\n  const [tmdbKind, setTmdbKind] = useState<"movie" | "series">("series");\n  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);\n  const [tmdbBusy, setTmdbBusy] = useState(false);

  const refresh = useCallback(async (preserveMessage = false) => {
    setLoading(true); if (!preserveMessage) { setMessage(""); setError(false); }
    try {
      const data = await adminJson("/api/uqload", { cache: "no-store" }) as { configured: boolean; targets: Target[]; sources: Source[]; files: RemoteFile[] };
      setTargets(data.targets || []); setSources(data.sources || []); setRemoteFiles(data.files || []);
      if (!data.configured) { setMessage("La clé Uqload n’est pas disponible côté serveur. Vérifie le secret UQLOAD_API_KEY dans Cloudflare Pages."); setError(true); }
    } catch (e) {
      if (isAdminAuthError(e) && e.status === 401) setAuth("anonymous");
      setMessage(e instanceof Error ? e.message : "Chargement Uqload impossible."); setError(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { let cancelled = false; void getAdminSession().then(s => { if (!cancelled) setAuth(s.authenticated ? "authenticated" : "anonymous"); }); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    if (auth !== "authenticated") return;
    let cancelled = false;
    let running = false;
    const synchronize = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const result = await adminJson("/api/uqload/sync", { method: "POST" }) as { scanned?: number; created?: number; skipped?: number; existing?: number; details?: Array<{file:string;status:string;reason?:string}> };
        if (!cancelled) {
          const details = (result.details || []).slice(0, 3).map(item => `${item.file} : ${item.reason || item.status}`).join(" · ");
          setMessage(`Synchronisation Uqload : ${Number(result.created || 0)} créé(s), ${Number(result.existing || 0)} déjà associé(s), ${Number(result.skipped || 0)} ignoré(s) sur ${Number(result.scanned || 0)} fichier(s).${details ? ` Détails : ${details}` : ""}`);
          setError(Number(result.skipped || 0) > 0 && Number(result.created || 0) === 0);
        }
      } catch (e) {
        if (!cancelled) {
          setMessage(e instanceof Error ? e.message : "Synchronisation automatique Uqload impossible.");
          setError(true);
        }
      } finally {
        if (!cancelled) await refresh(true);
        running = false;
      }
    };
    void synchronize();
    const timer = window.setInterval(() => { void synchronize(); }, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [auth, refresh]);

  const login = () => { void loginAdmin(); };

  const logout = async () => {
    await logoutAdmin();
    setAuth("anonymous"); setSources([]); setTargets([]); setRemoteFiles([]);
    setUrl(""); setTitleId(""); setEpisodeId(""); setFileSelections({}); setMessage(""); setError(false);
  };

  const importUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim() || !titleId || busy) return;
    setBusy(true); setMessage(""); setError(false);
    try {
      await adminJson("/api/uqload/import", { method: "POST", body: JSON.stringify({ url: url.trim(), titleId, episodeId: episodeId || null }) });
      setUrl(""); setEpisodeId(""); setMessage("Vidéo importée et associée au catalogue."); await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Import Uqload impossible."); setError(true); }
    finally { setBusy(false); }
  };

  const associateDetectedFile = async (file: RemoteFile) => {
    const selection = fileSelections[file.file_code];
    if (!selection?.titleId || busyFile) return;
    setBusyFile(file.file_code); setMessage(""); setError(false);
    try {
      await adminJson("/api/uqload/import", {
        method: "POST",
        body: JSON.stringify({ url: file.file_code, titleId: selection.titleId, episodeId: selection.episodeId || null }),
      });
      setMessage(`« ${file.file_title || file.title || file.file_code} » a été associée au catalogue.`);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Association du fichier Uqload impossible.");
      setError(true);
    } finally { setBusyFile(""); }
  };

  const openTmdbPicker = (file: RemoteFile) => {
    const raw = file.file_title || file.title || "";
    const ep = raw.match(/^(.*?)\\s*[._ -]+S(\\d{1,2})\\s*[._ -]*E(\\d{1,3})/i);
    setTmdbFile(file); setTmdbQuery((ep ? ep[1] : raw.replace(/[._-]+/g, " ")).trim()); setTmdbKind(ep ? "series" : "movie"); setTmdbResults([]);
  };
  const searchTmdb = async () => {
    if (!tmdbQuery.trim() || tmdbBusy) return;
    setTmdbBusy(true);
    try {
      const data = await adminJson("/api/uqload/tmdb-search", { method: "POST", body: JSON.stringify({ query: tmdbQuery.trim(), kind: tmdbKind }) }) as { results: TmdbResult[] };
      setTmdbResults(data.results || []);
      if (!data.results?.length) setMessage("Aucun résultat TMDB. Essaie le titre original ou un autre type.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Recherche TMDB impossible."); setError(true); }
    finally { setTmdbBusy(false); }
  };
  const chooseTmdb = async (result: TmdbResult) => {
    if (!tmdbFile || busyFile) return;
    setBusyFile(tmdbFile.file_code);
    try {
      const filename = tmdbFile.file_title || tmdbFile.title || "";
      const ep = filename.match(/\\bS(\\d{1,2})\\s*[._ -]*E(\\d{1,3})\\b/i);
      await adminJson("/api/uqload/tmdb-select", { method: "POST", body: JSON.stringify({ fileCode: tmdbFile.file_code, tmdbId: result.id, kind: result.kind, season: ep ? Number(ep[1]) : null, episode: ep ? Number(ep[2]) : null }) });
      setMessage(`« ${tmdbFile.file_title || tmdbFile.title || tmdbFile.file_code} » associé à ${result.title}.`);
      setTmdbFile(null); setTmdbResults([]); await refresh(true);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Association TMDB impossible."); setError(true); }
    finally { setBusyFile(""); }
  };

  const updateFileSelection = (code: string, patch: Partial<FileSelection>) => {
    setFileSelections(current => ({ ...current, [code]: { titleId: current[code]?.titleId || "", episodeId: current[code]?.episodeId || "", ...patch } }));
  };

  const selectedTarget = targets.find(t => t.id === titleId);
  return <section className="admin-shared-catalog" aria-label="Gestion Uqload">
    <header className="admin-shared-header"><div className="admin-shared-heading"><div className="eyebrow">HÉBERGEMENT VIDÉO · UQLOAD</div><h3>Sources vidéo Uqload</h3><p>Associe une vidéo détectée dans ton compte Uqload à un film, une série ou un épisode du catalogue D1.</p></div>
      {auth === "authenticated" && <button type="button" className="admin-shared-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/> Actualiser</button>}
    </header>
    <AdminSessionPanel authState={auth} onLogin={login} onLogout={() => void logout()} description="La gestion Uqload est protégée par la session administrateur." status={auth === "authenticated" ? `${sources.length} source(s) liée(s) · ${remoteFiles.length} fichier(s) Uqload` : "Connexion requise"} className="admin-shared-session"/>
    {message && <p role={error ? "alert" : "status"} className={`admin-shared-message ${error ? "is-error" : "is-success"}`}>{message}</p>}
    {auth === "authenticated" && <>
      <form onSubmit={importUrl} className="admin-shared-toolbar">
        <label><span>URL Uqload</span><input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://uqload.to/…"/></label>
        <label><span>Film ou série</span><select required value={titleId} onChange={e=>{setTitleId(e.target.value);setEpisodeId("");}}><option value="">Choisir un contenu…</option>{targets.map(t=><option key={t.id} value={t.id}>{t.kind==="series"?"Série":t.kind==="movie"?"Film":"Vidéo"} · {t.title}{Number(t.published)!==1?" (non publié)":""}</option>)}</select></label>
        <label><span>Épisode (facultatif)</span><select value={episodeId} onChange={e=>setEpisodeId(e.target.value)} disabled={!selectedTarget || selectedTarget.kind!=="series"}><option value="">Film / vidéo entière</option>{(selectedTarget?.episodes||[]).map(ep=><option key={ep.id} value={ep.id}>S{ep.season_number} E{ep.episode_number} · {ep.title}</option>)}</select></label>
        <button type="submit" className="admin-shared-refresh" disabled={busy || !titleId}>{busy?<LoaderCircle size={14} className="admin-spin"/>:<Link2 size={14}/>} Associer l’URL</button>
      </form>
      <div className="admin-shared-list">{sources.map(source=><article key={source.id} className="admin-shared-row"><div><strong>{source.title || source.title_id}</strong><p>{source.episode_title || "Vidéo principale"} · Code {source.file_code} · {source.encoding_status}</p></div><a href={source.playback_url} target="_blank" rel="noreferrer">Ouvrir la vidéo</a></article>)}{!sources.length&&!loading&&<p className="admin-shared-state">Aucune source Uqload associée pour le moment.</p>}</div>
      {remoteFiles.length>0 && <details className="admin-shared-list" open>
        <summary>Fichiers détectés dans le compte Uqload ({remoteFiles.length})</summary>
        <div className="admin-remote-files">{remoteFiles.map(file => {
          const selection = fileSelections[file.file_code] || { titleId: "", episodeId: "" };
          const target = targets.find(item => item.id === selection.titleId);
          const fileBusy = busyFile === file.file_code;
          return <article key={file.file_code} className="admin-shared-row admin-remote-file">
            <div className="admin-remote-file-info"><strong>{file.file_title || file.title || "Fichier sans titre"}</strong><p>Code {file.file_code} · {file.status || "statut inconnu"}{file.size ? ` · ${file.size}` : ""}</p></div>
            <div className="admin-remote-file-actions">
              <label><span>Film ou série</span><select value={selection.titleId} onChange={e=>updateFileSelection(file.file_code,{titleId:e.target.value,episodeId:""})}><option value="">Choisir un contenu…</option>{targets.map(t=><option key={t.id} value={t.id}>{t.kind==="series"?"Série":t.kind==="movie"?"Film":"Vidéo"} · {t.title}{Number(t.published)!==1?" (non publié)":""}</option>)}</select></label>
              <label><span>Épisode</span><select value={selection.episodeId} onChange={e=>updateFileSelection(file.file_code,{episodeId:e.target.value})} disabled={!target || target.kind!=="series"}><option value="">Film / vidéo entière</option>{(target?.episodes||[]).map(ep=><option key={ep.id} value={ep.id}>S{ep.season_number} E{ep.episode_number} · {ep.title}</option>)}</select></label>
              <button type="button" className="admin-shared-refresh" disabled={!selection.titleId || !!busyFile} onClick={()=>void associateDetectedFile(file)}>{fileBusy?<LoaderCircle size={14} className="admin-spin"/>:<Link2 size={14}/>} Associer</button>\n              <button type="button" className="admin-shared-refresh" disabled={!!busyFile} onClick={()=>openTmdbPicker(file)}><Search size={14}/> Choisir via TMDB</button>
            </div>
          </article>;
        })}</div>
        {tmdbFile && <div className="admin-remote-file-tmdb">
          <strong>Choisir la fiche TMDB pour : {tmdbFile.file_title || tmdbFile.title}</strong>
          <div className="admin-remote-file-actions">
            <label><span>Titre à rechercher</span><input value={tmdbQuery} onChange={e=>setTmdbQuery(e.target.value)} placeholder="Nom du film ou de la série"/></label>
            <label><span>Type</span><select value={tmdbKind} onChange={e=>setTmdbKind(e.target.value as "movie"|"series")}><option value="series">Série</option><option value="movie">Film</option></select></label>
            <button type="button" className="admin-shared-refresh" disabled={tmdbBusy || !tmdbQuery.trim()} onClick={()=>void searchTmdb()}>{tmdbBusy?<LoaderCircle size={14} className="admin-spin"/>:<Search size={14}/>} Rechercher</button>
            <button type="button" className="admin-shared-refresh" onClick={()=>{setTmdbFile(null);setTmdbResults([]);}}>Fermer</button>
          </div>
          {tmdbResults.map(result=><article key={`${result.kind}-${result.id}`} className="admin-shared-row">
            <div>{result.posterPath && <img src={`https://image.tmdb.org/t/p/w92${result.posterPath}`} alt="" width="46" loading="lazy"/>}<strong>{result.title}</strong><p>{result.kind==="series"?"Série":"Film"} · {result.year || "Date inconnue"} · {result.originalTitle}</p><p>{result.overview}</p></div>
            <button type="button" className="admin-shared-refresh" disabled={!!busyFile} onClick={()=>void chooseTmdb(result)}>{busyFile===tmdbFile.file_code?<LoaderCircle size={14} className="admin-spin"/>:<Link2 size={14}/>} Choisir et associer</button>
          </article>)}
        </div>}
      </details>}
      <p className="local-note">Les clés Uqload restent côté serveur. L’association utilise le code du fichier détecté et vérifie toujours le fichier auprès d’Uqload.</p>
    </>}
  </section>;
}
