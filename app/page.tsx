"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { deleteAssets, loadAsset, saveAsset } from "../lib/cinebox/storage";
import { initialTitles } from "../lib/cinebox/catalog";
import DetailModal from "../components/cinebox/DetailModal";
import EpisodeEditor from "../components/cinebox/EpisodeEditor";
import TitleEditor from "../components/cinebox/TitleEditor";
import { AppToast, DeleteConfirmation } from "../components/cinebox/FeedbackDialogs";
import VideoPlayer from "../components/cinebox/VideoPlayer";
import type { Kind, Title } from "../lib/cinebox/types";
async function createVideoThumbnail(blob: Blob): Promise<Blob | undefined> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Vidéo illisible"));
    });
    video.currentTime = Math.min(5, Math.max(0, (video.duration || 1) * 0.1));
    await new Promise<void>(resolve => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 1500);
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | undefined>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

import {
  Clapperboard, Film, Heart, Home, Menu, Play, Plus, Search, Settings,
  Sparkles, Tv, Upload, X, ChevronRight, MoreHorizontal, Trash2, ShieldCheck
} from "lucide-react";

const navItems = [
  { label: "Accueil", icon: Home }, { label: "Films", icon: Film },
  { label: "Séries", icon: Tv }, { label: "Vidéos", icon: Clapperboard },
  { label: "Ma liste", icon: Heart }, { label: "Administration", icon: Settings }
];

