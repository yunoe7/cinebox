const TMDB_API = "https://api.themoviedb.org/3";
const IMAGE_HOST = "https://image.tmdb.org/t/p/w780";
const MAX_QUERY_LENGTH = 120;

function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function safeId(value: string | undefined) {
  return Boolean(value && /^\d{1,12}$/.test(value));
}

function safeImagePath(value: string | null) {
  return Boolean(value && /^\/[A-Za-z0-9_./-]{1,180}$/.test(value) && !value.split("/").includes(".."));
}

/** Cloudflare Pages read-only TMDB proxy. The bearer token is only read from the server binding. */
export async function onRequestGet({ request, env }: { request: Request; env: { TMDB_READ_ACCESS_TOKEN?: string } }) {
  const token = env.TMDB_READ_ACCESS_TOKEN;
  if (!token) return json({ error: "La connexion au catalogue externe n’est pas configurée." }, 503);

  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/tmdb\/?/, "").split("/").filter(Boolean);
  let upstreamUrl: URL;

  if (route.length === 1 && route[0] === "search") {
    const query = (url.searchParams.get("query") || "").trim();
    const kind = url.searchParams.get("kind") || "multi";
    const year = url.searchParams.get("year") || "";
    if (!query || query.length > MAX_QUERY_LENGTH || !["multi", "movie", "tv"].includes(kind) || (year && !/^\d{4}$/.test(year))) {
      return json({ error: "La recherche est invalide." }, 400);
    }
    upstreamUrl = new URL(`${TMDB_API}/search/${kind}`);
    upstreamUrl.searchParams.set("query", query);
    upstreamUrl.searchParams.set("include_adult", "false");
    upstreamUrl.searchParams.set("language", "fr-FR");
    upstreamUrl.searchParams.set("page", "1");
    if (year) upstreamUrl.searchParams.set(kind === "tv" ? "first_air_date_year" : "year", year);
  } else if (route.length === 2 && ["movie", "tv"].includes(route[0]) && safeId(route[1])) {
    upstreamUrl = new URL(`${TMDB_API}/${route[0]}/${route[1]}`);
    upstreamUrl.searchParams.set("language", "fr-FR");
    upstreamUrl.searchParams.set("append_to_response", "credits");
  } else if (route.length === 3 && ["movie", "tv"].includes(route[0]) && safeId(route[1]) && route[2] === "reviews") {
    upstreamUrl = new URL(`${TMDB_API}/${route[0]}/${route[1]}/reviews`);
    upstreamUrl.searchParams.set("language", "fr-FR");
    upstreamUrl.searchParams.set("page", "1");
  } else if (route.length === 4 && route[0] === "tv" && route[2] === "season" && safeId(route[1]) && /^(0|[1-9]\d{0,2})$/.test(route[3])) {
    upstreamUrl = new URL(`${TMDB_API}/tv/${route[1]}/season/${route[3]}`);
    upstreamUrl.searchParams.set("language", "fr-FR");
  } else if (route.length === 1 && route[0] === "image") {
    const path = url.searchParams.get("path");
    if (!safeImagePath(path)) return json({ error: "Image invalide." }, 400);
    try {
      const response = await fetch(`${IMAGE_HOST}${path}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json({ error: "Image indisponible." }, response.status === 404 ? 404 : 502);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) return json({ error: "Réponse image invalide." }, 502);
      return new Response(response.body, { headers: { "content-type": contentType, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    } catch {
      return json({ error: "Impossible de récupérer cette image." }, 502);
    }
  } else {
    return json({ error: "Cette opération TMDB n’est pas autorisée." }, 404);
  }

  try {
    const isV3ApiKey = /^[a-f\d]{32}$/i.test(token);
    if (isV3ApiKey) upstreamUrl.searchParams.set("api_key", token);
    const response = await fetch(upstreamUrl, {
      headers: { ...(isV3ApiKey ? {} : { Authorization: `Bearer ${token}` }), Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return json({ error: "TMDB a refusé l’authentification. Vérifiez que le jeton Read Access est actif." }, 502);
      if (response.status === 429) return json({ error: "Limite de recherches atteinte. Réessayez dans un instant." }, 429, { "retry-after": response.headers.get("retry-after") || "5" });
      return json({ error: "Le catalogue externe est temporairement indisponible." }, 502);
    }
    try {
      JSON.parse(body);
    } catch {
      return json({ error: "Réponse invalide du catalogue externe." }, 502);
    }
    return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, stale-while-revalidate=300", "x-content-type-options": "nosniff" } });
  } catch {
    return json({ error: "Connexion au catalogue impossible. Vérifiez votre réseau puis réessayez." }, 502);
  }
}
