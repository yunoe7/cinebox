import test from "node:test";
import assert from "node:assert/strict";
import {
  CHILD_PROFILE_MAX_AGE,
  filterTitlesForProfile,
  isTitleAllowedForChild,
  titleMinAge,
  selectFeaturedTitles,
} from "./child-safety.mjs";

const unclassifiedLocal = { id: 1, name: "Film local non classé", genre: "Comédie" };
const classifiedLocal = { id: 2, name: "Film local familial", genre: "Comédie", minAge: 6, ageRating: "6" };
const adultLocal = { id: 3, name: "Film local ado", genre: "Drame", minAge: 12 };
const sharedTitle = { id: 42, name: "Titre partagé", genre: "Drame" };
const classifiedShared = { id: 43, name: "Série classée", genre: "Animation", source: "shared", sharedId: "tmdb:series:1", minAge: 10 };
const unclassifiedShared = { id: 44, name: "Série non classée", genre: "Animation", source: "shared", sharedId: "tmdb:series:2" };
const adultShared = { id: 45, name: "Série adulte", genre: "Drame", source: "shared", sharedId: "tmdb:series:3", minAge: 18 };

test("1. un contenu local non classé est masqué pour un enfant (fail closed)", () => {
  assert.equal(titleMinAge(unclassifiedLocal), null);
  assert.equal(isTitleAllowedForChild(unclassifiedLocal), false);
});

test("2. un contenu D1 non classé est masqué pour un enfant (fail closed)", () => {
  assert.equal(titleMinAge(unclassifiedShared), null);
  assert.equal(isTitleAllowedForChild(unclassifiedShared), false);
});

test("3. un contenu classé dans la limite d’âge est visible pour un enfant", () => {
  assert.equal(isTitleAllowedForChild(classifiedLocal), true);
  assert.equal(isTitleAllowedForChild(classifiedShared), true);
  assert.ok(classifiedLocal.minAge <= CHILD_PROFILE_MAX_AGE);
  assert.ok(classifiedShared.minAge <= CHILD_PROFILE_MAX_AGE);
});

test("3 bis. une classification par certification est acceptée sans minAge numérique", () => {
  assert.equal(isTitleAllowedForChild({ ...unclassifiedLocal, ageRating: "TP" }), true);
  assert.equal(isTitleAllowedForChild({ ...unclassifiedLocal, ageRating: "TV-PG" }), true);
  assert.equal(isTitleAllowedForChild({ ...unclassifiedShared, ageRating: "TV-Y7" }), true);
});

test("4. un contenu au-dessus de la limite est masqué, local comme partagé", () => {
  assert.equal(isTitleAllowedForChild(adultLocal), false);
  assert.equal(isTitleAllowedForChild(adultShared), false);
});

test("4 bis. un contenu marqué adulte est toujours masqué pour un enfant", () => {
  assert.equal(isTitleAllowedForChild({ ...classifiedShared, isAdult: true }), false);
  assert.equal(isTitleAllowedForChild({ ...classifiedLocal, isAdult: true }), false);
});

test("5. un profil adulte conserve tous les contenus, y compris non classés", () => {
  const titles = [unclassifiedLocal, classifiedLocal, adultLocal, unclassifiedShared, adultShared];
  assert.equal(filterTitlesForProfile(titles, false), titles);
  assert.equal(filterTitlesForProfile([unclassifiedLocal], false).length, 1);
});

test("le filtre enfant ne conserve que les contenus classés et compatibles", () => {
  const titles = [unclassifiedLocal, classifiedLocal, adultLocal, unclassifiedShared, classifiedShared, adultShared];
  assert.deepEqual(filterTitlesForProfile(titles, true), [classifiedLocal, classifiedShared]);
});

test("aucune heuristique de mots-clés ne réautorise un contenu non classé", () => {
  const scaryButUnclassified = { id: 6, name: "Massacre au chalet", genre: "Horreur" };
  const innocentButUnclassified = { id: 7, name: "Film familial", genre: "Comédie" };
  assert.equal(isTitleAllowedForChild(scaryButUnclassified), false);
  assert.equal(isTitleAllowedForChild(innocentButUnclassified), false);
});

test("le filtre local ne plante pas sur une liste absente", () => {
  assert.deepEqual(filterTitlesForProfile(undefined, true), []);
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
  const local = [classifiedLocal];
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

test("Hero enfant : aucun repli sur le titre partagé même si la bibliothèque locale est vide", () => {
  const featured = selectFeaturedTitles({
    localFeatured: [],
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 0,
    isChildProfile: true,
  });
  assert.deepEqual(featured, []);
});

test("Hero enfant : le contenu local filtré reste utilisé", () => {
  const local = [classifiedLocal];
  const featured = selectFeaturedTitles({
    localFeatured: local,
    sharedFeaturedTitle: sharedTitle,
    localLibrarySize: 2,
    isChildProfile: true,
  });
  assert.deepEqual(featured, local);
});
