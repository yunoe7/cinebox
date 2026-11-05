"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark, Clapperboard, Film, FolderPlus, Heart, Home, Library,
  ListVideo, Menu, Play, Plus, Search, Settings, Sparkles, Tv,
  Upload, X, ChevronRight, Clock3, MoreHorizontal
} from "lucide-react";

type Kind = "Film" | "Série" | "Vidéo";
type Title = {
  id: number; name: string; kind: Kind; year: number; genre: string;
  description: string; poster: string; backdrop: string; progress: number;
  duration: string; episodes?: string;
  videoUrl?: string;
};

const initialTitles: Title[] = [
  { id: 1, name: "Les heures dorées", kind: "Film", year: 2025, genre: "Drame", description: "Une photographe revient dans sa ville natale et découvre les secrets que sa famille a soigneusement gardés.", poster: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1800&q=85", progress: 62, duration: "1 h 48" },
  { id: 2, name: "Dernier signal", kind: "Série", year: 2026, genre: "Thriller", description: "Une opératrice de nuit reçoit un appel qui ne devrait pas exister. Au bout du fil, quelqu'un connaît son avenir.", poster: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1800&q=85", progress: 28, duration: "Saison 1", episodes: "8 épisodes" },
  { id: 3, name: "Là où la mer commence", kind: "Film", year: 2024, genre: "Aventure", description: "Deux frères traversent la côte à la recherche du phare de leur grand-père.", poster: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=1800&q=85", progress: 0, duration: "2 h 06" },
  { id: 4, name: "Les invisibles", kind: "Série", year: 2025, genre: "Policier", description: "Une équipe reprend des affaires classées et fait émerger des vérités oubliées.", poster: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1800&q=85", progress: 0, duration: "Saison 1", episodes: "6 épisodes" },
  { id: 5, name: "Minuit à Kyoto", kind: "Film", year: 2023, genre: "Romance", description: "Une rencontre inattendue transforme un voyage solitaire.", poster: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1800&q=85", progress: 0, duration: "1 h 54" },
  { id: 6, name: "Fragments", kind: "Vidéo", year: 2026, genre: "Documentaire", description: "Un court documentaire sur les lieux que l’on garde en mémoire.", poster: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1800&q=85", progress: 0, duration: "24 min" },
  { id: 7, name: "Le grand silence", kind: "Film", year: 2022, genre: "Science-fiction", description: "Après la disparition des étoiles, une communauté cherche le dernier signal.", poster: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1800&q=85", progress: 0, duration: "2 h 12" },
  { id: 8, name: "À contre-jour", kind: "Série", year: 2026, genre: "Drame", description: "Trois destins se croisent dans une ville en pleine transformation.", poster: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=700&q=85", backdrop: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1800&q=85", progress: 0, duration: "Saison 1", episodes: "10 épisodes" }
];

const navItems = [
  { label: "Accueil", icon: Home }, { label: "Films", icon: Film },
  { label: "Séries", icon: Tv }, { label: "Vidéos", icon: Clapperboard },
  { label: "Ma liste", icon: Heart }
];

export default function HomePage() {
  const [titles, setTitles] = useState<Title[]>(initialTitles);
  const [favorites, setFavorites] = useState<number[]>([2, 5]);
  const [activePage, setActivePage] = useState("Accueil");
  const [filter, setFilter] = useState("Tout");
  const [sortBy, setSortBy] = useState("recent");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Title | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [ready, setReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cinebox-titles");
      const savedFavs = localStorage.getItem("cinebox-favorites");
      if (saved) setTitles(JSON.parse(saved));
      if (savedFavs) setFavorites(JSON.parse(savedFavs));
    } catch { /* use demo library */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      localStorage.setItem("cinebox-titles", JSON.stringify(titles));
      localStorage.setItem("cinebox-favorites", JSON.stringify(favorites));
    }
  }, [titles, favorites, ready]);

  const visibleTitles = useMemo(() => titles.filter((item) => {
    const pageMatch = activePage === "Accueil" ||
      (activePage === "Ma liste" ? favorites.includes(item.id) : item.kind === activePage.slice(0, -1) || (activePage === "Séries" && item.kind === "Série"));
    const filterMatch = filter === "Tout" || item.kind === filter;
    const searchMatch = (item.name + " " + item.genre + " " + item.kind).toLowerCase().includes(query.toLowerCase());
    return pageMatch && filterMatch && searchMatch;
  }).sort((a, b) => sortBy === "title" ? a.name.localeCompare(b.name, "fr") : sortBy === "oldest" ? a.year - b.year : b.year - a.year), [titles, activePage, favorites, filter, query, sortBy]);

  const ongoing = titles.filter((item) => item.progress > 0);
  const toggleFavorite = (id: number) => setFavorites((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);

  const addTitle = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = fileRef.current?.files?.[0];
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    const newTitle: Title = {
      id: Date.now(), name, kind: form.get("kind") as Kind,
      year: Number(form.get("year")) || new Date().getFullYear(),
      genre: String(form.get("genre") || "À découvrir"),
      description: String(form.get("description") || "Ajouté à votre bibliothèque personnelle."),
      poster: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=700&q=80",
      backdrop: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1600&q=80",
      progress: 0, duration: "Non renseigné",
      videoUrl: file ? URL.createObjectURL(file) : undefined
    };
    setTitles((old) => [newTitle, ...old]);
    setShowAdd(false);
    event.currentTarget.reset();
    if (fileRef.current) fileRef.current.value = "";
    setActivePage("Accueil");
    setFilter("Tout");
  };

  const pageTitle = activePage === "Accueil" ? <>Le plaisir de <em>choisir.</em></> :
    activePage === "Ma liste" ? <>Vos histoires <em>préférées.</em></> :
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
            <button className="add-btn" onClick={() => setShowAdd(true)}><Plus size={15}/> <span>Ajouter un titre</span></button>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome"><div><div className="eyebrow">VOTRE COLLECTION PERSONNELLE</div><h1>{pageTitle}</h1></div><p>Un espace à vous. <span>Des histoires à l’infini.</span></p></div>

          {activePage === "Accueil" && <section className="hero">
            <div className="hero-bg"/>
            <div className="hero-overlay"/>
            <div className="hero-copy">
              <div className="hero-kicker"><i/> À LA UNE <span/> SÉLECTION CINÉBOX</div>
              <div className="hero-tag">LE PLAISIR DU GRAND ÉCRAN</div>
              <h2>Les histoires<br/>nous <em>rapprochent.</em></h2>
              <p>Le grand écran, votre façon de le vivre.<br/>Explorez votre collection et laissez-vous surprendre.</p>
              <button className="gold-btn" onClick={() => document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" })}>Explorer la collection <ChevronRight size={15}/></button>
            </div>
            <div className="hero-foot">01 <span/> 03</div>
          </section>}

          {activePage === "Accueil" && <section className="section-block">
            <div className="section-head"><div><div className="eyebrow">REPRENDRE LÀ OÙ VOUS EN ÉTIEZ</div><h2>À continuer <em>pour vous</em></h2></div><span className="subtle">{ongoing.length} titre{ongoing.length > 1 ? "s" : ""} en cours</span></div>
            <div className="continue-grid">
              {ongoing.map((item) => <button className="continue-card" key={item.id} onClick={() => setSelected(item)}><img src={item.poster} alt=""/><div className="continue-info"><small>{item.kind.toUpperCase()} · {item.year}</small><b>{item.name}</b><span>{item.progress}% regardé</span><div className="progress"><i style={{ width: `${item.progress}%` }}/></div></div><Play className="continue-play" size={17}/></button>)}
              {!ongoing.length && <div className="empty-mini">Vos lectures en cours apparaîtront ici.</div>}
            </div>
          </section>}

          <section className="section-block catalogue" id="catalogue">
            <div className="section-head"><div><div className="eyebrow">À PORTÉE DE MAIN</div><h2>{activePage === "Ma liste" ? "Vos favoris" : "Votre collection"} <em>à explorer</em></h2></div>
              <div className="catalogue-tools"><span className="result-count">{visibleTitles.length} TITRE{visibleTitles.length > 1 ? "S" : ""}</span><div className="filters">{["Tout", "Film", "Série", "Vidéo"].map((f) => <button key={f} className={filter === f ? "selected" : ""} onClick={() => setFilter(f)}>{f === "Tout" ? "Tout" : f + "s"}</button>)}</div><select className="sort-select" aria-label="Trier la collection" value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="recent">Plus récents</option><option value="oldest">Plus anciens</option><option value="title">Ordre alphabétique</option></select></div>
            </div>
            <div className="poster-grid">
              {visibleTitles.map((item, index) => <motion.article layout key={item.id} className="poster-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .25) }}>
                <button className="poster-open" onClick={() => setSelected(item)} aria-label={`Ouvrir ${item.name}`}><div className="poster-image"><img src={item.poster} alt={item.name} loading="lazy"/><span className="kind-chip">{item.kind}</span><span className="poster-play"><Play size={20} fill="currentColor"/></span></div><div className="poster-meta"><span>{item.genre}</span><span>{item.year}</span></div><strong>{item.name}</strong></button>
                <button className={`heart-btn ${favorites.includes(item.id) ? "is-fav" : ""}`} onClick={() => toggleFavorite(item.id)} aria-label="Favori"><Heart size={16} fill={favorites.includes(item.id) ? "currentColor" : "none"}/></button>
              </motion.article>)}
              {!visibleTitles.length && <div className="empty-state">Aucun titre trouvé. Essayez un autre filtre ou ajoutez un contenu.</div>}
            </div>
          </section>
          <footer><span>© 2026 CINÉBOX</span><span>VOTRE CINÉMA PERSONNEL <b>✦</b></span></footer>
        </div>
      </section>

      <AnimatePresence>
        {showAdd && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}><motion.div className="modal" initial={{ y: 18, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }}><button className="close-btn" onClick={() => setShowAdd(false)}><X/></button><div className="eyebrow">AGRANDIR VOTRE COLLECTION</div><h2>Ajouter un <em>titre.</em></h2><p className="modal-desc">Ajoutez une fiche et, si vous le souhaitez, un fichier vidéo depuis votre appareil.</p><form onSubmit={addTitle}>
          <label>Titre<input name="name" required placeholder="Ex. Le voyage intérieur"/></label>
          <div className="form-row"><label>Type<select name="kind"><option>Film</option><option>Série</option><option>Vidéo</option></select></label><label>Année<input name="year" type="number" min="1900" max="2099" defaultValue="2026"/></label></div>
          <label>Genre<input name="genre" placeholder="Drame, aventure…"/></label>
          <label>Résumé<textarea name="description" rows={3} placeholder="Quelques mots sur ce titre…"/></label>
          <label className="upload-field"><Upload size={16}/><span>Fichier vidéo <small>MP4, WebM ou autre format pris en charge par votre navigateur</small></span><input ref={fileRef} type="file" accept="video/*"/></label>
          <button className="gold-btn full" type="submit">Ajouter à ma collection <ChevronRight size={16}/></button>
        </form><p className="local-note">Pour cette première version, les titres et fichiers restent enregistrés dans ce navigateur uniquement.</p></motion.div></motion.div>}
        {selected && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><motion.div className="detail-modal" initial={{ y: 18 }} animate={{ y: 0 }} exit={{ y: 10, opacity: 0 }}><button className="close-btn" onClick={() => setSelected(null)}><X/></button>
          {selected.videoUrl ? <video className="detail-video" src={selected.videoUrl} controls autoPlay/> : <div className="detail-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#111318 0%,transparent 100%),url("${selected.backdrop}")` }}/>}
          <div className="detail-copy"><div className="eyebrow">{selected.kind.toUpperCase()} · {selected.year} · {selected.genre.toUpperCase()}</div><h2>{selected.name}</h2><p>{selected.description}</p><div className="detail-actions">{selected.videoUrl ? <span className="available"><Play size={14}/> Vidéo locale prête à lire</span> : <span className="unavailable">Fichier vidéo non associé</span>}<button className={`outline-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} onClick={() => toggleFavorite(selected.id)}><Heart size={15}/> {favorites.includes(selected.id) ? "Dans ma liste" : "Ajouter à ma liste"}</button></div></div>
        </motion.div></motion.div>}
      </AnimatePresence>
    </main>
  );
}