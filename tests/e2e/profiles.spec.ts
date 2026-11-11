import { expect, test, type Page } from "@playwright/test";

const PROFILE_KEY = "cinebox-profiles";
const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";

type FixtureTitle = {
  id: number;
  name: string;
  kind: "Film" | "Série" | "Vidéo";
  year: number;
  genre: string;
  description: string;
  poster: string;
  progress: number;
  duration: string;
  [key: string]: unknown;
};

function film(id: number, name: string, extra: Record<string, unknown> = {}): FixtureTitle {
  return { id, name, kind: "Film", year: 2024, genre: "Aventure", description: `Profil synthétique ${id}.`, poster: "", backdrop: "", progress: 0, duration: "100 secondes", ...extra };
}

async function seed(page: Page, titles: FixtureTitle[] = [], favorites: number[] = [], assets: Array<{ key: string; contents: string; type?: string }> = []) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  });
  await page.goto("/");
  await page.evaluate(async ({ titles, favorites, assets, profileKey, dbName, storeName }) => {
    localStorage.removeItem(profileKey);
    localStorage.setItem("cinebox-titles", JSON.stringify(titles));
    localStorage.setItem("cinebox-favorites", JSON.stringify(favorites));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (assets.length) await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      for (const asset of assets) store.put(new Blob([asset.contents], { type: asset.type || "application/octet-stream" }), asset.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { titles, favorites, assets, profileKey: PROFILE_KEY, dbName: ASSET_DB, storeName: ASSET_STORE });
  await page.reload();
}

async function profiles(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), PROFILE_KEY);
}

async function currentProfileId(page: Page) {
  return (await profiles(page)).activeProfileId as string;
}

async function leaveProfile(page: Page) {
  const trigger = page.locator("header").getByRole("button", { name: /^Profil actif : / });
  await trigger.click();
  await page.getByRole("menuitem", { name: /Quitter ce profil/ }).click();
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
}

async function openProfileManagerFromGate(page: Page) {
  await page.getByRole("button", { name: "Gérer les profils" }).click();
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toBeVisible();
}

async function createProfile(page: Page, name: string, options: { avatar?: string; child?: boolean; pin?: string } = {}) {
  await leaveProfile(page);
  await openProfileManagerFromGate(page);
  await page.getByRole("button", { name: "Ajouter un profil" }).click();
  await page.getByLabel("Nom", { exact: true }).fill(name);
  if (options.avatar) await page.getByRole("button", { name: `Choisir l’avatar ${options.avatar}` }).click();
  if (options.child) await page.getByLabel(/Mode enfant/).check();
  if (options.pin) {
    await page.getByPlaceholder("4 à 8 chiffres").fill(options.pin);
    await page.getByPlaceholder("Confirmer le code").fill(options.pin);
  }
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profil créé" })).toBeVisible();
  await page.getByRole("button", { name: "Choisir un profil" }).click();
}

async function enter(page: Page, name: string, pin?: string) {
  await page.getByRole("button", { name: `Choisir le profil ${name}` }).click();
  if (pin !== undefined) {
    const input = page.getByLabel("Code PIN");
    await input.fill(pin);
    await page.getByRole("button", { name: "Continuer" }).click();
  }
}

