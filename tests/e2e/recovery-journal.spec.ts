import { expect, test, type Page } from "@playwright/test";

const TITLES_KEY = "cinebox-titles";
const FAVORITES_KEY = "cinebox-favorites";
const RECOVERY_KEY = "cinebox-recovery";

type StoredTitle = {
  id: number;
  name: string;
  kind: "Film";
  year: number;
  genre: string;
  description: string;
  poster: string;
  progress: number;
  duration: string;
};

function title(id: number): StoredTitle {
  return {
    id,
    name: `Récupération synthétique ${id}`,
    kind: "Film",
    year: 2026,
    genre: "Fixture",
    description: `Donnée synthétique ${id}`,
    poster: "",
    progress: 0,
    duration: "1 h",
  };
}

function snapshot(raw: string | null) {
  if (raw === null) return { kind: "absent" as const };
  if (raw === "") return { kind: "empty" as const, raw };
  try { JSON.parse(raw); return { kind: "json" as const, raw }; }
  catch { return { kind: "invalid-json" as const, raw }; }
}

function journal(beforeTitles: string | null, beforeFavorites: string | null, afterTitles: string, afterFavorites: string) {
  return JSON.stringify({
    version: 1,
    state: "pending",
    keys: { titles: TITLES_KEY, favorites: FAVORITES_KEY },
    before: { titles: snapshot(beforeTitles), favorites: snapshot(beforeFavorites) },
    after: { titles: snapshot(afterTitles), favorites: snapshot(afterFavorites) },
  });
}

async function seed(page: Page, entries: { titles: string | null; favorites: string | null; recovery: string | null }, reload = true) {
  await page.goto("/");
  await page.evaluate(({ titles, favorites, recovery }) => {
    for (const [key, value] of [["cinebox-titles", titles], ["cinebox-favorites", favorites], ["cinebox-recovery", recovery]] as const) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, entries);
  if (reload) await page.reload();
}

async function rawState(page: Page) {
  return page.evaluate(() => ({
    titles: localStorage.getItem("cinebox-titles"),
    favorites: localStorage.getItem("cinebox-favorites"),
    recovery: localStorage.getItem("cinebox-recovery"),
  }));
}

test("restaure les anciennes valeurs exactes après un état partiel", async ({ page }) => {
  const originalTitle = title(74101);
  const beforeTitles = JSON.stringify([originalTitle]);
  const beforeFavorites = "[74101]";
  const afterTitles = "[]";
  const afterFavorites = "[]";
  await seed(page, {
    titles: afterTitles,
    favorites: beforeFavorites,
    recovery: journal(beforeTitles, beforeFavorites, afterTitles, afterFavorites),
  });

  await expect.poll(() => rawState(page)).toEqual({ titles: beforeTitles, favorites: beforeFavorites, recovery: null });
  await expect(page.getByRole("button", { name: `Ouvrir ${originalTitle.name}` })).toBeVisible();
});

test("reconnaît les nouvelles valeurs exactes comme commit réussi", async ({ page }) => {
  const previous = title(74102);
  const committed = title(74103);
  const beforeTitles = JSON.stringify([previous]);
  const beforeFavorites = "[74102]";
  const afterTitles = JSON.stringify([committed]);
  const afterFavorites = "[74103]";
  await seed(page, {
    titles: afterTitles,
    favorites: afterFavorites,
    recovery: journal(beforeTitles, beforeFavorites, afterTitles, afterFavorites),
  });

  await expect.poll(() => rawState(page)).toEqual({ titles: afterTitles, favorites: afterFavorites, recovery: null });
  await expect(page.getByRole("button", { name: `Ouvrir ${committed.name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Ouvrir ${previous.name}` })).toHaveCount(0);
});

test("reprend une récupération interrompue au rechargement suivant", async ({ page }) => {
  const originalTitle = title(74104);
  const beforeTitles = JSON.stringify([originalTitle]);
  const beforeFavorites = "[74104]";
  const afterTitles = "[]";
  const afterFavorites = "[]";
  const recovery = journal(beforeTitles, beforeFavorites, afterTitles, afterFavorites);
  await seed(page, { titles: afterTitles, favorites: beforeFavorites, recovery }, false);

  await page.evaluate(() => sessionStorage.setItem("cinebox-fail-recovery-once", "yes"));
  await page.addInitScript(({ beforeTitles }) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "cinebox-titles" && value === beforeTitles && sessionStorage.getItem("cinebox-fail-recovery-once") === "yes") {
        sessionStorage.removeItem("cinebox-fail-recovery-once");
        throw new DOMException("Synthetic interruption during recovery", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  }, { beforeTitles });
  await page.reload();

  await expect(page.getByText(/récupération du catalogue et des favoris reste en attente/i)).toBeVisible();
  expect(await rawState(page)).toEqual({ titles: afterTitles, favorites: beforeFavorites, recovery });

  await page.reload();
  await expect.poll(() => rawState(page)).toEqual({ titles: beforeTitles, favorites: beforeFavorites, recovery: null });
  await expect(page.getByRole("button", { name: `Ouvrir ${originalTitle.name}` })).toBeVisible();
});

test("un journal invalide conserve les valeurs et bloque l'interface", async ({ page }) => {
  const storedTitle = title(74105);
  const beforeTitles = JSON.stringify([storedTitle]);
  for (const invalidJournal of ["", "{broken"]) {
    await seed(page, { titles: beforeTitles, favorites: "[74105]", recovery: invalidJournal });
    await expect(page.getByText(/récupération du catalogue et des favoris reste en attente/i)).toBeVisible();
    expect(await rawState(page)).toEqual({ titles: beforeTitles, favorites: "[74105]", recovery: invalidJournal });
  }
});
