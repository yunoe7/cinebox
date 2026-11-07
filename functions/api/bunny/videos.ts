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

export async function onRequestGet({ env }: { env: BunnyEnv }): Promise<Response> {
  const apiKey = env.BUNNY_STREAM_API_KEY;
  const libraryId = env.BUNNY_STREAM_LIBRARY_ID;
  if (!apiKey || !libraryId || !/^[0-9]{1,12}$/.test(libraryId)) {
    return json({ error: "La bibliothèque Bunny Stream n'est pas configurée." }, 503);
  }

  try {
    const response = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos?page=1&itemsPerPage=100&orderBy=date`,
      {
        headers: { AccessKey: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      return json({ error: response.status === 401 || response.status === 403
        ? "Bunny Stream a refusé l'accès à la bibliothèque."
        : "Impossible de charger les vidéos Bunny pour le moment." }, response.status === 401 || response.status === 403 ? 502 : 503);
    }

    const payload = await response.json() as {
      totalItems?: number;
      items?: Array<{
        guid?: string;
        title?: string;
        status?: number;
        length?: number;
        dateUploaded?: string;
        thumbnailFileName?: string;
        availableResolutions?: string;
      }>;
    };
    const videos = Array.isArray(payload.items) ? payload.items.flatMap((item) => {
      if (typeof item.guid !== "string" || !/^[a-f0-9-]{20,64}$/i.test(item.guid)) return [];
      return [{
        id: item.guid,
        title: typeof item.title === "string" ? item.title : "Vidéo sans titre",
        status: Number.isInteger(item.status) ? item.status : null,
        durationSeconds: typeof item.length === "number" && Number.isFinite(item.length) ? item.length : null,
        uploadedAt: typeof item.dateUploaded === "string" ? item.dateUploaded : null,
        thumbnailUrl: typeof item.thumbnailFileName === "string"
          ? `https://${env.BUNNY_STREAM_CDN_HOSTNAME || `vz-${libraryId}.b-cdn.net`}/${encodeURIComponent(item.thumbnailFileName)}`
          : null,
        availableResolutions: typeof item.availableResolutions === "string" ? item.availableResolutions : null,
      }];
    }) : [];

    return json({ libraryId, total: Number.isInteger(payload.totalItems) ? payload.totalItems : videos.length, videos });
  } catch {
    return json({ error: "Impossible de joindre Bunny Stream pour le moment." }, 503);
  }
}
