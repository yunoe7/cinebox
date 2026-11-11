import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTmdbSeason,
  buildSeasonConfirmationMessage,
  buildSeasonPublishFragment,
  describeSeasonAssessment,
  planSeasonPublication,
  referenceEpisodeCountForSeason,
} from "./tmdb-season.mjs";

function episode(number, id = 1000 + number) {
  return {
    id,
    episode_number: number,
    name: `Épisode ${number}`,
    overview: `Résumé ${number}`,
    air_date: "2020-01-01",
    runtime: 24,
    still_path: `/still-${number}.jpg`,
  };
}

function makeSeason(number, episodes) {
  return {
    season_number: number,
    name: `Saison ${number}`,
    overview: `Synopsis saison ${number}`,
    air_date: "2020-01-01",
    episodes,
  };
}

function makeDetail(counts) {
  return {
    seasons: Object.entries(counts).map(([number, count]) => ({
      season_number: Number(number),
      name: `Saison ${number}`,
      episode_count: count,
    })),
  };
}

function assess(overrides = {}) {
  return assessTmdbSeason({
    season: makeSeason(1, [episode(1), episode(2)]),
    requestedSeasonNumber: 1,
    referenceEpisodeCount: 2,
    ...overrides,
  });
}

test("1. une saison complète vérifiée autorise le remplacement après confirmation", () => {
  const assessment = assess();
  assert.equal(assessment.complete, true);
  assert.equal(assessment.blocking, false);
  assert.equal(assessment.reason, "complete");
  assert.equal(assessment.episodeCount, 2);
  assert.equal(assessment.referenceEpisodeCount, 2);

  const pending = planSeasonPublication({ assessment, confirmed: false });
  assert.equal(pending.action, "confirm");
  assert.equal(pending.replaceSeason, false);

  const confirmed = planSeasonPublication({ assessment, confirmed: true });
  assert.equal(confirmed.action, "replace");
  assert.equal(confirmed.replaceSeason, true);

  const season = makeSeason(1, [episode(1), episode(2)]);
  const fragment = buildSeasonPublishFragment({ season, seasonNumber: 1, episodeNumber: 2, replaceSeason: confirmed.replaceSeason });
  assert.equal(fragment.replaceSeason, true);
  assert.deepEqual(fragment.targetEpisode, { seasonNumber: 1, episodeNumber: 2 });
  assert.equal(fragment.seasons[0].number, 1);
  assert.equal(fragment.seasons[0].episodes.length, 2);
  assert.deepEqual(fragment.seasons[0].episodes[0], {
    number: 1,
    title: "Épisode 1",
    overview: "Résumé 1",
    airDate: "2020-01-01",
    runtime: 24,
    tmdbId: 1001,
    thumbnailPath: "/still-1.jpg",
  });

  assert.equal(referenceEpisodeCountForSeason(makeDetail({ 1: 2 }), 1), 2);
  assert.equal(referenceEpisodeCountForSeason(makeDetail({ 1: 2 }), 2), null);
  assert.equal(referenceEpisodeCountForSeason(null, 1), null);
});

test("2. une saison vide ne déclenche jamais de remplacement", () => {
  const assessment = assess({ season: makeSeason(1, []), referenceEpisodeCount: 0 });
  assert.equal(assessment.complete, false);
  assert.equal(assessment.blocking, false);
  assert.equal(assessment.reason, "empty");

  const plan = planSeasonPublication({ assessment, confirmed: true });
  assert.equal(plan.action, "upsert");
  assert.equal(plan.replaceSeason, false);

  // Even a forced flag cannot turn an empty season into a destructive payload.
  const fragment = buildSeasonPublishFragment({ season: makeSeason(1, []), seasonNumber: 1, episodeNumber: 1, replaceSeason: true });
  assert.equal(fragment.replaceSeason, false);
  assert.equal(fragment.seasons[0].episodes.length, 0);
});

test("3. un nombre d’épisodes incohérent interdit le remplacement", () => {
  const assessment = assess({ season: makeSeason(1, [episode(1), episode(2), episode(3)]), referenceEpisodeCount: 10 });
  assert.equal(assessment.complete, false);
  assert.equal(assessment.blocking, false);
  assert.equal(assessment.reason, "count-mismatch");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).action, "upsert");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).replaceSeason, false);
});

test("3b. un numéro au-delà du compteur de référence bloque la publication", () => {
  const assessment = assess({
    season: makeSeason(1, [episode(1), episode(2), episode(3)]),
    referenceEpisodeCount: 2,
  });
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.reason, "number-out-of-range");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).action, "blocked");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).replaceSeason, false);
});

test("4. des numéros d’épisodes dupliqués bloquent la publication", () => {
  const assessment = assess({
    season: makeSeason(1, [episode(1), episode(1, 2002)]),
    referenceEpisodeCount: 2,
  });
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.reason, "duplicate-episode-number");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).action, "blocked");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).replaceSeason, false);
});

test("4b. des identifiants TMDB dupliqués bloquent la publication", () => {
  const assessment = assess({
    season: makeSeason(1, [episode(1, 1500), episode(2, 1500)]),
    referenceEpisodeCount: 2,
  });
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.reason, "duplicate-episode-id");
});

