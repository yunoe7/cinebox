/**
 * Safety assessment for a TMDB season before publishing it to the shared D1
 * catalogue.
 *
 * A successful HTTP response from TMDB does not prove that a season payload is
 * complete. `replaceSeason` is destructive: every D1 episode of the targeted
 * season that is absent from the payload is deleted, while the matching Bunny
 * files stay untouched. This module therefore treats a season as replaceable
 * only when its completeness can be demonstrated from data that is already
 * available:
 *
 * - the season detail response identifies the requested season;
 * - every episode has a positive TMDB id and a valid episode number;
 * - episode ids and numbers are unique;
 * - normal seasons (number > 0) use numbers within the reference range;
 * - the episode count equals the `episode_count` of the same season in the
 *   `/tv/{id}` detail response.
 *
 * The reference count is the only reliable completeness signal exposed by the
 * TMDB endpoints already fetched by the application. The season detail
 * endpoint has no total count of its own, so a missing reference always falls
 * back to a non-destructive upsert. Specials (season 0) are never forced into a
 * 1..N numbering scheme: only uniqueness and the reference count are checked.
 *
 * Server-side limitation: `publish.ts` cannot re-prove completeness without a
 * new TMDB call or a shared proof architecture, so it only enforces the shape
 * of the payload (one non-empty season, valid unique episodes). This module is
 * therefore the completeness gate used by the Bunny panel; an authenticated
 * client that bypasses it could still request a destructive replacement of a
 * valid-looking but partial season. No client-provided "proof" field is
 * trusted by the server.
 */

const REASON_TEXT = {
  complete: "La saison TMDB est vérifiée complète.",
  empty: "La saison TMDB ne contient aucun épisode.",
  "season-missing": "La réponse TMDB de la saison est absente.",
  "invalid-requested-season": "La saison demandée est invalide.",
  "season-mismatch": "La saison renvoyée par TMDB ne correspond pas à la saison sélectionnée.",
  "season-out-of-range": "Le numéro de saison renvoyé par TMDB est hors limites.",
  "invalid-episode-list": "La liste des épisodes renvoyée par TMDB est invalide.",
  "invalid-episode": "Un épisode renvoyé par TMDB est invalide.",
  "invalid-episode-id": "Un épisode TMDB n’a pas d’identifiant valide.",
  "invalid-episode-number": "Un épisode TMDB n’a pas de numéro valide.",
  "duplicate-episode-id": "Deux épisodes TMDB partagent le même identifiant.",
  "duplicate-episode-number": "Deux épisodes TMDB partagent le même numéro.",
  "number-out-of-range": "Un numéro d’épisode dépasse le nombre d’épisodes annoncé par TMDB.",
  "missing-reference-count": "TMDB ne fournit aucun compteur d’épisodes fiable pour cette saison.",
  "count-mismatch": "Le nombre d’épisodes reçu ne correspond pas au compteur TMDB.",
};

const BLOCKING_REASONS = new Set([
  "season-missing",
  "invalid-requested-season",
  "season-mismatch",
  "season-out-of-range",
  "invalid-episode-list",
  "invalid-episode",
  "invalid-episode-id",
  "invalid-episode-number",
  "duplicate-episode-id",
  "duplicate-episode-number",
  "number-out-of-range",
]);

function normalizeReferenceCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function result({ complete = false, blocking = false, reason, episodeCount = 0, referenceEpisodeCount = null }) {
  return {
    complete,
    blocking,
    reason,
    reasons: [reason],
    episodeCount,
    referenceEpisodeCount,
    message: REASON_TEXT[reason] ?? "La saison TMDB ne peut pas être vérifiée.",
  };
}

/**
 * Assess whether a TMDB season payload is complete enough for a destructive
 * `replaceSeason` publication.
 *
 * @param {{
 *   season?: { season_number?: number; episodes?: unknown[] } | null,
 *   requestedSeasonNumber?: number,
 *   referenceEpisodeCount?: number | null,
 * }} input
 * @returns {{
 *   complete: boolean,
 *   blocking: boolean,
 *   reason: string,
 *   reasons: string[],
 *   episodeCount: number,
 *   referenceEpisodeCount: number | null,
 *   message: string,
 * }}
 */
