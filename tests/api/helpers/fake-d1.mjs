/**
 * Minimal in-memory D1 double for the Bunny/D1 detachment routes.
 * It implements only the statements used by delete.ts and manage.ts, and it
 * applies batch statements atomically (a thrown batch leaves the state intact).
 */
export function createFakeD1({
  titles = [],
  episodes = [],
  failBatch = false,
  skipTitleGuard = false,
  failQuery = "",
} = {}) {
  const state = {
    titles: structuredClone(titles),
    episodes: structuredClone(episodes),
  };
  const calls = [];
  const batches = [];

  function query(sql, values) {
    if (failQuery && sql.includes(failQuery)) throw new Error(`D1 query failed: ${sql}`);
    if (/SELECT id, metadata_json FROM catalog_titles WHERE metadata_json LIKE/.test(sql)) {
      const needle = String(values[0]).replaceAll("%", "");
      return state.titles
        .filter((title) => String(title.metadata_json).includes(needle))
        .map((title) => ({ id: title.id, metadata_json: title.metadata_json }));
    }
    if (/SELECT id FROM catalog_episodes WHERE stream_uid=\? LIMIT 1/.test(sql)) {
      return state.episodes
        .filter((episode) => episode.stream_uid === values[0])
        .slice(0, 1)
        .map((episode) => ({ id: episode.id }));
    }
    if (/SELECT id FROM catalog_episodes WHERE title_id=\? AND stream_uid=\? LIMIT 1/.test(sql)) {
      return state.episodes
        .filter((episode) => episode.title_id === values[0] && episode.stream_uid === values[1])
        .slice(0, 1)
        .map((episode) => ({ id: episode.id }));
    }
    if (/SELECT metadata_json FROM catalog_titles WHERE id=\?/.test(sql)) {
      return state.titles
        .filter((title) => title.id === values[0])
        .map((title) => ({ metadata_json: title.metadata_json }));
    }
    if (/SELECT id FROM catalog_titles WHERE id = \?/.test(sql)) {
      return state.titles.filter((title) => title.id === values[0]).map((title) => ({ id: title.id }));
    }
    throw new Error(`Unexpected D1 query: ${sql}`);
  }

  function apply(sql, values) {
    if (/UPDATE catalog_episodes SET stream_uid=NULL/.test(sql)) {
      const scoped = /title_id=\?/.test(sql);
      const videoId = scoped ? values[1] : values[0];
      const titleId = scoped ? values[0] : null;
      let changes = 0;
      for (const episode of state.episodes) {
        if (episode.stream_uid !== videoId) continue;
        if (scoped && episode.title_id !== titleId) continue;
        episode.stream_uid = null;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }
    if (/UPDATE catalog_titles SET metadata_json=\?/.test(sql)) {
      const [nextMetadata, id, expectedMetadata] = values;
      const title = state.titles.find((entry) => entry.id === id);
      if (!title) return { success: true, meta: { changes: 0 } };
      if (skipTitleGuard || title.metadata_json !== expectedMetadata) {
        return { success: true, meta: { changes: 0 } };
      }
      title.metadata_json = nextMetadata;
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE catalog_titles SET published=\?/.test(sql)) {
      const title = state.titles.find((entry) => entry.id === values[1]);
      if (!title) return { success: true, meta: { changes: 0 } };
      title.published = values[0];
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
    batches,
    prepare,
    async batch(statements) {
      batches.push(statements.map((statement) => ({ sql: statement.sql, values: [...statement.values] })));
      if (failBatch) throw new Error("D1 batch failed");
      return statements.map((statement) => apply(statement.sql, statement.values));
    },
  };
}

/** Installs a fetch mock and records Bunny calls. */
export function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET", headers: new Headers(init.headers) });
    return handler(String(input), init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
