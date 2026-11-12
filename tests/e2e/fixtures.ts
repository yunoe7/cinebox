import { test as base, expect, chromium, type Page, type Locator, type Download, type BrowserContext } from "@playwright/test";

/**
 * Browser-only account API simulator for UI E2E tests.
 *
 * Production authentication and D1 remain covered by tests/integration and
 * tests/api. This fixture keeps UI tests deterministic while exercising the
 * current account-library contract instead of relying on Pages Functions
 * being available in Next's development server.
 */
async function installAccountApi(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const readJson = <T>(key: string, fallback: T): T => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };
    const writeJson = (key: string, value: unknown) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    };
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const url = new URL(requestUrl, window.location.href);
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

      if (url.pathname === "/api/account/session") {
        return response({
          authenticated: true,
          user: {
            id: "e2e-user",
            displayName: "Compte de test",
            email: null,
            role: "user",
            discord: { username: "cinebox-e2e", globalName: "CinéBox E2E", avatarUrl: null },
          },
        });
      }

      if (url.pathname === "/api/account/library") {
        const revision = Number(window.localStorage.getItem("__cinebox_e2e_revision") || "0");
        if (method === "GET") {
          const library = readJson<Record<string, unknown> | null>("__cinebox_e2e_library", null) || {
            version: 1,
            titles: readJson<unknown[]>("cinebox-titles", []),
            favorites: readJson<number[]>("cinebox-favorites", []),
            playback: {}, history: [], viewCounts: {}, preferences: { autoplayNext: true },
          };
          return response({ library, revision });
        }

        if (method === "PUT") {
          let body: { library?: Record<string, unknown>; revision?: number } = {};
          try {
            body = JSON.parse(String(init?.body || "{}")) as typeof body;
          } catch {
            return response({ error: "invalid-json" }, 400);
          }
          if (!body.library || !Number.isSafeInteger(body.revision)) return response({ error: "invalid-library" }, 400);
          const nextRevision = revision + 1;
          writeJson("cinebox-titles", body.library.titles || []);
          writeJson("cinebox-favorites", body.library.favorites || []);
          writeJson("__cinebox_e2e_library", body.library);
          window.localStorage.setItem("__cinebox_e2e_revision", String(nextRevision));
          return response({ saved: true, revision: nextRevision });
        }
      }

      return originalFetch(input, init);
    };
  });
}

export const test = base.extend<{ accountApi: void }>({
  accountApi: [async ({ page }, use) => {
    await installAccountApi(page);
    await use();
  }, { auto: true }],
});

export { expect, chromium };
export type { Page, Locator, Download, BrowserContext };