async function openFilmPlayer(page: Page, name: string) {
  await page.getByRole("button", { name: `Ouvrir ${name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Lecture" }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  return video;
}

async function setProgress(page: Page, second: number) {
  await page.locator("video.detail-video").evaluate((element, currentTime) => {
    const video = element as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, get: () => 100 });
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => currentTime, set: () => undefined });
    video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  }, second);
}

test("la migration copie favoris et progressions historiques sans modifier les clés originales", async ({ page }) => {
  const title = film(88001, "Archive personnelle", { currentTime: 31, progress: 31, viewCount: 4, videoAssetKey: "88001:video" });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = "[88001]";
  await seed(page, [title], [88001]);

  const state = await profiles(page);
  const main = state.profiles.find((profile: { isPrimary: boolean }) => profile.isPrimary);
  expect(state.data[main.id].favorites).toEqual([88001]);
  expect(state.data[main.id].playback["88001"]).toMatchObject({ currentTime: 31, progress: 31, assetKey: "88001:video" });
  expect(state.data[main.id].viewCounts["88001"]).toBe(4);
  expect(await page.evaluate(() => localStorage.getItem("cinebox-titles"))).toBe(titlesRaw);
  expect(await page.evaluate(() => localStorage.getItem("cinebox-favorites"))).toBe(favoritesRaw);
});

test("crée un profil avec avatar puis ouvre son espace", async ({ page }) => {
  await seed(page);
  await createProfile(page, "Camille", { avatar: "Lune violette" });
  await enter(page, "Camille");
  await expect(page.locator("header").getByRole("button", { name: /^Profil actif : Camille/ })).toBeVisible();
  const state = await profiles(page);
  expect(state.profiles.some((profile: { name: string; avatarId: string }) => profile.name === "Camille" && profile.avatarId === "violet-moon")).toBe(true);
  expect(state.data[state.profiles.find((profile: { name: string }) => profile.name === "Camille").id].favorites).toEqual([]);
});

test("modifie le nom, l’avatar, le mode enfant et les préférences", async ({ page }) => {
  await seed(page);
  await createProfile(page, "Noé", { avatar: "Renard étoilé" });
  await enter(page, "Noé");
  await page.locator("header").getByRole("button", { name: /^Profil actif : Noé/ }).click();
  await page.getByRole("menuitem", { name: /^Profil/ }).click();
  await page.locator(".profile-manager-card").filter({ hasText: "Noé" }).getByRole("button", { name: "Modifier" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Noé junior");
  await page.getByRole("button", { name: "Choisir l’avatar Chat lunaire" }).click();
  await page.getByLabel(/Mode enfant/).check();
  await page.getByLabel(/Lecture automatique de l’épisode suivant/).uncheck();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const state = await profiles(page);
  const profile = state.profiles.find((item: { name: string }) => item.name === "Noé junior");
  expect(profile).toMatchObject({ avatarId: "moon-cat", isChild: true });
  expect(state.data[profile.id].preferences.autoplayNext).toBe(false);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Administration" })).toHaveCount(0);
  await expect(page.getByText(/Mode enfant : seuls les contenus dont la classification d’âge est connue et adaptée sont affichés/)).toBeVisible();
});

test("supprime un profil secondaire sans toucher à la bibliothèque partagée", async ({ page }) => {
  await seed(page, [film(88002, "Titre partagé")], [88002]);
  const legacyTitles = await page.evaluate(() => localStorage.getItem("cinebox-titles"));
  await createProfile(page, "À retirer");
  const secondaryId = (await profiles(page)).profiles.find((profile: { name: string }) => profile.name === "À retirer").id;
  await openProfileManagerFromGate(page);
  await page.getByRole("button", { name: "Supprimer le profil À retirer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Supprimer le profil" }).click();

  const state = await profiles(page);
  expect(state.profiles.some((profile: { id: string }) => profile.id === secondaryId)).toBe(false);
  expect(state.data[secondaryId]).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem("cinebox-titles"))).toBe(legacyTitles);
});

test("le profil principal n’offre pas d’action de suppression", async ({ page }) => {
  await seed(page);
  await leaveProfile(page);
  await openProfileManagerFromGate(page);
  await expect(page.getByRole("button", { name: "Supprimer le profil Principal" })).toHaveCount(0);
});

test("les profils et le dernier choix sont conservés après rechargement", async ({ page }) => {
  await seed(page);
  await createProfile(page, "Réouverture");
  await enter(page, "Réouverture");
  const before = await profiles(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
  expect((await profiles(page)).activeProfileId).toBe(before.activeProfileId);
  await enter(page, "Réouverture");
  await expect(page.locator("header").getByRole("button", { name: /^Profil actif : Réouverture/ })).toBeVisible();
});

test("la galerie recherche les avatars et navigue entre catégories", async ({ page }) => {
  await seed(page);
  await leaveProfile(page);
  await openProfileManagerFromGate(page);
  await page.getByRole("button", { name: "Ajouter un profil" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Galerie");
  const search = page.getByRole("textbox", { name: "Rechercher un avatar" });
  await search.fill("lune");
  await expect(page.getByRole("button", { name: "Choisir l’avatar Lune violette" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choisir l’avatar Renard étoilé" })).toHaveCount(0);
  await search.fill("");
  await page.getByRole("button", { name: "Animés" }).click();
  await page.getByRole("button", { name: "Choisir l’avatar Renard étoilé" }).click();
  await expect(page.locator(".profile-editor-preview").getByRole("img", { name: "Renard étoilé" })).toBeVisible();
});

test("un PIN est demandé, vérifié et stocké uniquement sous forme hachée", async ({ page }) => {
  await seed(page);
  await createProfile(page, "Verrouillé", { pin: "2468" });
  await enter(page, "Verrouillé");
  const input = page.getByLabel("Code PIN");
  await input.fill("1357");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator(".profile-pin-dialog").getByRole("alert")).toContainText("Code PIN incorrect");
  await input.fill("2468");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("header").getByRole("button", { name: /^Profil actif : Verrouillé/ })).toBeVisible();
  const state = await profiles(page);
  const locked = state.profiles.find((profile: { name: string }) => profile.name === "Verrouillé");
  expect(locked.pin.hash).not.toBe("2468");
  expect(JSON.stringify(locked.pin)).not.toContain("2468");
  expect(locked.pin.iterations).toBe(180000);
});

test("le mode enfant masque les contenus non classés et les mentions explicites", async ({ page }) => {
  await seed(page, [
    film(88003, "Titre familial", { minAge: 6, ageRating: "6" }),
    film(88010, "Titre non classé"),
    film(88004, "Archive horreur", { genre: "Horreur" }),
  ]);
  await createProfile(page, "Enfant", { child: true });
  await enter(page, "Enfant");
  await expect(page.getByRole("button", { name: "Ouvrir Titre familial" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Titre non classé" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Archive horreur" })).toHaveCount(0);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Administration" })).toHaveCount(0);
  await expect(page.getByText(/seuls les contenus dont la classification d’âge est connue et adaptée sont affichés/)).toBeVisible();
});

test("les favoris et les progressions sont isolés entre profils", async ({ page }) => {
  const title = film(88005, "Film des profils", { videoAssetKey: "88005:video" });
  await seed(page, [title], [], [{ key: "88005:video", contents: "synthetic-profile-video", type: "video/webm" }]);
  await page.getByRole("button", { name: "Ajouter Film des profils aux favoris" }).click();
  await expect.poll(async () => (await profiles(page)).data[(await currentProfileId(page))].favorites).toEqual([88005]);

  const video = await openFilmPlayer(page, title.name);
  await video.evaluate((element) => { Object.defineProperty(element, "duration", { configurable: true, get: () => 100 }); Object.defineProperty(element, "currentTime", { configurable: true, get: () => 27, set: () => undefined }); element.dispatchEvent(new Event("timeupdate", { bubbles: true })); });
  await expect.poll(async () => (await profiles(page)).data[(await currentProfileId(page))].playback["88005"]?.currentTime).toBe(27);
  await page.getByRole("button", { name: "Fermer les détails" }).click();
  await createProfile(page, "Invité");
  await enter(page, "Invité");

  expect((await profiles(page)).data[(await currentProfileId(page))].favorites).toEqual([]);
  expect((await profiles(page)).data[(await currentProfileId(page))].playback["88005"]).toBeUndefined();
  const guestVideo = await openFilmPlayer(page, title.name);
  await guestVideo.evaluate((element) => { Object.defineProperty(element, "duration", { configurable: true, get: () => 100 }); element.dispatchEvent(new Event("loadedmetadata", { bubbles: true })); });
  await expect.poll(() => guestVideo.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(0);
});

test("l’historique de visionnage est propre à chaque profil", async ({ page }) => {
  const title = film(88006, "Historique isolé", { videoAssetKey: "88006:video" });
  await seed(page, [title], [], [{ key: "88006:video", contents: "history-video", type: "video/webm" }]);
  await openFilmPlayer(page, title.name);
  await expect.poll(async () => (await profiles(page)).data[(await currentProfileId(page))].history.length).toBe(1);
  await page.getByRole("button", { name: "Fermer les détails" }).click();
  await createProfile(page, "Historique vierge");
  await enter(page, "Historique vierge");
  expect((await profiles(page)).data[(await currentProfileId(page))].history).toEqual([]);
});

test("les changements répétés de profil ne réutilisent pas les favoris d’un autre", async ({ page }) => {
  await seed(page, [film(88007, "Alternance")]);
  await page.getByRole("button", { name: "Ajouter Alternance aux favoris" }).click();
  await createProfile(page, "Secondaire");
  await enter(page, "Secondaire");
  await page.getByRole("button", { name: "Ajouter Alternance aux favoris" }).click();
  for (let cycle = 0; cycle < 2; cycle++) {
    await expect(page.getByRole("button", { name: "Retirer Alternance des favoris" })).toBeVisible();
    await leaveProfile(page);
    await enter(page, "Principal");
    await expect(page.getByRole("button", { name: "Retirer Alternance des favoris" })).toBeVisible();
    await leaveProfile(page);
    await enter(page, "Secondaire");
  }
  const state = await profiles(page);
  expect(state.data[state.profiles.find((profile: { name: string }) => profile.name === "Principal").id].favorites).toEqual([88007]);
  expect(state.data[state.profiles.find((profile: { name: string }) => profile.name === "Secondaire").id].favorites).toEqual([88007]);
});

test("le menu annonce les fonctions non disponibles sans simuler un service", async ({ page }) => {
  await seed(page);
  await page.locator("header").getByRole("button", { name: /^Profil actif : Principal/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /S’abonner.*Indisponible/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /S’abonner/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "ne dispose pas encore" })).toBeVisible();
});

test("le menu se parcourt au clavier et se ferme avec Échap ou clic extérieur", async ({ page }) => {
  await seed(page);
  const trigger = page.locator("header").getByRole("button", { name: /^Profil actif : Principal/ });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: /^Profil/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: /Quitter ce profil/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator(".brand.topbar-brand").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("le sélecteur reste utilisable sur mobile", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await leaveProfile(page);
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choisir le profil Principal" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test("les URL Blob restaurées restent lisibles après un changement de profil", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    (window as unknown as { __profileBlobRevocations: string[] }).__profileBlobRevocations = [];
    URL.revokeObjectURL = (url) => {
      (window as unknown as { __profileBlobRevocations: string[] }).__profileBlobRevocations.push(url);
      nativeRevoke(url);
    };
  });
  const title = film(88008, "Média partagé", { videoAssetKey: "88008:video" });
  await seed(page, [title], [], [{ key: "88008:video", contents: "shared-blob-content", type: "video/webm" }]);
  const video = await openFilmPlayer(page, title.name);
  const src = await video.getAttribute("src");
  expect(src).toMatch(/^blob:/);
  expect(await video.evaluate(async (element: HTMLVideoElement) => (await (await fetch(element.currentSrc)).text()))).toBe("shared-blob-content");
  await page.getByRole("button", { name: "Fermer les détails" }).click();
  await createProfile(page, "Autre lecteur");
  await enter(page, "Autre lecteur");
  const secondVideo = await openFilmPlayer(page, title.name);
  const secondSrc = await secondVideo.getAttribute("src");
  expect(secondSrc).toMatch(/^blob:/);
  expect(await page.evaluate((url) => (window as unknown as { __profileBlobRevocations: string[] }).__profileBlobRevocations.includes(url!), src)).toBe(false);
  expect(await page.evaluate(async (url) => await (await fetch(url!)).text(), secondSrc)).toBe("shared-blob-content");
});

test("un stockage de profils corrompu ne remplace pas les anciennes clés", async ({ page }) => {
  await seed(page, [film(88009, "Données protégées")], [88009]);
  const before = await page.evaluate(() => ({ titles: localStorage.getItem("cinebox-titles"), favorites: localStorage.getItem("cinebox-favorites") }));
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), PROFILE_KEY);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Profils protégés" })).toBeVisible();
  expect(await page.evaluate(() => ({ titles: localStorage.getItem("cinebox-titles"), favorites: localStorage.getItem("cinebox-favorites") }))).toEqual(before);
  expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_KEY)).toBe("{broken");
});

test("les actions de gestion d’un profil protégé exigent le PIN et le verrouillage survit au rechargement", async ({ page }) => {
  await seed(page);
  await createProfile(page, "Protégé", { pin: "2468" });
  const profileId = (await profiles(page)).profiles.find((profile: { name: string }) => profile.name === "Protégé").id as string;

  await openProfileManagerFromGate(page);
  const card = page.locator(".profile-manager-card").filter({ hasText: "Protégé" });
  await card.getByRole("button", { name: "Modifier" }).click();
  const pinDialog = page.locator(".profile-pin-dialog");
  await expect(pinDialog).toBeVisible();
  await expect(pinDialog.getByRole("heading", { name: "Profil protégé" })).toBeVisible();
  await pinDialog.getByRole("button", { name: "Annuler" }).click();
  await expect(pinDialog).toHaveCount(0);
  await expect(page.locator(".profile-editor-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Supprimer le profil Protégé" }).click();
  await expect(pinDialog).toBeVisible();
  await pinDialog.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("button", { name: "Supprimer le profil Protégé" })).toBeVisible();

  await card.getByRole("button", { name: "Modifier" }).click();
  await pinDialog.getByLabel("Code PIN").fill("0000");
  await pinDialog.getByRole("button", { name: "Continuer" }).click();
  await expect(pinDialog.getByRole("alert")).toContainText("Code PIN incorrect");
  await expect(pinDialog.getByRole("alert")).toContainText("4 tentatives restantes");

  const guardAfterFailure = await page.evaluate(() => {
    const raw = localStorage.getItem("cinebox-profile-pin-guard");
    return { raw, parsed: raw ? JSON.parse(raw) : null };
  });
  expect(guardAfterFailure.parsed.profiles[profileId].attempts).toBe(1);
  expect(guardAfterFailure.raw).not.toContain("0000");
  expect(guardAfterFailure.raw).not.toContain("2468");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-profile-pin-guard") || "null").profiles)).toMatchObject({
    [profileId]: { attempts: 1 },
  });

  await openProfileManagerFromGate(page);
  await page.locator(".profile-manager-card").filter({ hasText: "Protégé" }).getByRole("button", { name: "Modifier" }).click();
  // The guard already recorded one failure before the reload: the next three
  // wrong PINs consume the remaining attempts, then the fifth locks the profile.
  for (const remaining of [3, 2, 1]) {
    await pinDialog.getByLabel("Code PIN").fill("0000");
    await pinDialog.getByRole("button", { name: "Continuer" }).click();
    await expect(pinDialog.getByRole("alert")).toContainText(`${remaining} tentative${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"}`);
  }
  await pinDialog.getByLabel("Code PIN").fill("0000");
  await pinDialog.getByRole("button", { name: "Continuer" }).click();
  await expect(pinDialog.getByRole("alert")).toContainText("Trop de tentatives");
  const locked = await page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-profile-pin-guard") || "null"));
  expect(locked.profiles[profileId].attempts).toBe(5);
  expect(locked.profiles[profileId].lockedUntil).toBeGreaterThan(Date.now());

  await page.reload();
  await openProfileManagerFromGate(page);
  await page.locator(".profile-manager-card").filter({ hasText: "Protégé" }).getByRole("button", { name: "Modifier" }).click();
  await expect(page.locator(".profile-pin-dialog").getByRole("alert")).toContainText("Trop de tentatives");
  await page.locator(".profile-pin-dialog").getByLabel("Code PIN").fill("2468");
  await page.locator(".profile-pin-dialog").getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator(".profile-pin-dialog")).toBeVisible();
  await expect(page.locator(".profile-pin-dialog").getByRole("alert")).toContainText("Trop de tentatives");
  await expect(page.locator(".profile-editor-panel")).toHaveCount(0);

  // Simulate the end of the lockout window, then the correct PIN must work.
  await page.evaluate(() => {
    const key = "cinebox-profile-pin-guard";
    const guard = JSON.parse(localStorage.getItem(key) || "null");
    for (const id of Object.keys(guard.profiles)) guard.profiles[id].lockedUntil = Date.now() - 1000;
    localStorage.setItem(key, JSON.stringify(guard));
  });
  await page.reload();
  await openProfileManagerFromGate(page);
  await page.locator(".profile-manager-card").filter({ hasText: "Protégé" }).getByRole("button", { name: "Modifier" }).click();
  await page.locator(".profile-pin-dialog").getByLabel("Code PIN").fill("2468");
  await page.locator(".profile-pin-dialog").getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator(".profile-editor-panel").getByRole("heading", { name: "Modifier le profil" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("cinebox-profile-pin-guard"))).toBeNull();
});

