import { expect, test } from "@playwright/test";

test("l'export statique sert une CSP stricte et s'hydrate", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });

  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response!.headers();
  const csp = headers["content-security-policy"] || "";

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("upgrade-insecure-requests");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(headers["x-frame-options"]).toBe("DENY");

  // Every inline script present in the DOM must be covered by a hash in the
  // header that Cloudflare Pages actually served.
  const inlineHashes = await page.evaluate(async () => {
    const contents = [...document.querySelectorAll("script:not([src])")]
      .map((script) => script.textContent || "")
      .filter((text) => text.trim().length > 0);
    return Promise.all(contents.map(async (text) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const binary = String.fromCharCode(...new Uint8Array(digest));
      return `sha256-${btoa(binary)}`;
    }));
  });
  expect(inlineHashes.length).toBeGreaterThan(0);
  for (const hash of inlineHashes) {
    expect(csp).toContain(`'${hash}'`);
  }

  // Hydration works: the sidebar reacts to a click.
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.locator(".nav-item.active span")).toHaveText("Films");
  expect(cspErrors).toEqual([]);
});

test("un script inline non signé est bloqué par la CSP", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__cineboxCspProbe = 'executed';";
    document.head.appendChild(script);
  });

  const probe = await page.evaluate(
    () => (window as unknown as { __cineboxCspProbe?: string }).__cineboxCspProbe,
  );
  expect(probe).toBeUndefined();
});
