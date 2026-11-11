import test from "node:test";
import assert from "node:assert/strict";
import { filterTitlesForProfile } from "./child-safety.mjs";
import { favoriteTypeCounts, visibleFavoriteIds } from "./favorites.mjs";

const familyFilm = { id: 1, name: "Film familial", kind: "Film", minAge: 6 };
const unclassifiedFilm = { id: 2, name: "Film non classé", kind: "Film" };
const allowedSeries = { id: 3, name: "Série familiale", kind: "Série", minAge: 10 };
const adultSeries = { id: 4, name: "Série adulte", kind: "Série", minAge: 16 };
const allowedVideo = { id: 5, name: "Vidéo familiale", kind: "Vidéo", ageRating: "TP" };

const allTitles = [familyFilm, unclassifiedFilm, allowedSeries, adultSeries, allowedVideo];

test("6. un favori masqué pour un enfant n’est pas affiché mais reste dans les données", () => {
  const favorites = [1, 2, 4];
  const visibleForChild = filterTitlesForProfile(allTitles, true);
  assert.deepEqual(visibleFavoriteIds(visibleForChild, favorites), [1]);
  // Le tableau d’origine n’est jamais modifié : le favori masqué est conservé.
  assert.deepEqual(favorites, [1, 2, 4]);
});

test("6 bis. un favori masqué réapparaît avec la liste complète d’un profil adulte", () => {
  const favorites = [1, 2, 4];
  const visibleForAdult = filterTitlesForProfile(allTitles, false);
  assert.deepEqual(visibleFavoriteIds(visibleForAdult, favorites), [1, 2, 4]);
});

test("7. seuls les favoris visibles sont comptés, par catégorie et au total", () => {
  const favorites = [1, 2, 3, 4, 5];
  const childCounts = favoriteTypeCounts(filterTitlesForProfile(allTitles, true), favorites);
  assert.deepEqual(childCounts, { Film: 1, Série: 1, Vidéo: 1, total: 3 });

  const adultCounts = favoriteTypeCounts(filterTitlesForProfile(allTitles, false), favorites);
  assert.deepEqual(adultCounts, { Film: 2, Série: 2, Vidéo: 1, total: 5 });
});

test("les identifiants inconnus ou en double ne gonflent pas les compteurs", () => {
  const favorites = [1, 1, 999, 3];
  assert.deepEqual(visibleFavoriteIds(allTitles, favorites), [1, 3]);
  assert.deepEqual(favoriteTypeCounts(allTitles, favorites), { Film: 1, Série: 1, Vidéo: 0, total: 2 });
});

test("l’ordre de la liste de favoris est conservé", () => {
  assert.deepEqual(visibleFavoriteIds(allTitles, [5, 1, 3]), [5, 1, 3]);
});

test("les entrées invalides sont ignorées sans erreur", () => {
  assert.deepEqual(visibleFavoriteIds(undefined, [1]), []);
  assert.deepEqual(visibleFavoriteIds(allTitles, undefined), []);
  assert.deepEqual(visibleFavoriteIds([null, { id: "1" }, familyFilm], [1, "x", null]), [1]);
  assert.deepEqual(favoriteTypeCounts(undefined, [1]), { Film: 0, Série: 0, Vidéo: 0, total: 0 });
});

test("une liste visible vide donne des compteurs à zéro sans toucher aux favoris", () => {
  const favorites = [2, 4];
  assert.deepEqual(favoriteTypeCounts([], favorites), { Film: 0, Série: 0, Vidéo: 0, total: 0 });
  assert.deepEqual(favorites, [2, 4]);
});
