import { expect, test, type Locator, type Page } from "./fixtures";

const testTitles = [
  {
    id: 91001,
    name: "Le Voyage Bleu",
    kind: "Film",
    year: 2024,
    genre: "Aventure",
    description: "Un récit de test pour parcourir la bibliothèque.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 40",
  },
  {
    id: 91002,
    name: "Signal Rouge",
    kind: "Série",
    year: 2023,
    genre: "Thriller",
    description: "Une série de test pour vérifier la recherche.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 saison",
    episodes: "1 épisode",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Premier signal" }] }],
  },
  {
    id: 91003,
    name: "Les routes du silence",
    kind: "Vidéo",
    year: 2022,
    genre: "Voyage",
    description: "Une vidéo de test pour la liste de favoris.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "18 min",
  },
];

test.beforeEach(async ({ page }) => {
  // This runs only in the fresh Playwright context, never in the user's browser profile.
  await page.addInitScript((titles) => {
    window.localStorage.setItem("cinebox-titles", JSON.stringify(titles));
    window.localStorage.setItem("cinebox-favorites", "[]");
  }, testTitles);
});

async function openUnavailableNotice(page: Page, menuItem: "S’abonner" | "Nouveautés", noticeTitle: string) {
  await page.locator("header .profile-menu-root").getByRole("button", { name: /^Compte Discord : / }).click();
  await page.getByRole("menuitem", { name: new RegExp(menuItem) }).click();
  const toast = page.locator(".app-toast");
  await expect(toast).toBeVisible();
  await expect(toast.locator("strong")).toHaveText(noticeTitle);
  return toast;
}

async function expectAutoDismissed(toast: Locator, shownAt: number) {
  await expect(toast).toBeHidden({ timeout: 6500 });
  const elapsed = Date.now() - shownAt;
  expect(elapsed).toBeGreaterThanOrEqual(4200);
  expect(elapsed).toBeLessThan(6500);
}

test("CinéBox affiche la bibliothèque", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/CinéBox/);
  await expect(page.getByRole("heading", { name: "Le Voyage Bleu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toBeVisible();
});

test("la navigation ouvre chacune des sections", async ({ page }) => {
  await page.goto("/");

  for (const section of ["Accueil", "Films", "Séries", "Vidéos", "Ma liste", "Administration"]) {
    await page.locator(".sidebar .nav-item").filter({ hasText: section }).click();
    await expect(page.locator(".nav-item.active span")).toHaveText(section);
  }
});

test("la recherche et le filtre par type ciblent les titres", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "Rechercher dans ma collection" }).fill("rouge");
  const filters = page.getByRole("group", { name: "Filtrer par type" });
  await filters.getByRole("button", { name: "Films" }).click();
  await expect(page.locator(".result-count")).toHaveText("0 TITRE");
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toHaveCount(0);

  await filters.getByRole("button", { name: "Séries" }).click();
  await expect(page.locator(".result-count")).toHaveText("1 TITRE");
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toBeVisible();
});

test("une fiche de titre peut être ouverte puis fermée", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" }).click();
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await expect(details.locator("#detail-modal-title")).toHaveText("Le Voyage Bleu");

  await details.getByRole("button", { name: "Fermer les détails" }).click();
  await expect(details).toBeHidden();
});