export function assessTmdbSeason({ season, requestedSeasonNumber, referenceEpisodeCount } = {}) {
  const reference = normalizeReferenceCount(referenceEpisodeCount);

  if (!Number.isInteger(requestedSeasonNumber) || requestedSeasonNumber < 0) {
    return result({ blocking: true, reason: "invalid-requested-season", referenceEpisodeCount: reference });
  }
  if (!season || typeof season !== "object" || Array.isArray(season)) {
    return result({ blocking: true, reason: "season-missing", referenceEpisodeCount: reference });
  }
  if (!Number.isInteger(season.season_number) || season.season_number !== requestedSeasonNumber) {
    return result({ blocking: true, reason: "season-mismatch", referenceEpisodeCount: reference });
  }
  if (season.season_number > 500) {
    return result({ blocking: true, reason: "season-out-of-range", referenceEpisodeCount: reference });
  }
  if (!Array.isArray(season.episodes)) {
    return result({ blocking: true, reason: "invalid-episode-list", referenceEpisodeCount: reference });
  }

  const episodes = season.episodes;
  const episodeCount = episodes.length;
  if (episodeCount === 0) {
    return result({ reason: "empty", episodeCount, referenceEpisodeCount: reference });
  }

  const seenIds = new Set();
  const seenNumbers = new Set();
  for (const episode of episodes) {
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
      return result({ blocking: true, reason: "invalid-episode", episodeCount, referenceEpisodeCount: reference });
    }
    if (!Number.isSafeInteger(episode.id) || episode.id <= 0) {
      return result({ blocking: true, reason: "invalid-episode-id", episodeCount, referenceEpisodeCount: reference });
    }
    if (!Number.isSafeInteger(episode.episode_number) || episode.episode_number < 1 || episode.episode_number > 10000) {
      return result({ blocking: true, reason: "invalid-episode-number", episodeCount, referenceEpisodeCount: reference });
    }
    if (seenIds.has(episode.id)) {
      return result({ blocking: true, reason: "duplicate-episode-id", episodeCount, referenceEpisodeCount: reference });
    }
    if (seenNumbers.has(episode.episode_number)) {
      return result({ blocking: true, reason: "duplicate-episode-number", episodeCount, referenceEpisodeCount: reference });
    }
    seenIds.add(episode.id);
    seenNumbers.add(episode.episode_number);
  }

  // Specials (season 0) may legitimately use non-contiguous numbering, so the
  // 1..N range check only applies to normal seasons with a known reference.
  if (season.season_number > 0 && reference !== null && reference > 0) {
    if (episodes.some((episode) => episode.episode_number > reference)) {
      return result({ blocking: true, reason: "number-out-of-range", episodeCount, referenceEpisodeCount: reference });
    }
  }

  if (reference === null || reference <= 0) {
    return result({ reason: "missing-reference-count", episodeCount, referenceEpisodeCount: reference });
  }
  if (episodeCount !== reference) {
    return result({ reason: "count-mismatch", episodeCount, referenceEpisodeCount: reference });
  }

  return result({ complete: true, reason: "complete", episodeCount, referenceEpisodeCount: reference });
}

/**
 * Decide what the UI may send for an assessed season.
 *
 * - `blocked`: incoherent data, never publish.
 * - `confirm`: complete season, but the destructive action still needs an
 *   explicit user confirmation.
 * - `replace`: complete season and the user confirmed the replacement.
 * - `upsert`: completeness is not proven, publish without deleting anything.
 *
 * @param {{ assessment: ReturnType<typeof assessTmdbSeason>, confirmed?: boolean }} input
 */
