import test from "node:test";
import assert from "node:assert/strict";
import { favoriteTypeCounts, visibleFavoriteIds } from "./favorites.mjs";

const allTitles = [
  { id: 1, name: "Film familial", kind: "Film", minAge: 6 },
  { id: 2, name: "Film non classé", kind: "Film" },
  { id: 3, name: "Série", kind: "Série", minAge: 10 },
  { id: 4, name: "Série", kind: "Série", minAge: 16 },
  { id: 5, name: "Vidéo", kind: "Vidéo", ageRating: "TP" },
];

test("seuls les favoris correspondant au catalogue sont affichés et comptés", () => {
  const favorites = [1, 2, 3, 4, 5, 999];
  assert.deepEqual(visibleFavoriteIds(allTitles, favorites), [1, 2, 3, 4, 5]);
  assert.deepEqual(favoriteTypeCounts(allTitles, favorites), { Film: 2, Série: 2, Vidéo: 1, total: 5 });
  assert.deepEqual(favorites, [1, 2, 3, 4, 5, 999]);
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
  assert.deepEqual(visibleFavoriteIds([null, { id: "1" }, allTitles[0]], [1, "x", null]), [1]);
  assert.deepEqual(favoriteTypeCounts(undefined, [1]), { Film: 0, Série: 0, Vidéo: 0, total: 0 });
});

test("une liste visible vide donne des compteurs à zéro sans toucher aux favoris", () => {
  const favorites = [2, 4];
  assert.deepEqual(favoriteTypeCounts([], favorites), { Film: 0, Série: 0, Vidéo: 0, total: 0 });
  assert.deepEqual(favorites, [2, 4]);
});
