/**
 * Generates the Content-Security-Policy for the static export.
 *
 * Next.js emits several inline bootstrap/RSC scripts in every exported HTML
 * file. Their contents change on every build, so the CSP is produced after
 * `next build` from the exact bytes that Cloudflare Pages will serve.
 *
 * The generated policy is written to `out/_headers`; `public/_headers` stays
 * the human-editable template and never contains build-specific hashes.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("out");
const HEADERS_PATH = path.join(OUT_DIR, "_headers");

export function extractInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((content) => content.trim().length > 0);
}

export function hashInlineScripts(html) {
  return extractInlineScripts(html).map((content) =>
    `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`,
  );
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

export function buildPolicy(hashes) {
  const scriptHashes = [...new Set(hashes)].sort().map((hash) => `'${hash}'`).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://image.tmdb.org https://cdn.discordapp.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob: data:",
    "frame-src https://uqload.vc https://uqload.com https://uqload.is https://uqload.co https://vidmoly.to https://vidmoly.org https://vidmoly.biz https://vidmoly.net https://vidmoly.me https://vidmoly.com",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function alignHeaders(source, policy) {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*Content-Security-Policy:/i.test(line))
    .map((line) => (/^\s*X-Frame-Options:/i.test(line) ? `${line.match(/^\s*/)[0]}X-Frame-Options: DENY` : line));

  const hasFrameOptions = lines.some((line) => /^\s*X-Frame-Options:/i.test(line));
  const rootIndex = lines.findIndex((line) => line.trim() === "/*");
  const additions = [];
  if (!hasFrameOptions) additions.push("  X-Frame-Options: DENY");
  additions.push(`  Content-Security-Policy: ${policy}`);

  if (rootIndex >= 0) {
    lines.splice(rootIndex + 1, 0, ...additions);
  } else {
    lines.push("/*", ...additions);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main() {
  const htmlFiles = await listHtmlFiles(OUT_DIR);
  if (htmlFiles.length === 0) throw new Error("No exported HTML found in out/.");

  const hashes = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const fileHashes = hashInlineScripts(html);
    if (fileHashes.length === 0) throw new Error(`No inline script found in ${path.relative(OUT_DIR, file)}.`);
    hashes.push(...fileHashes);
  }

  const uniqueHashes = [...new Set(hashes)];
  const policy = buildPolicy(uniqueHashes);
  const headers = await readFile(HEADERS_PATH, "utf8");
  await writeFile(HEADERS_PATH, alignHeaders(headers, policy), "utf8");

  console.log(`CSP generated: ${uniqueHashes.length} unique inline-script hashes across ${htmlFiles.length} HTML file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
