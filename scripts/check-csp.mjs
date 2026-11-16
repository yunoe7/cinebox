/**
 * Verifies the Content-Security-Policy generated after `next build`.
 *
 * This is the CI gate that prevents deploying an export whose `_headers` do
 * not cover every inline bootstrap/RSC script. It reads `out/_headers` and the
 * exported HTML files, then checks the security invariants:
 * - every inline script has a matching SHA-256 hash;
 * - no `'unsafe-eval'`, wildcard or data: in `script-src`;
 * - `style-src` keeps `'unsafe-inline'` (Next.js injects style attributes);
 * - framing, base-uri, form-action and object-src stay locked down.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("out");
const HEADERS_PATH = path.join(OUT_DIR, "_headers");

function fail(message) {
  console.error(`CSP check failed: ${message}`);
  process.exitCode = 1;
}

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listHtmlFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

function parseHeaders(source) {
  const directives = new Map();
  const lines = source.split(/\r?\n/);
  let rootCsp = "";
  let rootFrameOptions = "";
  let inRoot = false;
  for (const line of lines) {
    if (line.trim() === "/*") {
      inRoot = true;
      continue;
    }
    if (inRoot && /^\S/.test(line) && line.trim() !== "") {
      inRoot = false;
    }
    if (!inRoot) continue;
    const csp = line.match(/^\s*Content-Security-Policy:\s*(.+)$/i);
    if (csp) rootCsp = csp[1].trim();
    const frame = line.match(/^\s*X-Frame-Options:\s*(.+)$/i);
    if (frame) rootFrameOptions = frame[1].trim();
  }
  if (!rootCsp) return { directives, csp: "", frameOptions: rootFrameOptions };
  for (const part of rootCsp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives.set(name.toLowerCase(), values);
  }
  return { directives, csp: rootCsp, frameOptions: rootFrameOptions };
}

function hashInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((content) => content.trim().length > 0)
    .map((content) => `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`);
}

function expectDirective(directives, name, predicate, description) {
  const values = directives.get(name);
  if (!values) {
    fail(`missing ${name} directive`);
    return;
  }
  if (!predicate(values)) fail(`${name} must ${description}; got: ${values.join(" ")}`);
}

async function main() {
  let headers;
  try {
    headers = await readFile(HEADERS_PATH, "utf8");
  } catch {
    fail(`missing ${path.relative(process.cwd(), HEADERS_PATH)}. Run \`npm run build\` first.`);
    return;
  }

  const { directives, csp, frameOptions } = parseHeaders(headers);
  if (!csp) {
    fail("no Content-Security-Policy under the /* rule");
    return;
  }
  if (frameOptions.toUpperCase() !== "DENY") {
    fail(`X-Frame-Options must be DENY; got: ${frameOptions || "(missing)"}`);
  }

  expectDirective(directives, "default-src", (values) => values.includes("'self'"), "include 'self'");
  expectDirective(directives, "script-src", (values) => values.includes("'self'"), "include 'self'");
  expectDirective(directives, "script-src", (values) => !values.includes("'unsafe-eval'"), "not include 'unsafe-eval'");
  expectDirective(directives, "script-src", (values) => !values.includes("'unsafe-inline'"), "not include 'unsafe-inline'");
  expectDirective(directives, "script-src", (values) => !values.includes("*") && !values.includes("data:"), "not use wildcard or data:");
  expectDirective(directives, "script-src", (values) => values.some((value) => /^'sha256-[A-Za-z0-9+/=]+'$/.test(value)), "contain SHA-256 hashes");
  expectDirective(directives, "style-src", (values) => values.includes("'unsafe-inline'"), "keep 'unsafe-inline' for Next.js");
  expectDirective(directives, "object-src", (values) => values.includes("'none'"), "be 'none'");
  expectDirective(directives, "base-uri", (values) => values.includes("'self'"), "be 'self'");
  expectDirective(directives, "form-action", (values) => values.includes("'self'"), "be 'self'");
  expectDirective(directives, "frame-ancestors", (values) => values.includes("'none'"), "be 'none'");
  expectDirective(
    directives,
    "frame-src",
    (values) => ["https://uqload.vc", "https://vidmoly.to", "https://vidmoly.org", "https://vidmoly.biz"].every((origin) => values.includes(origin)),
    "allow the Uqload and Vidmoly player origins",
  );
  expectDirective(
    directives,
    "frame-src",
    (values) => !values.includes("*") && !values.includes("https:") && !values.includes("http:"),
    "not use a wildcard or a scheme-wide source",
  );
  expectDirective(directives, "upgrade-insecure-requests", (values) => values.length === 0, "be present");

  const allowedHashes = new Set(
    (directives.get("script-src") || [])
      .filter((value) => /^'sha256-[A-Za-z0-9+/=]+'$/.test(value))
      .map((value) => value.slice(1, -1)),
  );

  const htmlFiles = await listHtmlFiles(OUT_DIR);
  if (htmlFiles.length === 0) {
    fail("no exported HTML found in out/");
    return;
  }

  let inlineCount = 0;
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const hashes = hashInlineScripts(html);
    if (hashes.length === 0) {
      fail(`no inline script found in ${path.relative(OUT_DIR, file)} (unexpected export shape)`);
      continue;
    }
    inlineCount += hashes.length;
    for (const hash of hashes) {
      if (!allowedHashes.has(hash)) {
        fail(`${path.relative(OUT_DIR, file)} has an inline script without a CSP hash: ${hash}`);
      }
    }
  }

  if (process.exitCode) return;
  console.log(
    `CSP OK: ${allowedHashes.size} unique hash(es) cover ${inlineCount} inline script(s) across ${htmlFiles.length} HTML file(s).`,
  );
}

await main();
