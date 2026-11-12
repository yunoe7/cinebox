/**
 * Minimal in-memory D1 double for the shared-catalogue management route.
 * It implements only the statements used by manage.ts.
 */
export function createFakeD1({ titles = [], episodes = [] } = {}) {
  const state = {
    titles: structuredClone(titles),
    episodes: structuredClone(episodes),
  };
  const calls = [];

  function query(sql, values) {
    if (/SELECT id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at FROM catalog_titles/.test(sql)) {
      return state.titles.map((title) => ({ ...title }));
    }
    if (/SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json FROM catalog_episodes/.test(sql)) {
      return state.episodes.map((episode) => ({ ...episode }));
    }
    if (/SELECT id FROM catalog_titles WHERE id = \?/.test(sql)) {
      return state.titles.filter((title) => title.id === values[0]).map((title) => ({ id: title.id }));
    }
    throw new Error(`Unexpected D1 query: ${sql}`);
  }

  function apply(sql, values) {
    if (/UPDATE catalog_titles SET published=\?/.test(sql)) {
      const title = state.titles.find((entry) => entry.id === values[1]);
      if (!title) return { success: true, meta: { changes: 0 } };
      title.published = values[0];
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE catalog_titles SET published=0/.test(sql)) {
      const title = state.titles.find((entry) => entry.id === values[0]);
      if (!title) return { success: true, meta: { changes: 0 } };
      title.published = 0;
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE catalog_titles SET title=COALESCE/.test(sql)) {
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected D1 update: ${sql}`);
  }

  function prepare(sql) {
    const call = { sql, values: [] };
    calls.push(call);
    const statement = {
      get sql() {
        return sql;
      },
      get values() {
        return call.values;
      },
      bind(...values) {
        call.values = values;
        return statement;
      },
      async all() {
        return { success: true, results: query(sql, call.values) };
      },
      async run() {
        apply(sql, call.values);
        return { success: true };
      },
    };
    return statement;
  }

  return {
    state,
    calls,
    prepare,
  };
}
