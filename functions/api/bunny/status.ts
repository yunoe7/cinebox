interface BunnyEnv {
  BUNNY_STREAM_API_KEY?: string;
  BUNNY_STREAM_LIBRARY_ID?: string;
  BUNNY_STREAM_CDN_HOSTNAME?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Read-only Bunny Stream connectivity check.
 * Never returns the API key or raw Bunny response.
 */
export async function onRequestGet({ env }: { env: BunnyEnv }): Promise<Response> {
  const apiKey = env.BUNNY_STREAM_API_KEY;
  const libraryId = env.BUNNY_STREAM_LIBRARY_ID;

  if (!apiKey || !libraryId) {
    return json({ connected: false, error: "La connexion Bunny Stream n'est pas configurée." }, 503);
  }
  if (!/^\d{1,12}$/.test(libraryId)) {
    return json({ connected: false, error: "La bibliothèque Bunny Stream est mal configurée." }, 503);
  }

  try {
    const response = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos?page=1&itemsPerPage=1`,
      {
        headers: { AccessKey: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      return json({
        connected: false,
        error: response.status === 401 || response.status === 403
          ? "Bunny Stream a refusé la clé API. Vérifiez la clé de cette bibliothèque."
          : "Bunny Stream est temporairement indisponible.",
      }, response.status === 401 || response.status === 403 ? 502 : 503);
    }

    const payload = await response.json() as { totalItems?: number; items?: unknown[] };
    return json({
      connected: true,
      libraryId,
      cdnHostname: env.BUNNY_STREAM_CDN_HOSTNAME || null,
      videoCount: Number.isInteger(payload.totalItems) ? payload.totalItems : null,
    });
  } catch {
    return json({ connected: false, error: "Impossible de joindre Bunny Stream pour le moment." }, 503);
  }
}