test("5. des identifiants TMDB manquants bloquent la publication", () => {
  for (const invalidId of [undefined, null, 0, -1, 1.5, "1001"]) {
    const assessment = assess({
      season: makeSeason(1, [episode(1), { ...episode(2), id: invalidId }]),
      referenceEpisodeCount: 2,
    });
    assert.equal(assessment.blocking, true, String(invalidId));
    assert.equal(assessment.reason, "invalid-episode-id", String(invalidId));
  }
  assert.equal(planSeasonPublication({ assessment: assess(), confirmed: true }).replaceSeason, true);
});

test("6. un numéro de saison incorrect bloque la publication", () => {
  const assessment = assess({ season: makeSeason(2, [episode(1), episode(2)]), requestedSeasonNumber: 1 });
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.reason, "season-mismatch");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).action, "blocked");
});

test("7. l’absence de compteur fiable limite la publication à l’upsert", () => {
  const assessment = assess({ referenceEpisodeCount: null });
  assert.equal(assessment.complete, false);
  assert.equal(assessment.blocking, false);
  assert.equal(assessment.reason, "missing-reference-count");
  const plan = planSeasonPublication({ assessment, confirmed: true });
  assert.equal(plan.action, "upsert");
  assert.equal(plan.replaceSeason, false);
  const fragment = buildSeasonPublishFragment({ season: makeSeason(1, [episode(1), episode(2)]), seasonNumber: 1, episodeNumber: 1, replaceSeason: plan.replaceSeason });
  assert.equal(fragment.replaceSeason, false);
});

test("8. une réponse TMDB absente ou en erreur ne peut jamais supprimer de lignes", () => {
  for (const season of [null, undefined, {}, { season_number: 1 }, { season_number: 1, episodes: null }]) {
    const assessment = assess({ season });
    assert.equal(assessment.complete, false, JSON.stringify(season));
    assert.equal(assessment.blocking, true, JSON.stringify(season));
    assert.equal(planSeasonPublication({ assessment, confirmed: true }).action, "blocked", JSON.stringify(season));
    assert.equal(planSeasonPublication({ assessment, confirmed: true }).replaceSeason, false, JSON.stringify(season));
  }
});

test("9. l’annulation de la confirmation ne produit aucun remplacement", () => {
  const assessment = assess();
  const cancelled = planSeasonPublication({ assessment, confirmed: false });
  assert.equal(cancelled.action, "confirm");
  assert.equal(cancelled.replaceSeason, false);
});

test("10. replaceSeason n’est vrai que pour une validation réussie et confirmée", () => {
  const complete = assess();
  assert.equal(planSeasonPublication({ assessment: complete, confirmed: true }).replaceSeason, true);
  assert.equal(planSeasonPublication({ assessment: complete, confirmed: false }).replaceSeason, false);

  const incomplete = assess({ referenceEpisodeCount: 5 });
  assert.equal(planSeasonPublication({ assessment: incomplete, confirmed: true }).replaceSeason, false);

  const blocked = assess({ season: makeSeason(1, [episode(1), episode(1, 2002)]) });
  assert.equal(planSeasonPublication({ assessment: blocked, confirmed: true }).replaceSeason, false);

  // A forced fragment flag is ignored when the season is empty.
  assert.equal(buildSeasonPublishFragment({ season: makeSeason(1, []), seasonNumber: 1, episodeNumber: 1, replaceSeason: true }).replaceSeason, false);
});

test("les saisons spéciales ne sont pas soumises à une continuité numérique aveugle", () => {
  const assessment = assess({
    season: makeSeason(0, [episode(2), episode(5), episode(9)]),
    requestedSeasonNumber: 0,
    referenceEpisodeCount: 3,
  });
  assert.equal(assessment.complete, true);
  assert.equal(assessment.reason, "complete");
  assert.equal(planSeasonPublication({ assessment, confirmed: true }).replaceSeason, true);
});

test("une numérotation manifestement incohérente reste bloquée hors saison spéciale", () => {
  const assessment = assess({
    season: makeSeason(1, [episode(1), episode(2), episode(3), episode(4)]),
    referenceEpisodeCount: 3,
  });
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.reason, "number-out-of-range");
});

test("les messages d’interface expliquent le remplacement et la conservation", () => {
  const complete = describeSeasonAssessment(assess());
  assert.equal(complete.tone, "safe");
  assert.match(complete.text, /remplacera le contenu D1/);
  assert.match(complete.text, /épisodes absents/);
  assert.match(complete.text, /fichiers Bunny ne seront pas supprimés/);

  const incomplete = describeSeasonAssessment(assess({ referenceEpisodeCount: 5 }));
  assert.equal(incomplete.tone, "warning");
  assert.match(incomplete.text, /upsert/);
  assert.match(incomplete.text, /conservés/);

  const blocked = describeSeasonAssessment(assess({ season: makeSeason(1, [episode(1), episode(1, 2002)]) }));
  assert.equal(blocked.tone, "danger");
  assert.equal(blocked.title, "Publication bloquée");

  const confirmation = buildSeasonConfirmationMessage({ seasonNumber: 1, episodeCount: 2 });
  assert.match(confirmation, /Saison 1|saison 1/);
  assert.match(confirmation, /2 épisodes/);
  assert.match(confirmation, /retirés de D1/);
  assert.match(confirmation, /fichiers Bunny ne seront pas supprimés/);
});
