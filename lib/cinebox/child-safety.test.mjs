import test from "node:test";
import assert from "node:assert/strict";
import {
  canShowSharedCatalog,
  filterTitlesForProfile,
  isChildRestrictedTitle,
  selectFeaturedTitles,
} from "./child-safety.mjs";

const familyFilm = { id: 1, name: "Film familial", genre: "Comédie" };
const restrictedFilm = { id: 2, name: "Massacre", genre: "Horreur" };
const sharedTitle = { id: 42, name: "Titre partagé", genre: "Drame" };

test("le catalogue partagé est visible pour un profil adulte", () => {
  assert.equal(canShowSharedCatalog(false), true);
});

test("le catalogue partagé est masqué pour un profil enfant", () => {
  assert.equal(canShowSharedCatalog(true), false);
});

test("le filtre local laisse le catalogue intact pour un adulte", () => {
  const titles = [familyFilm, restrictedFilm];
  assert.equal(filterTitlesForProfile(titles, false), titles);
});

test("le filtre local retire les mentions explicites pour un enfant", () => {
  assert.deepEqual(filterTitlesForProfile([familyFilm, restrictedFilm], true), [familyFilm]);
});

test("le filtre local ne plante pas sur une liste absente", () => {
  assert.deepEqual(filterTitlesForProfile(undefined, true), []);
});

test("la détection enfant reste une heuristique de mots-clés", () => {
  assert.equal(isChildRestrictedTitle(restrictedFilm), true);
  assert.equal(isChildRestrictedTitle(familyFilm), false);
  // Limite documentée : un titre sans mention explicite est considéré comme sûr.
  assert.equal(isChildRestrictedTitle({ name: "Massacre au chalet", genre: "Drame" }), false);
});

test("Hero adulte : repli sur le titre partagé quand la bibliothèque locale est vide", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 0,
    isChildProfile: false,
  });
  assert.deepEqual(featured, [sharedTitle]);
});

test("Hero adulte : pas de repli partagé quand la bibliothèque locale contient des titres", () => {
  const local = [familyFilm];
  const featured = selectFeaturedTitles({
    localFeatured: local,
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 1,
    isChildProfile: false,
  });
  assert.deepEqual(featured, local);
});

test("Hero adulte : bibliothèque vide et aucun titre partagé donne un Hero vide", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: null,
    localLibrarySize: 0,
    isChildProfile: false,
  });
  assert.deepEqual(featured, []);
});

test("Hero adulte : une bibliothèque non vide sans titre à la une ne déclenche pas le repli partagé", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 3,
    isChildProfile: false,
  });
  assert.deepEqual(featured, []);
});

test("Hero enfant : aucun repli sur le titre partagé même si la bibliothèque locale est vide", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 0,
    isChildProfile: true,
  });
  assert.deepEqual(featured, []);
});

test("Hero enfant : une bibliothèque locale entièrement filtrée ne déclenche pas le repli partagé", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 3,
    isChildProfile: true,
  });
  assert.deepEqual(featured, []);
});

test("Hero enfant : le contenu local filtré reste utilisé", () => {
  const local = [familyFilm];
  const featured = selectFeaturedTitles({
    localFeatured: local,
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 2,
    isChildProfile: true,
  });
  assert.deepEqual(featured, local);
});

test("Hero enfant : aucun contenu local et aucun partagé donne un Hero vide", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: null,
    localLibrarySize: 0,
    isChildProfile: true,
  });
  assert.deepEqual(featured, []);
});