test("Ma liste rassemble les trois types, filtre, recherche, trie et synchronise les favoris", async ({ page }) => {
  await page.goto("/");
  for (const [section, title] of [["Films", "Le Voyage Bleu"], ["Séries", "Signal Rouge"], ["Vidéos", "Les routes du silence"]]) {
    await page.locator(".sidebar .nav-item").filter({ hasText: section }).click();
    await page.getByRole("button", { name: `Ajouter ${title} aux favoris` }).click();
  }
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  const favorites = page.locator(".ma-list-poster-grid .favorite-card");
  await expect(favorites).toHaveCount(3);
  await expect(page.getByText("3 favoris dans votre liste")).toBeVisible();
  const sort = page.getByRole("combobox", { name: "Trier mes favoris" });
  await expect(favorites.locator(".poster-open > strong")).toHaveText(["Les routes du silence", "Signal Rouge", "Le Voyage Bleu"]);
  await sort.selectOption("oldest");
  await expect(favorites.locator(".poster-open > strong")).toHaveText(["Le Voyage Bleu", "Signal Rouge", "Les routes du silence"]);
  await sort.selectOption("title");
  await expect(favorites.locator(".poster-open > strong")).toHaveText(["Le Voyage Bleu", "Les routes du silence", "Signal Rouge"]);
  const typeFilters = page.getByRole("group", { name: "Filtrer mes favoris par type" });
  await typeFilters.getByRole("button", { name: /Séries, 1 favoris/ }).click();
  await expect(favorites).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toBeVisible();
  await typeFilters.getByRole("button", { name: /Tout 3/ }).click();
  await page.getByRole("textbox", { name: "Rechercher dans ma liste" }).fill("Kyoto absent");
  await expect(favorites).toHaveCount(0);
  await expect(page.getByText("Aucun favori ne correspond à votre recherche")).toBeVisible();
  await page.getByRole("button", { name: "Effacer la recherche et les filtres" }).click();
  await expect(favorites).toHaveCount(3);
  await page.getByRole("button", { name: "Retirer Les routes du silence des favoris" }).click();
  await expect(favorites).toHaveCount(2);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("2");
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem("__cinebox_e2e_library") || "null"));
  expect(library.favorites).toEqual([91001, 91002]);
});
 
test("Ma liste vide explique comment retrouver ses coups de cœur", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();

  await expect(page.getByRole("heading", { name: "Ma liste." })).toBeVisible();
  await expect(page.getByText("0 favoris dans votre liste")).toBeVisible();
  await expect(page.getByText("Votre liste commence avec vos coups de cœur")).toBeVisible();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(0);
});

test("la notification Abonnement indisponible disparaît automatiquement", async ({ page }) => {
  await page.goto("/");
  const toast = await openUnavailableNotice(page, "S’abonner", "Abonnement indisponible");
  const shownAt = Date.now();
  await expect(toast.getByRole("button", { name: "Fermer la notification" })).toBeVisible();
  await expectAutoDismissed(toast, shownAt);
});

test("la notification Nouveautés indisponible disparaît automatiquement", async ({ page }) => {
  await page.goto("/");
  const toast = await openUnavailableNotice(page, "Nouveautés", "Nouveautés indisponible");
  const shownAt = Date.now();
  await expect(toast.getByRole("button", { name: "Fermer la notification" })).toBeVisible();
  await expectAutoDismissed(toast, shownAt);
});

test("la fermeture manuelle et prefers-reduced-motion restent pris en charge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const toast = await openUnavailableNotice(page, "S’abonner", "Abonnement indisponible");
  const closedAt = Date.now();
  await toast.getByRole("button", { name: "Fermer la notification" }).click();
  await expect(toast).toBeHidden();
  expect(Date.now() - closedAt).toBeLessThan(1500);
});

test("un nouvel affichage redémarre proprement le délai automatique", async ({ page }) => {
  await page.goto("/");
  const firstToast = await openUnavailableNotice(page, "S’abonner", "Abonnement indisponible");
  await page.waitForTimeout(3000);
  const secondToast = await openUnavailableNotice(page, "Nouveautés", "Nouveautés indisponible");
  const secondShownAt = Date.now();
  await expect(secondToast).toBeVisible();
  await page.waitForTimeout(2200);
  await expect(secondToast).toBeVisible();
  await expectAutoDismissed(secondToast, secondShownAt);
  await expect(firstToast).toBeHidden();
});