export default function HomePage() {
  const [titles, setTitles] = useState<Title[]>(initialTitles);
  const [favorites, setFavorites] = useState<number[]>([2, 5]);
  const [activePage, setActivePage] = useState("Accueil");
  const [filter, setFilter] = useState("Tout");
  const [genreFilter, setGenreFilter] = useState("Tous les genres");
  const [heroIndex, setHeroIndex] = useState(0);
  const [sortBy, setSortBy] = useState("recent");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Title | null>(null);
  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<{ season: number; episode: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addKind, setAddKind] = useState<Kind>("Film");
  const [editingTitle, setEditingTitle] = useState<Title | null>(null);
  const [openCardMenu, setOpenCardMenu] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Title | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<{ season: number; episode: number; title: string } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [ready, setReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function restoreLibrary() {
      try {
        const saved = localStorage.getItem("cinebox-titles");
        const savedFavs = localStorage.getItem("cinebox-favorites");
        if (saved) {
          const records: Title[] = JSON.parse(saved);
          const restored = await Promise.all(records.map(async (item) => {
            const posterBlob = await loadAsset(`${item.id}:poster`).catch(() => undefined);
            const videoBlob = await loadAsset(`${item.id}:video`).catch(() => undefined);
            const seasons = await Promise.all((item.seasons || []).map(async (season) => ({ ...season, episodes: await Promise.all(season.episodes.map(async (episode) => { const key = `${item.id}:episode:${season.number}:${episode.number}`; const blob = await loadAsset(key).catch(() => undefined); let thumbnail = await loadAsset(`${key}:thumbnail`).catch(() => undefined); if (blob && !thumbnail) { thumbnail = await createVideoThumbnail(blob); if (thumbnail) await saveAsset(`${key}:thumbnail`, thumbnail).catch(() => undefined); } return { ...episode, videoUrl: blob ? URL.createObjectURL(blob) : undefined, thumbnailUrl: thumbnail ? URL.createObjectURL(thumbnail) : undefined }; })) })));
            const firstEpisodeBlob = item.kind === "Série" ? await loadAsset(`${item.id}:episode:1:1`).catch(() => undefined) : undefined;
            let generatedPoster = !posterBlob ? await loadAsset(`${item.id}:poster-thumbnail`).catch(() => undefined) : undefined;
            if (!posterBlob && firstEpisodeBlob && !generatedPoster) { generatedPoster = await createVideoThumbnail(firstEpisodeBlob); if (generatedPoster) await saveAsset(`${item.id}:poster-thumbnail`, generatedPoster).catch(() => undefined); }
            return {
              ...item,
              seasons,
              poster: posterBlob ? URL.createObjectURL(posterBlob) : generatedPoster ? URL.createObjectURL(generatedPoster) : item.poster.startsWith("blob:") ? "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=700&q=80" : item.poster,
              videoUrl: videoBlob ? URL.createObjectURL(videoBlob) : undefined
            };
          }));
          if (!cancelled) setTitles(restored);
        }
        if (savedFavs && !cancelled) setFavorites(JSON.parse(savedFavs));
      } catch { /* use demo library */ }
      if (!cancelled) setReady(true);
    }
    restoreLibrary();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (ready) {
      localStorage.setItem("cinebox-titles", JSON.stringify(titles.map(({ videoUrl, ...item }) => ({
        ...item,
        poster: item.poster.startsWith("blob:") ? "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=700&q=80" : item.poster,
        seasons: item.seasons?.map(season => ({ ...season, episodes: season.episodes.map(({ videoUrl: episodeVideoUrl, ...episode }) => episode) }))
      }))));
      localStorage.setItem("cinebox-favorites", JSON.stringify(favorites));
    }
  }, [titles, favorites, ready]);

  const visibleTitles = useMemo(() => titles.filter((item) => {
    const pageMatch = activePage === "Accueil" || activePage === "Administration" ||
      (activePage === "Ma liste" ? favorites.includes(item.id) : item.kind === activePage.slice(0, -1) || (activePage === "Séries" && item.kind === "Série"));
    const filterMatch = filter === "Tout" || item.kind === filter;
    const genreMatch = genreFilter === "Tous les genres" || item.genre === genreFilter;
    const searchable = [item.name, item.genre, item.kind, item.description, String(item.year), ...(item.seasons || []).flatMap(season => season.episodes.map(episode => episode.title))].join(" ").toLocaleLowerCase("fr");
    const searchMatch = searchable.includes(query.trim().toLocaleLowerCase("fr"));
    return pageMatch && filterMatch && genreMatch && searchMatch;
  }).sort((a, b) => sortBy === "title" ? a.name.localeCompare(b.name, "fr") : sortBy === "oldest" ? a.year - b.year : b.year - a.year), [titles, activePage, favorites, filter, genreFilter, query, sortBy]);

  const featuredTitles = useMemo(() => [...titles].sort((a, b) => b.year - a.year).slice(0, 5), [titles]);
  const activeFeatured = featuredTitles[heroIndex % Math.max(1, featuredTitles.length)];
  useEffect(() => {
    if (featuredTitles.length < 2) return;
    const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % featuredTitles.length), 7000);
    return () => window.clearInterval(timer);
  }, [featuredTitles.length]);
  const ongoing = titles.map(item => {
    const watchedEpisodes = (item.seasons || []).flatMap(season => season.episodes)
      .filter(episode => (episode.progress || 0) > 0 && (episode.progress || 0) < 100);
    if (item.progress > 0 || watchedEpisodes.length === 0) return item;
    const latestEpisode = [...watchedEpisodes].sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0))[0];
    return { ...item, progress: latestEpisode.progress || 0, currentTime: latestEpisode.currentTime || 0 };
  }).filter(item => item.progress > 0);
  const personalizedPicks = useMemo(() => {
    const favoriteGenres = favorites
      .map(id => titles.find(item => item.id === id)?.genre)
      .filter((genre): genre is string => Boolean(genre));
    const genreCounts = favoriteGenres.reduce<Record<string, number>>((counts, genre) => {
      counts[genre] = (counts[genre] || 0) + 1;
      return counts;
    }, {});
    return titles
      .filter(item => !favorites.includes(item.id) && item.progress === 0)
      .map(item => ({ item, score: genreCounts[item.genre] || 0 }))
      .sort((a, b) => b.score - a.score || b.item.year - a.item.year)
      .slice(0, 4)
      .map(entry => entry.item);
  }, [titles, favorites]);
  const homeGenres = useMemo(() => Array.from(new Set(titles.map(item => item.genre).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [titles]);
  const topTen = useMemo(() => [...titles].filter(item => (item.viewCount || 0) > 0).sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0) || b.year - a.year).slice(0, 10), [titles]);
  const collections = useMemo(() => {
    const groups = new Map<string, Title[]>();
    titles.forEach(item => {
      const name = item.collection?.trim();
      if (name) groups.set(name, [...(groups.get(name) || []), item]);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [titles]);
  const homeRows = useMemo(() => [
    { title: "Films à explorer", kicker: "LE GRAND ÉCRAN", items: titles.filter(item => item.kind === "Film").sort((a, b) => b.year - a.year).slice(0, 10) },
    { title: "Séries à découvrir", kicker: "À SUIVRE", items: titles.filter(item => item.kind === "Série").sort((a, b) => b.year - a.year).slice(0, 10) },
    { title: "Ajouts récents", kicker: "FRAÎCHEMENT AJOUTÉS", items: [...titles].sort((a, b) => b.id - a.id).slice(0, 10) }
  ].filter(row => row.items.length), [titles]);
  const openTitle = (item: Title) => {
    setSelectedEpisodeUrl(null);
    setSelectedEpisode(null);
    setSelected(item);
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
  const toggleFavorite = (id: number) => setFavorites((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);

  const addTitle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = fileRef.current?.files?.[0];
    const episodeFiles = Array.from(document.querySelector<HTMLInputElement>('input[name="episodeVideos"]')?.files || []);
    const posterFile = posterRef.current?.files?.[0];
    const kind = form.get("kind") as Kind;
    const seasonCount = Math.max(1, Math.min(20, Number(form.get("seasonCount")) || 1));
    const episodeCount = Math.max(0, Math.min(100, Number(form.get("episodeCount")) || 0));
    const episodeNames = String(form.get("episodeTitles") || "").split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    const newId = editingTitle?.id ?? Date.now();
    const perSeason = episodeCount || Math.ceil(Math.max(episodeNames.length, episodeFiles.length) / seasonCount);
    try {
      const saves: Promise<void>[] = [];
      if (posterFile) saves.push(saveAsset(`${newId}:poster`, posterFile));
      if (file) saves.push(saveAsset(`${newId}:video`, file));
      episodeFiles.forEach((episodeFile, index) => { const seasonNumber = Math.floor(index / Math.max(1, perSeason)) + 1; const episodeNumber = index % Math.max(1, perSeason) + 1; saves.push(saveAsset(`${newId}:episode:${seasonNumber}:${episodeNumber}`, episodeFile)); });
      await Promise.all(saves);
    } catch {
      setNotice({ title: "Sauvegarde impossible", message: "Un ou plusieurs fichiers n’ont pas pu être enregistrés. Vérifiez l’espace disponible puis réessayez." });
      window.setTimeout(() => setNotice(null), 4500);
      return;
    }
    const newTitle: Title = {
      id: newId, name, kind,
      year: Number(form.get("year")) || new Date().getFullYear(),
      genre: String(form.get("genre") || "À découvrir"),
      collection: String(form.get("collection") || "").trim() || undefined,
      description: String(form.get("description") || "Ajouté à votre bibliothèque personnelle."),
      poster: posterFile ? URL.createObjectURL(posterFile) : editingTitle?.poster || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=700&q=80",
      backdrop: editingTitle?.backdrop || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1600&q=80",
      progress: editingTitle?.progress || 0, duration: kind === "Série" ? `${editingTitle?.seasons?.length || seasonCount} saison${(editingTitle?.seasons?.length || seasonCount) > 1 ? "s" : ""}` : String(form.get("duration") || "Non renseigné"),
      episodes: kind === "Série" ? `${perSeason} épisodes / saison` : undefined,
      seasons: kind === "Série" ? Array.from({ length: seasonCount }, (_, seasonIndex) => {
        const oldSeason = editingTitle?.seasons?.find(season => season.number === seasonIndex + 1);
        return { number: seasonIndex + 1, episodes: Array.from({ length: perSeason }, (_, episodeIndex) => {
          const fileIndex = seasonIndex * perSeason + episodeIndex;
          const oldEpisode = oldSeason?.episodes.find(episode => episode.number === episodeIndex + 1);
          const uploadedFile = episodeFiles[fileIndex];
          return {
            ...(oldEpisode || {}),
            number: episodeIndex + 1,
            title: episodeNames[fileIndex] || oldEpisode?.title || `Épisode ${episodeIndex + 1}`,
            videoUrl: uploadedFile ? URL.createObjectURL(uploadedFile) : oldEpisode?.videoUrl,
            currentTime: uploadedFile ? 0 : oldEpisode?.currentTime,
            progress: uploadedFile ? 0 : oldEpisode?.progress
          };
        }) };
      }) : undefined,
      videoUrl: file ? URL.createObjectURL(file) : editingTitle?.videoUrl
    };
    if (editingTitle) setTitles(old => old.map(item => item.id === editingTitle.id ? newTitle : item)); else setTitles(old => [newTitle, ...old]);
    setEditingTitle(null);
    setShowAdd(false);
    event.currentTarget.reset();
    if (fileRef.current) fileRef.current.value = "";
    if (posterRef.current) posterRef.current.value = "";
    setActivePage("Accueil");
    setFilter("Tout");
    setNotice({ title: editingTitle ? "Modifications enregistrées" : "Ajout à la bibliothèque réussi", message: `« ${name} » est prêt dans votre collection.` });
    window.setTimeout(() => setNotice(null), 3600);
  };

  const pageTitle = activePage === "Accueil" ? <>Le plaisir de <em>choisir.</em></> :
    activePage === "Ma liste" ? <>Vos histoires <em>préférées.</em></> :
    activePage === "Administration" ? <>Gérez votre <em>bibliothèque.</em></> :
    <>Explorez les <em>{activePage.toLowerCase()}.</em></>;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <a className="brand" href="#"><span className="brand-mark"><Clapperboard size={21} strokeWidth={1.55}/><i/></span><span className="brand-word">CINÉBOX<small>PRIVATE CINEMA</small></span></a>
        <div className="side-label">VOTRE ESPACE</div>
        <nav className="side-nav">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activePage === label ? "active" : ""}`} onClick={() => { setActivePage(label); setFilter("Tout"); setMobileMenu(false); }}><Icon size={17}/><span>{label}</span>{label === "Ma liste" && <small>{favorites.length}</small>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note"><Sparkles size={16}/><strong>Votre cinéma, à votre image.</strong><p>Une bibliothèque personnelle pour toutes vos histoires.</p><span>ESPACE PERSONNEL</span></div>
          <div className="profile"><div className="avatar">C</div><div><b>Mon espace</b><small>Bibliothèque privée</small></div><i/></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu"><Menu/></button>
          <div className="crumb">CINÉBOX <span>/</span> <b>{activePage.toUpperCase()}</b></div>
          <div className="top-actions">
            <label className="search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans ma collection…"/></label>
            <button className="add-btn" onClick={() => { setEditingTitle(null); setAddKind("Film"); setShowAdd(true); }}><Plus size={15}/> <span>Ajouter un titre</span></button>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome"><div><div className="eyebrow">VOTRE COLLECTION PERSONNELLE</div><h1>{pageTitle}</h1></div><p>Un espace à vous. <span>Des histoires à l’infini.</span></p></div>

          {activePage === "Accueil" && activeFeatured && <section className="hero hero-carousel" aria-label="Sélection à la une">
            <div className="hero-bg" style={{ backgroundImage: `url("${activeFeatured.backdrop || activeFeatured.poster}")` }}/>
            <div className="hero-overlay"/>
            <div className="hero-copy" key={activeFeatured.id}>
              <div className="hero-kicker"><i/> À LA UNE <span/> SÉLECTION CINÉBOX</div>
              <div className="hero-tag">{activeFeatured.kind.toUpperCase()} À DÉCOUVRIR</div>
              <h2>{activeFeatured.name}</h2>
              <div className="hero-meta">{activeFeatured.year} <span>·</span> {activeFeatured.genre} <span>·</span> {activeFeatured.duration}</div>
              <p>{activeFeatured.description}</p>
              <div className="hero-actions">
                <button className="gold-btn" onClick={() => setSelected(activeFeatured)}><Play size={14} fill="currentColor"/> Lecture</button>
                <button className="hero-info-btn" onClick={() => setSelected(activeFeatured)}><span>ⓘ</span> Plus d'infos</button>
              </div>
            </div>
            <div className="hero-controls">
              <button aria-label="Titre précédent" onClick={() => setHeroIndex(index => (index - 1 + featuredTitles.length) % featuredTitles.length)}><ChevronRight size={15} className="hero-prev-icon"/></button>
              <div className="hero-dots">{featuredTitles.map((item, index) => <button key={item.id} aria-label={`Afficher ${item.name}`} aria-current={index === heroIndex ? "true" : undefined} className={index === heroIndex ? "active" : ""} onClick={() => setHeroIndex(index)}/>)}</div>
              <button aria-label="Titre suivant" onClick={() => setHeroIndex(index => (index + 1) % featuredTitles.length)}><ChevronRight size={15}/></button>
            </div>
          </section>}

          {activePage === "Accueil" && <section className="section-block">
            <div className="section-head"><div><div className="eyebrow">REPRENDRE LÀ OÙ VOUS EN ÉTIEZ</div><h2>À continuer <em>pour vous</em></h2></div><span className="subtle">{ongoing.length} titre{ongoing.length > 1 ? "s" : ""} en cours</span></div>
            <div className="continue-grid">
              {ongoing.map((item) => <button className="continue-card" key={item.id} onClick={() => resumeTitle(item)}><img src={item.poster} alt=""/><div className="continue-info"><small>{item.kind.toUpperCase()} · {item.year}</small><b>{item.name}</b><span>{item.progress}% regardé</span><div className="progress"><i style={{ width: `${item.progress}%` }}/></div></div><Play className="continue-play" size={17}/></button>)}
              {!ongoing.length && <div className="empty-mini">Vos lectures en cours apparaîtront ici.</div>}
            </div>
          </section>}

          {activePage === "Accueil" && personalizedPicks.length > 0 && <section className="section-block discovery-block">
            <div className="section-head"><div><div className="eyebrow">SELON VOS ENVIES</div><h2>À découvrir <em>ensuite</em></h2></div><span className="subtle">Une sélection issue de vos favoris</span></div>
            <div className="discovery-grid">
              {personalizedPicks.map(item => <button className="discovery-card" key={item.id} onClick={() => openTitle(item)}>
                <img src={item.poster} alt="" loading="lazy"/>
                <span className="discovery-copy"><small>{item.kind.toUpperCase()} · {item.genre}</small><strong>{item.name}</strong><i>{item.year}</i></span>
                <Play className="discovery-play" size={16}/>
              </button>)}
            </div>
          </section>}

          {activePage === "Accueil" && <>
            <section className="streaming-genres section-block">
              <div className="section-head"><div><div className="eyebrow">TROUVEZ VOTRE PROCHAINE HISTOIRE</div><h2>Explorer par <em>genre</em></h2></div></div>
              <div className="genre-pills">
                <button className={genreFilter === "Tous les genres" ? "active" : ""} onClick={() => setGenreFilter("Tous les genres")}>Tout voir</button>
                {homeGenres.map(genre => <button key={genre} className={genreFilter === genre ? "active" : ""} onClick={() => { setGenreFilter(genre); document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" }); }}>{genre}</button>)}
              </div>
            </section>
            {ongoing.length > 0 && <section className="section-block streaming-row-section">
              <div className="section-head"><div><div className="eyebrow">REPRENEZ LÀ OÙ VOUS EN ÉTIEZ</div><h2>Continuer à <em>regarder</em></h2></div><span className="subtle">{ongoing.length} en cours</span></div>
              <div className="streaming-row">{[...ongoing].sort((a, b) => (b.currentTime || 0) - (a.currentTime || 0)).map(item => <button className="streaming-card continue-card" key={item.id} onClick={() => openTitle(item)}>
                <span className="continue-card-poster"><img src={item.poster} alt="" loading="lazy"/><span className="continue-progress-track"><span style={{ width: `${Math.max(3, Math.min(100, item.progress))}%` }}/></span></span>
                <span className="streaming-card-info"><small>REPRENDRE · {Math.round(item.progress)} %</small><strong>{item.name}</strong></span>
              </button>)}</div>
            </section>}
            <section className="section-block streaming-row-section collections-section">
              <div className="section-head"><div><div className="eyebrow">À RETROUVER ENSEMBLE</div><h2>Collections & <em>sagas</em></h2></div><span className="subtle">{collections.length} collection{collections.length > 1 ? "s" : ""}</span></div>
              {collections.length > 0 ? collections.map(([name, items]) => <div className="collection-saga" key={name}>
                <div className="collection-saga-heading"><strong>{name}</strong><span>{items.length} titre{items.length > 1 ? "s" : ""}</span></div>
                <div className="streaming-row">{[...items].sort((a, b) => a.year - b.year).map(item => <button className="streaming-card" key={item.id} onClick={() => openTitle(item)}><img src={item.poster} alt="" loading="lazy"/><span className="streaming-card-info"><small>{item.kind} · {item.year}</small><strong>{item.name}</strong></span></button>)}</div>
              </div>) : <div className="collections-empty">
                <div className="collections-empty-mark">✦</div>
                <div><strong>Crée ta première collection</strong><p>Rassemble tes films et séries par saga : Harry Potter, Marvel, Star Wars…</p></div>
                <button className="collection-create-btn" onClick={() => { setEditingTitle(null); setAddKind("Film"); setShowAdd(true); }}>＋ Ajouter un titre à une collection</button>
              </div>}
            </section>
            {topTen.length > 0 && <section className="section-block streaming-row-section">
              <div className="section-head"><div><div className="eyebrow">LES INCONTOURNABLES DE VOTRE CINÉBOX</div><h2>Votre Top <em>10</em></h2></div><span className="subtle">Sélection de votre bibliothèque</span></div>
              <div className="streaming-row top-ten-row">{topTen.map((item, index) => <button className="streaming-card top-ten-card" key={item.id} onClick={() => openTitle(item)}><span className="top-ten-number">{index + 1}</span><img src={item.poster} alt="" loading="lazy"/><span className="streaming-card-info"><small>{item.kind} · {item.year}</small><strong>{item.name}</strong></span></button>)}</div>
            </section>}
            {homeRows.map(row => <section className="section-block streaming-row-section" key={row.title}>
              <div className="section-head"><div><div className="eyebrow">{row.kicker}</div><h2>{row.title}</h2></div><span className="subtle">{row.items.length} contenu{row.items.length > 1 ? "s" : ""}</span></div>
              <div className="streaming-row">{row.items.map(item => <button className="streaming-card" key={item.id} onClick={() => openTitle(item)}><img src={item.poster} alt="" loading="lazy"/><span className="streaming-card-info"><small>{item.kind} · {item.year} · {item.genre}</small><strong>{item.name}</strong></span></button>)}</div>
            </section>)}
          </>}
          {activePage === "Administration" && <section className="admin-overview">
            <div className="admin-heading"><div><div className="eyebrow">ESPACE DE GESTION</div><h2><ShieldCheck size={19}/> Administration</h2><p>Gérez les titres de votre bibliothèque privée depuis un seul endroit.</p></div><button className="gold-btn" onClick={() => { setEditingTitle(null); setAddKind("Film"); setShowAdd(true); }}><Plus size={15}/> Ajouter un titre</button></div>
            <div className="admin-stats">
              <div><span>TITRES AU TOTAL</span><strong>{titles.length}</strong></div>
              <div><span>FILMS</span><strong>{titles.filter(t => t.kind === "Film").length}</strong></div>
              <div><span>SÉRIES</span><strong>{titles.filter(t => t.kind === "Série").length}</strong></div>
              <div><span>VIDÉOS</span><strong>{titles.filter(t => t.kind === "Vidéo").length}</strong></div>
            </div>
            <div className="admin-hint">Les affiches et vidéos importées sont conservées sur cet appareil, même après fermeture du navigateur. La synchronisation en ligne viendra ensuite.</div>
          </section>}

          <section className="section-block catalogue" id="catalogue">
            <div className="section-head"><div><div className="eyebrow">{activePage === "Administration" ? "GESTION DES CONTENUS" : "À PORTÉE DE MAIN"}</div><h2>{activePage === "Administration" ? "Tous les titres" : activePage === "Ma liste" ? "Vos favoris" : "Votre collection"} <em>{activePage === "Administration" ? "à gérer" : "à explorer"}</em></h2></div>
              <div className="catalogue-tools"><span className="result-count">{visibleTitles.length} TITRE{visibleTitles.length > 1 ? "S" : ""}</span><div className="filters">{["Tout", "Film", "Série", "Vidéo"].map((f) => <button key={f} className={filter === f ? "selected" : ""} onClick={() => setFilter(f)}>{f === "Tout" ? "Tout" : f + "s"}</button>)}</div><select className="sort-select genre-select" aria-label="Filtrer par genre" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}><option value="Tous les genres">Tous les genres</option>{Array.from(new Set(titles.map(item => item.genre).filter(Boolean))).sort((a,b) => a.localeCompare(b,"fr")).map(genre => <option key={genre} value={genre}>{genre}</option>)}</select><select className="sort-select" aria-label="Trier la collection" value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="recent">Plus récents</option><option value="oldest">Plus anciens</option><option value="title">Ordre alphabétique</option></select></div>
            </div>
            <div className="poster-grid">
              {visibleTitles.map((item, index) => <motion.article layout key={item.id} className="poster-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .25) }}>
                <button className="poster-open" onClick={() => openTitle(item)} aria-label={`Ouvrir ${item.name}`}><div className="poster-image"><img src={item.poster} alt={item.name} loading="lazy"/><span className="kind-chip">{item.kind}</span><span className="poster-play"><Play size={20} fill="currentColor"/></span></div><div className="poster-meta"><span>{item.genre}</span><span>{item.year}</span></div><strong>{item.name}</strong></button>
                {activePage === "Administration" ? <div className="card-menu-wrap"><button className="heart-btn card-menu-trigger" onClick={() => setOpenCardMenu(openCardMenu === item.id ? null : item.id)} aria-label={`Actions pour ${item.name}`} aria-expanded={openCardMenu === item.id} title="Actions"><MoreHorizontal size={18}/></button>{openCardMenu === item.id && <><button className="menu-dismiss" aria-label="Fermer le menu" onClick={() => setOpenCardMenu(null)}/><div className="card-action-menu"><button onClick={() => { setEditingTitle(item); setAddKind(item.kind); setShowAdd(true); setOpenCardMenu(null); }}><Settings size={15}/> Modifier</button><button className="danger" onClick={() => { setOpenCardMenu(null); setConfirmDelete(item); }}><Trash2 size={15}/> Supprimer</button></div></>}</div> : <button className={`heart-btn ${favorites.includes(item.id) ? "is-fav" : ""}`} onClick={() => toggleFavorite(item.id)} aria-label="Favori"><Heart size={16} fill={favorites.includes(item.id) ? "currentColor" : "none"}/></button>}
              </motion.article>)}
              {!visibleTitles.length && <div className="empty-state">Aucun titre trouvé. Essayez un autre filtre ou ajoutez un contenu.</div>}
            </div>
          </section>
          <footer><span>© 2026 CINÉBOX</span><span>VOTRE CINÉMA PERSONNEL <b>✦</b></span></footer>
        </div>
      </section>

      <AnimatePresence>
        {confirmDelete && <DeleteConfirmation
          title={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setTitles(old => old.filter(t => t.id !== target.id));
            setFavorites(old => old.filter(id => id !== target.id));
            void deleteAssets(target.id).catch(() => setNotice({ title: "Nettoyage incomplet", message: "Le titre a été supprimé, mais certains fichiers locaux n’ont pas pu être effacés." }));
            setConfirmDelete(null);
            setNotice({ title: "Titre supprimé", message: "Le contenu a été retiré de votre bibliothèque." });
            window.setTimeout(() => setNotice(null), 3600);
          }}
        />}
        {notice && <AppToast notice={notice} onClose={() => setNotice(null)} />}
        {showAdd && <TitleEditor
          addKind={addKind}
          setAddKind={setAddKind}
          editingTitle={editingTitle}
          fileRef={fileRef}
          posterRef={posterRef}
          onClose={() => { setShowAdd(false); setEditingTitle(null); }}
          onSubmit={addTitle}
        />}
        <EpisodeEditor
          selected={selected}
          editingEpisode={editingEpisode}
          onClose={() => setEditingEpisode(null)}
          onSave={async (target, file) => {
            if (!selected) return;
            const key = `${selected.id}:episode:${target.season}:${target.episode}`;
            if (file) { try { await saveAsset(key, file); } catch { setNotice({ title: "Sauvegarde impossible", message: "La vidéo de cet épisode n’a pas pu être enregistrée. Réessayez." }); return; } }
            const videoUrl = file ? URL.createObjectURL(file) : undefined;
            const thumbnail = file ? await createVideoThumbnail(file) : undefined;
            if (thumbnail) await saveAsset(`${key}:thumbnail`, thumbnail).catch(() => undefined);
            const thumbnailUrl = thumbnail ? URL.createObjectURL(thumbnail) : undefined;
            const update = (item: Title): Title => ({
              ...item,
              seasons: item.seasons?.map(season => season.number !== target.season ? season : {
                ...season,
                episodes: season.episodes.map(episode => episode.number !== target.episode ? episode : {
                  ...episode, title: target.title, ...(videoUrl ? { videoUrl, thumbnailUrl, currentTime: 0, progress: 0 } : {})
                })
              })
            });
            setTitles(old => old.map(item => item.id === selected.id ? update(item) : item));
            setSelected(old => old && old.id === selected.id ? update(old) : old);
            setEditingEpisode(null);
            setNotice({ title: "Épisode mis à jour", message: "Les informations de l’épisode ont été enregistrées." });
            window.setTimeout(() => setNotice(null), 3600);
          }}
        />
        <DetailModal
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
          onView={(titleId) => setTitles(old => old.map(item => item.id === titleId ? { ...item, viewCount: (item.viewCount || 0) + 1 } : item))}
          onProgress={(titleId, episodeSelection, second, progress) => {
            if (episodeSelection) {
              const { season: seasonNumber, episode: episodeNumber } = episodeSelection;
              setTitles(old => old.map(item => item.id !== titleId ? item : {
                ...item,
                seasons: item.seasons?.map(season => season.number !== seasonNumber ? season : {
                  ...season,
                  episodes: season.episodes.map(episode => episode.number === episodeNumber ? { ...episode, currentTime: second, progress } : episode)
                })
              }));
              setSelected(old => old && old.id === titleId ? {
                ...old,
                seasons: old.seasons?.map(season => season.number !== seasonNumber ? season : {
                  ...season,
                  episodes: season.episodes.map(episode => episode.number === episodeNumber ? { ...episode, currentTime: second, progress } : episode)
                })
              } : old);
            } else {
              setTitles(old => old.map(item => item.id === titleId ? { ...item, currentTime: second, progress } : item));
              setSelected(old => old && old.id === titleId ? { ...old, currentTime: second, progress } : old);
            }
          }}
          onEnded={(title, episodeSelection) => {
            if (!episodeSelection || !title.seasons) return;
            const playable = title.seasons.flatMap(season => season.episodes
              .filter(episode => episode.videoUrl)
              .map(episode => ({ season: season.number, episode: episode.number, url: episode.videoUrl! })));
            const currentIndex = playable.findIndex(item => item.season === episodeSelection.season && item.episode === episodeSelection.episode);
            const next = playable[currentIndex + 1];
            if (next) {
              setSelectedEpisode({ season: next.season, episode: next.episode });
              setSelectedEpisodeUrl(next.url);
            }
          }}
        />
      </AnimatePresence>
    </main>
  );
}