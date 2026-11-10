/**
 * Generates the PBKDF2 verifier stored in `CINEBOX_ADMIN_PASSWORD_HASH`.
 *
 * The password is read from `CINEBOX_ADMIN_PASSWORD` when set, otherwise from
 * a hidden interactive prompt. The password is never printed, logged or sent
 * anywhere; only the derived verifier is written to stdout.
 *
 * Usage:
 *   node scripts/hash-admin-password.mjs
 *   CINEBOX_ADMIN_PASSWORD='...' node scripts/hash-admin-password.mjs
 */
import {
  ADMIN_PASSWORD_ITERATIONS_DEFAULT,
  ADMIN_PASSWORD_MIN_LENGTH,
  hashAdminPassword,
} from "../lib/cinebox/admin-auth.mjs";

async function promptHidden(question) {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Aucun terminal interactif. Définis CINEBOX_ADMIN_PASSWORD pour fournir le mot de passe.",
    );
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

const fromEnvironment = typeof process.env.CINEBOX_ADMIN_PASSWORD === "string";
const password = fromEnvironment
  ? process.env.CINEBOX_ADMIN_PASSWORD
  : await promptHidden("Mot de passe administrateur (saisie masquée) : ");

if (typeof password !== "string" || password.length < ADMIN_PASSWORD_MIN_LENGTH) {
  console.error(`Le mot de passe doit contenir au moins ${ADMIN_PASSWORD_MIN_LENGTH} caractères.`);
  process.exit(1);
}
if (password.length > 1024) {
  console.error("Le mot de passe ne doit pas dépasser 1024 caractères.");
  process.exit(1);
}

const hash = await hashAdminPassword(password, {
  iterations: ADMIN_PASSWORD_ITERATIONS_DEFAULT,
});

console.log("");
console.log("Ajoute cette valeur aux variables serveur Cloudflare Pages");
console.log("(Settings > Environment variables > Production et Preview) :");
console.log("");
console.log(`CINEBOX_ADMIN_PASSWORD_HASH=${hash}`);
console.log("");
console.log("Ne committe jamais cette valeur et ne la colle pas dans une conversation.");
