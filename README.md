# CinéBox

Application personnelle de cinéma : catalogue de films, séries et vidéos, fiches détaillées, lecture vidéo, progression, favoris, profils et administration.

- **Frontend** : Next.js 15, React 19, TypeScript, Motion (Framer Motion), Lucide.
- **Hébergement** : Cloudflare Pages (export statique `out/`).
- **API** : Cloudflare Pages Functions (`functions/api/*`).
- **Catalogue partagé** : Cloudflare D1 (`migrations/0001_shared_catalog.sql`).
- **Vidéo** : Bunny Stream (lecteur et API serveur).
- **Métadonnées** : TMDB via un proxy serveur en lecture seule.

> Le dépôt GitHub est privé. Ne jamais le rendre public. Ne jamais pousser directement sur `main` sans validation.

## Prérequis

- **Node.js 22 LTS** recommandé pour Cloudflare Pages. Wrangler `4.158.0` est épinglé en dépendance de développement et exige Node.js `>= 22.0.0`.
- npm 10+.
- Un projet Cloudflare Pages avec un binding D1 nommé **`DB`**.
- Un compte TMDB avec un jeton Read Access.
- Une bibliothèque Bunny Stream (facultatif pour le catalogue local).

## Installation

```bash
npm install
```

Créer les fichiers d'environnement locaux à partir de l'exemple :

```bash
cp .env.example .env.local   # Next.js (build / variables locales)
cp .env.example .dev.vars    # Wrangler / Pages Functions (ignoré par Git)
```

Renseigner ensuite les valeurs. Ne jamais committer `.env.local`, `.dev.vars` ni un vrai jeton.

### Variables serveur

| Variable | Rôle | Obligatoire |
| --- | --- | --- |
| `TMDB_READ_ACCESS_TOKEN` | Jeton TMDB (v4) ou clé v3, utilisé par le proxy `/api/tmdb` | Pour TMDB |
| `CINEBOX_ADMIN_PASSWORD_HASH` | Vérificateur PBKDF2 du mot de passe admin, généré par `npm run hash:admin` | Pour l'administration |
| `CINEBOX_SESSION_SECRET` | Secret HMAC des sessions signées, **32 caractères minimum** | Pour l'administration |
| `BUNNY_STREAM_API_KEY` | Clé API Bunny Stream | Pour Bunny |
| `BUNNY_STREAM_LIBRARY_ID` | Identifiant de la bibliothèque Bunny | Pour Bunny |
| `BUNNY_STREAM_CDN_HOSTNAME` | Hostname CDN Bunny | Pour la lecture Bunny |
| `DB` | Binding D1 Cloudflare (configuré dans Pages, pas dans `.env`) | Pour le catalogue partagé |

Générer le vérificateur sans jamais afficher le mot de passe :

```bash
npm run hash:admin
# ou, pour un script non interactif :
CINEBOX_ADMIN_PASSWORD='...' npm run hash:admin
```

Générer le secret de session :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Développement

```bash
npm run dev
```

`next dev` sert uniquement l'interface : les routes `/api/*` (Pages Functions) ne sont **pas** disponibles.

Pour tester l'interface **et** les Pages Functions :

```bash
npm run dev:cf
```

Cette commande construit l'export statique puis lance `wrangler pages dev out` avec le binaire local épinglé (`wrangler@4.158.0`). Pour disposer de D1 en local, ajouter le binding :

```bash
npx wrangler pages dev out --port 3000 --compatibility-date=2024-01-01 --d1=DB=<database-id>
```

`npx` résout d'abord le Wrangler installé dans `node_modules`, ce qui garantit la même version que `npm run dev:cf`.

Ou copier `wrangler.toml.example` vers `wrangler.toml` et décommenter le bloc D1.

## Vérifications

```bash
npm run typecheck   # TypeScript strict
npm test            # tests Node (API, authentification, logique, stockage)
npm run build       # build de production + export statique
npm run test:e2e    # Playwright (interface réelle)
```

Les tests Playwright nécessitent Chromium : `npx playwright install chromium`. Ils démarrent automatiquement `next dev` sur `http://127.0.0.1:3100`.

## Cloudflare Pages

Configuration du projet Pages :

- **Commande de build** : `npm run build`
- **Répertoire de sortie** : `out`
- **Version de Node** : 22
- **Binding D1** : `DB` → base du catalogue partagé
- **Variables d'environnement** : `TMDB_READ_ACCESS_TOKEN`, `CINEBOX_ADMIN_PASSWORD_HASH`, `CINEBOX_SESSION_SECRET`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_CDN_HOSTNAME`

