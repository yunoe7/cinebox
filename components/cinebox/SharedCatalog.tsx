"use client";

import { useEffect, useState } from "react";

type SharedTitle = {
  id: string;
  kind: "movie" | "series" | "video";
  title: string;
  overview: string;
  releaseDate: string | null;
  posterPath: string | null;
  genres: string[];
};

type CatalogResponse = { titles: SharedTitle[] };

function isCatalogResponse(value: unknown): value is CatalogResponse {
  if (!value || typeof value !== "object" || !Array.isArray((value as { titles?: unknown }).titles)) return false;
  return (value as { titles: unknown[] }).titles.every((item) =>
    Boolean(item && typeof item === "object" &&
      typeof (item as SharedTitle).id === "string" &&
      ["movie", "series", "video"].includes((item as SharedTitle).kind) &&
      typeof (item as SharedTitle).title === "string" &&
      typeof (item as SharedTitle).overview === "string" &&
      ((item as SharedTitle).releaseDate === null || typeof (item as SharedTitle).releaseDate === "string") &&
      ((item as SharedTitle).posterPath === null || typeof (item as SharedTitle).posterPath === "string") &&
      Array.isArray((item as SharedTitle).genres) &&
      (item as SharedTitle).genres.every((genre) => typeof genre === "string"),
    ),
  );
}

const labels = { movie: "FILM", series: "SÉRIE", video: "VIDÉO" } as const;

/** Read-only view of the centrally published catalogue. Personal data remains local until auth is ready. */
export function SharedCatalog() {
  const [titles, setTitles] = useState<SharedTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/catalog?limit=50", { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        const value: unknown = await response.json();
        if (!isCatalogResponse(value)) throw new Error("Invalid catalogue response");
        setTitles(value.titles);
        setError(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading || (!error && titles.length === 0)) return null;

  return (
    <section className="section-block" aria-labelledby="shared-catalog-heading">
      <div className="section-head">
        <div>
          <div className="eyebrow">LE CATALOGUE COMMUN</div>
          <h2 id="shared-catalog-heading">Publié sur <em>CinéBox</em></h2>
        </div>
        {!error && <span className="subtle">{titles.length} contenu{titles.length === 1 ? "" : "s"} publié{titles.length === 1 ? "" : "s"}</span>}
      </div>
      {error ? (
        <p role="status" className="subtle">Le catalogue partagé est momentanément indisponible. Votre bibliothèque personnelle reste accessible.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 16 }}>
          {titles.map((item) => {
            const year = item.releaseDate ? new Date(item.releaseDate).getUTCFullYear() : null;
            const poster = item.posterPath
              ? item.posterPath.startsWith("http") ? item.posterPath : `https://image.tmdb.org/t/p/w342${item.posterPath}`
              : null;
            return (
              <article key={item.id} style={{ minWidth: 0 }}>
                <div style={{ aspectRatio: "2 / 3", overflow: "hidden", borderRadius: 12, background: "rgba(255,255,255,.06)" }}>
                  {poster ? <img src={poster} alt={`Affiche de ${item.title}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 12, textAlign: "center" }}><span className="subtle">CinéBox</span></div>}
                </div>
                <div style={{ padding: "9px 2px" }}>
                  <div className="eyebrow">{labels[item.kind]}{year ? ` · ${year}` : ""}</div>
                  <strong style={{ display: "block", marginTop: 4, lineHeight: 1.3 }}>{item.title}</strong>
                  {item.genres.length > 0 && <small className="subtle">{item.genres.slice(0, 2).join(" · ")}</small>}
                  {item.overview && <p className="subtle" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>{item.overview}</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
