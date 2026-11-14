/**
 * In-memory D1 double for the public catalogue routes.
 *
 * It evaluates the visibility predicate that the route generates (the SQL
 * text itself) against the seeded rows, so a test proves both the SQL text and
 * the resulting audience. It also implements the session, VIP-membership and
 * admin lookups used by `getAccount` / `isAdminAccount`.
 */
export function createCatalogD1({
  titles = [],
  episodes = [],
  sources = [],
  account = null,
  vip = false,
  admin = false,
} = {}) {
  const state = {
    titles: structuredClone(titles),
    episodes: structuredClone(episodes),
    sources: structuredClone(sources),
    account,
    vip,
    admin,
  };
  const calls = [];

  function isEntitled(sql) {
    // Both VIP-exclusive and valid premiere rows are visible in the catalogue;
    // /api/catalog/access and the response sanitiser enforce playback rights.
    return (row) => {
      const exclusive = Number(row.vip_exclusive || 0) === 1;
      if (exclusive) return true;
      const early = Number(row.vip_early_access || 0) === 1;
      if (!early) return true;
      const publicAtMs = typeof row.public_at === "string" ? Date.parse(row.public_at) : NaN;
      return Number.isFinite(publicAtMs);
    };
  }

  function query(sql, values) {
    if (/FROM account_sessions s JOIN users u/.test(sql)) {
      return state.account ? [{ ...state.account }] : [];
    }
    if (/FROM vip_memberships/.test(sql)) {
      return state.vip ? [{ active: 1 }] : [];
    }
    if (/FROM users u LEFT JOIN auth_identities/.test(sql)) {
      return state.admin ? [{ allowed: 1 }] : [];
    }

    if (/FROM catalog_media_sources/.test(sql)) {
      const ids = String(sql).includes("title_id IN")
        ? values.filter((value) => typeof value === "string")
        : [values[0]];
      return state.sources.filter((source) => ids.includes(source.title_id)).map((source) => ({ ...source }));
    }

    if (/FROM catalog_episodes/.test(sql) && /COUNT\(\*\) AS episodes/.test(sql)) {
      const predicate = isEntitled(sql);
      const count = state.episodes.filter((episode) => {
        const title = state.titles.find((entry) => entry.id === episode.title_id);
        return title && Number(title.published) === 1 && predicate(title);
      }).length;
      return [{ episodes: count }];
    }

    if (/FROM catalog_episodes/.test(sql) && sql.includes("title_id IN")) {
      const ids = values.filter((value) => typeof value === "string");
      return state.episodes
        .filter((episode) => ids.includes(episode.title_id))
        .map((episode) => ({ ...episode }));
    }
    if (/FROM catalog_episodes/.test(sql) && sql.includes("title_id=?")) {
      return state.episodes
        .filter((episode) => episode.title_id === values[0])
        .map((episode) => ({ ...episode }));
    }

    if (/FROM catalog_titles/.test(sql) && /COUNT\(\*\) AS titles/.test(sql)) {
      const predicate = isEntitled(sql);
      const visible = state.titles.filter((title) => Number(title.published) === 1 && predicate(title));
      return [{
        titles: visible.length,
        films: visible.filter((title) => title.kind === "movie").length,
        series: visible.filter((title) => title.kind === "series").length,
        videos: visible.filter((title) => title.kind === "video").length,
      }];
    }

    if (/FROM catalog_titles/.test(sql) && sql.includes("WHERE id=?")) {
      return state.titles
        .filter((title) => title.id === values[0] && Number(title.published) === 1)
        .map((title) => ({ ...title }));
    }

    if (/FROM catalog_titles/.test(sql)) {
      const predicate = isEntitled(sql, values);
      let rows = state.titles.filter((title) => Number(title.published) === 1 && predicate(title));
      if (sql.includes("kind=?")) {
        const kindIndex = values.findIndex((value) => value === "movie" || value === "series" || value === "video");
        if (kindIndex >= 0) rows = rows.filter((title) => title.kind === values[kindIndex]);
      }
      return rows.map((title) => ({ ...title }));
    }

    throw new Error(`Unexpected D1 query: ${sql}`);
  }

  function prepare(sql) {
    const call = { sql, values: [] };
    calls.push(call);
    return {
      bind(...values) { call.values = values; return this; },
      async all() { return { success: true, results: query(sql, call.values) }; },
      async first() { return query(sql, call.values)[0] ?? null; },
      async run() { return { success: true }; },
    };
  }

  return { state, calls, prepare };
}

/** Rows shaped like the `catalog_titles` table. */
export function catalogTitle(overrides = {}) {
  return {
    id: "tmdb:movie:1",
    kind: "movie",
    title: "Titre",
    overview: "",
    release_date: "2024-01-01",
    poster_path: null,
    backdrop_path: null,
    genres_json: "[]",
    metadata_json: "{}",
    published: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
    vip_exclusive: 0,
    vip_early_access: 0,
    public_at: null,
    ...overrides,
  };
}

export const ACCOUNT = {
  id: "user-1",
  display_name: "Test User",
  role: "user",
  email: null,
  expires_at: "2999-01-01T00:00:00.000Z",
};