Configurer ces variables dans **Production** et **Preview**. Ne jamais coller les valeurs dans une conversation, un ticket ou un commit. `CINEBOX_ADMIN_PASSWORD_HASH` et `CINEBOX_SESSION_SECRET` sont lus uniquement par les Pages Functions.

Les Pages Functions sont détectées automatiquement dans `functions/`.

### Authentification administrateur

- `POST /api/auth/login` vérifie le mot de passe avec PBKDF2-SHA256 (100 000 itérations, plafond imposé par Cloudflare Workers) puis émet un cookie `__Host-cinebox_admin` : `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`.
- Un mot de passe incorrect renvoie `401`. Une erreur cryptographique ou interne renvoie `500` avec un message générique, sans jamais journaliser le mot de passe, le vérificateur ni le sel.
- La session est signée en HMAC-SHA256 et expire au bout de 12 heures maximum. Aucun jeton n'est stocké dans `sessionStorage` ni lisible par JavaScript.
- `POST /api/auth/logout` efface le cookie. `GET /api/auth/session` renvoie l'état de la session sans jamais exposer sa valeur.
- Les requêtes mutantes exigent une `Origin` exacte, `Sec-Fetch-Site: same-origin` lorsqu'il est présent, et l'en-tête `x-cinebox-request: 1`. Les anciens jetons Bearer sont refusés.
- Si `CINEBOX_ADMIN_PASSWORD_HASH` ou `CINEBOX_SESSION_SECRET` manque, les routes admin répondent `503` et n'écrivent rien.

**Rate limiting** : la limitation du bruteforce doit être configurée dans Cloudflare (WAF > Rate limiting rules) sur `POST /api/auth/login`, par exemple 10 requêtes par minute et par IP avec blocage ou challenge. Aucune table D1 n'est nécessaire. Valider le seuil et l'action dans l'environnement Cloudflare avant activation. Une règle WAF peut également restreindre `/api/auth/*` et `/api/catalog/manage` aux pays ou réseaux attendus.

### Migrations D1

La migration initiale se trouve dans `migrations/0001_shared_catalog.sql`. Elle crée les tables `users`, `admin_allowlist`, `catalog_titles`, `catalog_episodes`, `media_assets`, `user_favorites`, `user_progress`, `watch_history` et les index associés.

> `media_assets` est préparée pour un futur suivi multi-fournisseurs. Le flux Bunny actuel utilise `catalog_episodes.stream_uid` et `catalog_titles.metadata_json.bunnyVideoId` ; ne pas modifier la migration déjà appliquée. Toute évolution doit passer par une nouvelle migration D1 validée.

```bash
# Base locale Wrangler
npx wrangler d1 migrations apply <nom-ou-binding-d1> --local

# Base distante (à exécuter explicitement, jamais depuis un test)
npx wrangler d1 migrations apply <nom-ou-binding-d1> --remote
```

Ne jamais lancer de migration ni d'écriture sur la base de production sans validation explicite.

## Bunny Stream

1. Créer une bibliothèque Bunny Stream.
2. Renseigner `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_LIBRARY_ID` et `BUNNY_STREAM_CDN_HOSTNAME` côté serveur.
3. Les routes `/api/bunny/status`, `/api/bunny/videos` et `/api/bunny/delete` exigent une session administrateur valide (cookie `HttpOnly` signé).
4. La suppression d'une vidéo Bunny est définitive et réservée à l'administration.

## TMDB

Le proxy `/api/tmdb` est en lecture seule. Il limite la longueur des recherches, valide les identifiants et les chemins d'image, et ne renvoie jamais le jeton au navigateur. Les routes autorisées sont : recherche, détails film/série, critiques et saisons.

## Architecture

```text
app/
  layout.tsx
  page.tsx                  Interface principale (état, navigation, administration)
  globals.css               Styles CinéBox
  error.tsx                 Error Boundary
components/
  cinebox/                  Composants métier
  magicui/                  Adaptations Magic UI (CSS natif, sans Tailwind)
  ui/                       Surfaces et primitives partagées
functions/api/
  catalog/                  Catalogue public, gestion admin, publication
  bunny/                    Statut, vidéos et suppression Bunny
  tmdb/[[path]].ts          Proxy TMDB
lib/cinebox/                Logique testable (.mjs) et types
migrations/                 Schéma D1
tests/                      Tests Node et Playwright
```

## Sécurité