test("les dialogues imbriqués conservent le verrouillage du fond et le piège de focus", async ({ page }) => {
  await seed(page);
  const trigger = page.locator("header").getByRole("button", { name: /^Profil actif : / });
  await trigger.click();
  await page.getByRole("menuitem", { name: /^Profil/ }).click();
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.getByRole("button", { name: "Ajouter un profil" }).click();
  const editor = page.locator(".profile-editor-panel");
  await expect(editor.getByRole("heading", { name: "Nouveau profil" })).toBeVisible();
  await expect(page.getByLabel("Nom", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un profil" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("le gestionnaire ouvert depuis « Qui regarde ? » active le comportement modal et restaure le focus", async ({ page }) => {
  await seed(page);
  await leaveProfile(page);
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();

  await page.getByRole("button", { name: "Gérer les profils" }).click();
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  // The original trigger is unmounted while the manager is open: the fallback
  // must focus the re-rendered gate control instead of leaving focus on body.
  await expect(page.getByRole("button", { name: "Gérer les profils" })).toBeFocused();
});

test("fermer le gestionnaire ouvert depuis le menu profil restaure le focus sur le déclencheur", async ({ page }) => {
  await seed(page);
  const trigger = page.locator("header").getByRole("button", { name: /^Profil actif : / });
  await trigger.click();
  await page.getByRole("menuitem", { name: /^Profil/ }).click();
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Gérer les profils" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