export function planSeasonPublication({ assessment, confirmed = false } = {}) {
  if (!assessment || assessment.blocking) {
    return {
      action: "blocked",
      replaceSeason: false,
      reason: assessment?.reason ?? "season-missing",
      message: assessment?.message ?? REASON_TEXT["season-missing"],
    };
  }
  if (assessment.complete) {
    if (confirmed !== true) {
      return {
        action: "confirm",
        replaceSeason: false,
        reason: "confirmation-required",
        message: "La saison est vérifiée complète. Une confirmation explicite est requise avant le remplacement.",
      };
    }
    return {
      action: "replace",
      replaceSeason: true,
      reason: "complete",
      message: "La saison vérifiée sera remplacée dans le catalogue partagé.",
    };
  }
  return {
    action: "upsert",
    replaceSeason: false,
    reason: assessment.reason,
    message: "La complétude de la saison n’est pas prouvée : publication non destructive, les épisodes absents seront conservés.",
  };
}

/**
 * Build the `replaceSeason` / `targetEpisode` / `seasons` fragment of a publish
 * payload. The destructive flag is only ever true for a verified, confirmed
 * complete season with at least one episode.
 *
 * @param {{
 *   season: { name?: string; overview?: string; air_date?: string; episodes: Array<Record<string, unknown>> },
 *   seasonNumber: number,
 *   episodeNumber: number,
 *   replaceSeason?: boolean,
 * }} input
 */
export function buildSeasonPublishFragment({ season, seasonNumber, episodeNumber, replaceSeason = false } = {}) {
  const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
  const destructive = replaceSeason === true && episodes.length > 0;
  return {
    replaceSeason: destructive,
    targetEpisode: { seasonNumber, episodeNumber },
    seasons: [{
      number: seasonNumber,
      name: season?.name,
      overview: season?.overview,
      airDate: season?.air_date,
      episodes: episodes.map((episode) => ({
        number: episode.episode_number,
        title: episode.name,
        overview: episode.overview,
        airDate: episode.air_date,
        runtime: episode.runtime ?? undefined,
        tmdbId: episode.id,
        thumbnailPath: episode.still_path || null,
      })),
    }],
  };
}

/**
 * Read the reliable episode count for a season from the `/tv/{id}` detail.
 *
 * @param {{ seasons?: Array<{ season_number?: number; episode_count?: number }> } | null | undefined} detail
 * @param {number} seasonNumber
 * @returns {number | null}
 */
export function referenceEpisodeCountForSeason(detail, seasonNumber) {
  if (!detail || !Array.isArray(detail.seasons)) return null;
  const match = detail.seasons.find((season) => season?.season_number === seasonNumber);
  return normalizeReferenceCount(match?.episode_count);
}

/**
 * User-facing description of an assessment, shared by the panel and tests.
 *
 * @param {ReturnType<typeof assessTmdbSeason> | null} assessment
 * @returns {{ tone: "safe" | "warning" | "danger", title: string, text: string }}
 */
export function describeSeasonAssessment(assessment) {
  if (!assessment) {
    return {
      tone: "warning",
      title: "Saison non chargée",
      text: "Charge une saison TMDB avant de publier.",
    };
  }
  if (assessment.blocking) {
    return {
      tone: "danger",
      title: "Publication bloquée",
      text: assessment.message,
    };
  }
  if (assessment.complete) {
    return {
      tone: "safe",
      title: "Saison vérifiée complète",
      text: "La publication remplacera le contenu D1 de cette saison. Les épisodes absents de la nouvelle liste seront retirés du catalogue partagé. Les fichiers Bunny ne seront pas supprimés.",
    };
  }
  return {
    tone: "warning",
    title: "Synchronisation non destructive",
    text: `${assessment.message} La publication utilisera un upsert : les épisodes absents seront conservés. Le résultat ne doit pas être présenté comme une synchronisation complète.`,
  };
}

/** Explicit confirmation text for a destructive season replacement. */
export function buildSeasonConfirmationMessage({ seasonNumber, episodeCount } = {}) {
  const seasonLabel = seasonNumber === 0 ? "les épisodes spéciaux" : `la saison ${seasonNumber}`;
  const countLabel = Number.isSafeInteger(episodeCount) ? `${episodeCount} épisode${episodeCount === 1 ? "" : "s"}` : "les épisodes";
  return `Remplacer ${seasonLabel} dans le catalogue partagé par ${countLabel} issus de TMDB ? Les épisodes absents de cette liste seront retirés de D1. Les fichiers Bunny ne seront pas supprimés.`;
}