- Les jetons restent côté serveur ; seules les variables `NEXT_PUBLIC_*` seraient exposées, et il n'y en a pas.
- Les routes d'écriture admin vérifient un cookie `HttpOnly` signé en HMAC-SHA256, avec une durée de vie de 12 heures maximum. Aucun ancien jeton Bearer n'est accepté.
- Le mot de passe administrateur n'est jamais stocké : seul un vérificateur PBKDF2-SHA256 salé est conservé dans `CINEBOX_ADMIN_PASSWORD_HASH`.
- Les requêtes mutantes admin sont protégées contre le CSRF par `SameSite=Strict`, un contrôle exact de l'`Origin`, `Sec-Fetch-Site` et l'en-tête `x-cinebox-request`.
- Les routes publiques du catalogue sont en lecture seule et ne renvoient que les titres publiés.
- Les données personnelles (favoris, progression, profils) restent dans `localStorage` / IndexedDB tant qu'une migration vérifiée n'est pas disponible.
- Aucun système de connexion Discord n'est encore intégré. Ne pas exposer d'écriture publique.
- Le navigateur ne conserve aucun jeton admin dans `sessionStorage` ou `localStorage` : la session vit exclusivement dans un cookie `HttpOnly`. La déconnexion efface ce cookie.
- Aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` n'est utilisé dans le code source. Les contenus distants (TMDB, D1) sont rendus via React, qui échappe le texte.
- `public/_headers` applique `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY` et HSTS. `npm run build` génère ensuite la CSP SHA-256 dans `out/_headers` ; `npm run check:csp` vérifie que chaque script inline est couvert.
- Le bruteforce du mot de passe doit être limité par une règle Cloudflare WAF / Rate Limiting sur `/api/auth/login` (voir la section Authentification administrateur).

## Intégration continue

Le workflow `.github/workflows/ci.yml` exécute sur chaque push et pull request :

- **validate** : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:csp`, puis publication de l'export `out/` comme artefact.
- **e2e** : `npm ci`, installation de Chromium, `npm run test:e2e` (interface réelle sur `next dev`).
- **csp-smoke** : récupère l'artefact produit par `validate` (aucun second build), sert `out/` avec Wrangler en HTTPS local, puis exécute `npm run test:csp` avec Playwright.
- **auth-integration** : récupère le même artefact et exécute `npm run test:integration` contre les vraies Pages Functions servies par Wrangler, avec des secrets de test injectés en bindings locaux.

Les jobs Playwright et de validation s'exécutent dans des workspaces séparés : aucun build concurrent ne partage le même dossier `out/`.

## Limites actuelles

- Pas encore de comptes synchronisés entre appareils ni d'authentification Discord.
- Les données personnelles restent propres au navigateur.
- Le filtrage du mode enfant est indicatif : les titres partagés n'ont pas de classification d'âge fiable.
- Le catalogue public peut exposer les identifiants vidéo Bunny nécessaires à la lecture.
- La session admin est stateless : la déconnexion efface le cookie du navigateur, mais un cookie copié avant expiration reste valide jusqu'à son `exp`. La durée est plafonnée à 12 heures ; une révocation immédiate nécessiterait un stockage serveur supplémentaire, à valider avant mise en place.
- Le rate limiting du login dépend d'une règle Cloudflare WAF / Rate Limiting à configurer et à valider dans le compte Cloudflare ; aucun contournement applicatif n'est fourni.
- La suppression Bunny puis la mise à jour D1 ne sont pas encore atomiques : un échec partiel peut laisser une fiche D1 pointant vers une vidéo Bunny déjà supprimée. La stratégie de compensation est documentée dans l'audit de prépublication et doit être validée avant application.
- Les styles hérités morts ont été retirés ; deux avertissements Autoprefixer historiques subsistent dans le CSS minifié.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Interface Next.js uniquement |
| `npm run dev:cf` | Build + Cloudflare Pages Functions via le Wrangler local épinglé |
| `npm run build` | Build de production, export statique et génération de la CSP |
| `npm run start` | Prévisualise l'export statique et les Pages Functions via le Wrangler local (après `npm run build`) |
| `npm run typecheck` | Vérification TypeScript |
| `npm test` | Tests Node |
| `npm run test:e2e` | Tests Playwright sur `next dev` |
| `npm run test:integration` | Tests Playwright contre les vraies Pages Functions via Wrangler (après `npm run build`) |
| `npm run check:csp` | Vérifie que `out/_headers` couvre tous les scripts inline |
| `npm run test:csp` | Smoke test Playwright de la CSP sur l'export statique (nécessite `npm run build`) |
| `npm run hash:admin` | Génère `CINEBOX_ADMIN_PASSWORD_HASH` sans afficher le mot de passe |