test("l’administration présente le catalogue D1 et la bibliothèque locale sans les mélanger", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  const nav = page.locator(".admin-section-nav");

  // The former local settings tab is gone: administration is D1-first.
  await expect(nav.getByRole("button")).toHaveText(["Vue d’ensemble", "Films", "Séries", "Vidéos", "Médias"]);
  await expect(nav.getByRole("button", { name: "Paramètres" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: /Tableau de bord/ })).toBeVisible();
  await expect(page.locator(".admin-overview .admin-source-badge")).toContainText("D1");
  await expect(page.locator(".admin-stats")).toContainText("catalogue partagé D1");

  // Local titles are listed apart, never merged into the D1 counters or grids.
  const legacyRows = page.locator(".admin-legacy-row");
  await expect(legacyRows).toHaveCount(3);
  await expect(legacyRows.locator(".admin-legacy-copy strong")).toHaveText([
    "Les routes du silence",
    "Signal Rouge",
    "Le Voyage Bleu",
  ]);
  await expect(page.getByRole("button", { name: "Exporter la bibliothèque locale" })).toBeVisible();

  // Each type tab is a D1 manager and no longer renders a local poster grid.
  await nav.getByRole("button", { name: "Films" }).click();
  await expect(page.getByRole("heading", { name: /Gérer les films/ })).toBeVisible();
  await expect(page.getByText("Connexion administrateur requise")).toBeVisible();
  await expect(page.locator(".admin-content-grid")).toHaveCount(0);

  await nav.getByRole("button", { name: "Séries" }).click();
  await expect(page.getByRole("heading", { name: /Gérer les séries/ })).toBeVisible();
  await expect(page.getByText("Connexion administrateur requise")).toBeVisible();

  await nav.getByRole("button", { name: "Vidéos" }).click();
  await expect(page.getByRole("heading", { name: /Gérer les vidéos/ })).toBeVisible();
  await expect(page.getByText("Connexion administrateur requise")).toBeVisible();

  await nav.getByRole("button", { name: "Médias" }).click();
  await expect(page.getByRole("heading", { name: /Médias du catalogue/ })).toBeVisible();
  await expect(page.getByText("Connexion administrateur requise")).toBeVisible();
  await expect(page.locator(".admin-content-grid")).toHaveCount(0);
  await expect(page.locator(".admin-shared-media-grid")).toHaveCount(0);
});

test("la connexion administrateur utilise un cookie HttpOnly puis se déconnecte", async ({ page }) => {
  let authenticated = false;

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated, configured: true }),
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { password?: string } | null;
    if (body?.password !== "correct horse battery staple") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Mot de passe administrateur incorrect." }),
      });
      return;
    }
    authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        // The e2e server runs on plain HTTP, so the dev cookie name is used.
        // The attributes are the ones that matter: HttpOnly and SameSite.
        "set-cookie": "cinebox_admin=e2e-session; Path=/; HttpOnly; SameSite=Strict",
      },
      body: JSON.stringify({ authenticated: true, expiresAt: Date.now() + 3600_000 }),
    });
  });

  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "set-cookie": "cinebox_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
      },
      body: JSON.stringify({ authenticated: false }),
    });
  });

  await page.route("**/api/catalog/manage", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ titles: [] }),
    });
  });

  await page.goto("/");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  await page.locator(".admin-section-nav").getByRole("button", { name: "Films" }).click();

  const panel = page.locator(".admin-shared-catalog");
  await expect(panel.getByText("Connexion administrateur requise")).toBeVisible();
  const passwordInput = panel.getByLabel("Mot de passe administrateur");

  await passwordInput.fill("mauvais mot de passe");
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await expect(panel.getByText("Mot de passe administrateur incorrect.")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await passwordInput.fill("correct horse battery staple");
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await expect(panel.getByRole("button", { name: "Déconnexion" })).toBeVisible();

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "cinebox_admin");
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Strict");
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await panel.getByRole("button", { name: "Déconnexion" }).click();
  await expect(panel.getByText("Connexion administrateur requise")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
