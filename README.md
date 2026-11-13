# CinéBox

Application personnelle de cinéma : catalogue de films, séries et vidéos, fiches détaillées, lecture vidéo, progression, favoris, profils et administration.

- **Frontend** : Next.js 15, React 19, TypeScript, Motion (Framer Motion), Lucide.
- **Hébergement** : Cloudflare Pages (export statique `out/`).
- **API** : Cloudflare Pages Functions (`functions/api/*`).
- **Catalogue partagé** : Cloudflare D1 (`migrations/0001_shared_catalog.sql`, `migrations/0002_catalog_sources.sql`).
- **Vidéo** : Vidsrc pour les titres TMDB, fichiers locaux/directs pour les vidéos importées.
- **Métadonnées** : TMDB via un proxy serveur en lecture seule.

> Le dépôt GitHub est privé. Ne jamais le rendre public. Ne jamais pousser directement sur `main` sans validation.

## Prérequis

- **Node.js 22 LTS** recommandé pour Cloudflare Pages. Wrangler `4.158.0` est épinglé en dépendance de développement et exige Node.js `>= 22.0.0`.
- npm 10+.
- Un projet Cloudflare Pages avec un binding D1 nommé **`DB`**.
- Un compte TMDB avec un jeton Read Access.

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
| `CINEBOX_ADMIN_DISCORD_USER_ID` | Identifiant Discord de secours autorisé explicitement | Optionnel |
| `CINEBOX_DISCORD_BOT_TOKEN` | Token du bot Discord, conservé uniquement côté serveur | Pour les rôles automatiques |
| `CINEBOX_DISCORD_GUILD_ID` | Identifiant du serveur Discord CinéBox | Pour les rôles automatiques |
| `CINEBOX_DISCORD_ROLE_FONDA_ID` | Identifiant du rôle Fondateur | Pour les rôles automatiques |
| `CINEBOX_DISCORD_ROLE_ADMIN_ID` | Identifiant du rôle Admin | Pour les rôles automatiques |
| `CINEBOX_DISCORD_ROLE_MODO_ID` | Identifiant du rôle Modérateur | Pour les rôles automatiques |
| `DISCORD_CLIENT_ID` | Identifiant de l’application OAuth Discord | Pour la connexion membre |\n| `DISCORD_CLIENT_SECRET` | Secret OAuth Discord (secret Cloudflare) | Pour la connexion membre |\n| `DISCORD_REDIRECT_URI` | URL HTTPS exacte de `/api/auth/discord/callback` | Pour la connexion membre |\n| `DB` | Binding D1 Cloudflare (configuré dans Pages, pas dans `.env`) | Pour les comptes et le catalogue partagé |

Pour activer l'autorisation automatique, configurer le token du bot, l'identifiant du serveur et les trois identifiants de rôles Fondateur/Admin/Modérateur dans Cloudflare Pages Production et Preview. Le bot doit appartenir au serveur et l'intent privilégié **Server Members Intent** doit être activé dans le portail Discord. Les identifiants de rôles sont vérifiés côté serveur via l'API Discord à chaque contrôle d'accès (cache court de 30 secondes). L'identifiant `CINEBOX_ADMIN_DISCORD_USER_ID`, le rôle D1 `admin` et `admin_allowlist` restent des accès explicites de secours. La session est celle du compte Discord déjà connecté : aucun mot de passe administrateur ni secret de session séparé n’est nécessaire.

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
- **Variables d'environnement** : `TMDB_READ_ACCESS_TOKEN`, `CINEBOX_ADMIN_DISCORD_USER_ID`, `CINEBOX_DISCORD_BOT_TOKEN`, `CINEBOX_DISCORD_GUILD_ID`, `CINEBOX_DISCORD_ROLE_FONDA_ID`, `CINEBOX_DISCORD_ROLE_ADMIN_ID`, `CINEBOX_DISCORD_ROLE_MODO_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`

Configurer ces variables dans **Production** et **Preview**. Ajouter aussi `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` et `DISCORD_REDIRECT_URI` dans les deux environnements, et déclarer l’URL de callback exacte dans le portail développeur Discord. Ne jamais coller les valeurs dans une conversation, un ticket ou un commit. Tous ces secrets sont lus uniquement par les Pages Functions.

Les Pages Functions sont détectées automatiquement dans `functions/`.

### Authentification administrateur

- Toute l’administration utilise la session Discord existante (`__Host-cinebox_session`) : le bouton admin déclenche OAuth Discord et aucun mot de passe distinct n’est demandé.
- Les rôles Discord Fondateur, Admin et Modérateur accordent tous l'accès à l'ensemble des panneaux et API d'administration. Les rôles sont relus côté serveur auprès de Discord avec un cache de 30 secondes ; un retrait de rôle retire donc rapidement les droits.
- Les accès explicites `CINEBOX_ADMIN_DISCORD_USER_ID`, `users.role = 'admin'` et `admin_allowlist` sont conservés comme mécanismes de secours. Un membre sans rôle privilégié ni autorisation explicite reste refusé.
- VIP reste indépendant de l'administration et conserve uniquement ses avantages VIP.
- Les requêtes mutantes exigent une `Origin` exacte, `Sec-Fetch-Site: same-origin` lorsqu’il est présent, et l’en-tête `x-cinebox-request: 1`.

**Rate limiting** : le démarrage OAuth Discord (`GET /api/auth/discord/start`) est limité côté serveur à 12 tentatives par adresse IP sur 15 minutes via la table D1 `account_rate_limits` (migration `0005_account_rate_limits.sql`). Une règle Cloudflare WAF complémentaire peut aussi protéger les routes `/api/auth/*` et `/api/catalog/manage`.

### Connexion des membres avec Discord\n\n- La connexion Discord est obligatoire pour accéder à CinéBox. L’écran principal reste masqué tant qu’une session membre valide n’est pas établie.\n- Le flux OAuth utilise uniquement le scope `identify` : il récupère l’identité et l’avatar publics du compte Discord. Il ne demande ni rôle, ni accès aux serveurs, ni appartenance au serveur CinéBox.\n- Rejoindre le serveur Discord via le bouton d’invitation est entièrement facultatif.\n- Le callback `/api/auth/discord/callback` vérifie le cookie `state`, échange le code côté serveur, récupère `/users/@me` et crée ou retrouve le compte D1. La session membre et administrateur est partagée dans le même cookie HttpOnly ; l’accès admin dépend d’une autorisation Discord vérifiée côté serveur.\n- L’avatar est chargé directement depuis le CDN officiel `cdn.discordapp.com`, autorisé par la CSP. Aucun jeton OAuth n’est exposé au navigateur.\n\n### Migrations D1

La migration initiale se trouve dans `migrations/0001_shared_catalog.sql`. Elle crée les tables `users`, `admin_allowlist`, `catalog_titles`, `catalog_episodes`, `media_assets`, `user_favorites`, `user_progress`, `watch_history` et les index associés.

La migration `migrations/0002_catalog_sources.sql` est additive et prépare les sources vidéo distantes : elle crée `catalog_media_sources` (fournisseur, `file_code`, `video_id`, `playback_url`, qualité, statut d’encodage, date de téléversement) et associe une source à un film (`catalog_titles`) ou à un épisode (`catalog_episodes`).

La migration `migrations/0003_catalog_sources_multi_provider.sql` remplace la contrainte mono-fournisseur `provider = 'uqload'` par `provider IN ('uqload', 'vidmoly')`. Elle reconstruit la table en conservant toutes les lignes existantes, puis recrée ses index. Aucun appel réseau Uqload ou VidMoly n’est effectué par l’application à ce stade.

> `catalog_media_sources` accepte plusieurs lignes pour un même film ou épisode : la clé d’unicité est `(provider, file_code)`, pas le couple titre/épisode. Vidsrc reste lu séparément depuis `tmdbId` via `lib/cinebox/vidsrc.mjs`, et les fichiers locaux restent dans IndexedDB via `videoAssetKey` / `videoUrl` : ils n’ont pas vocation à être dupliqués dans `catalog_media_sources`.
>
> `media_assets` est conservée telle quelle. Elle décrit les futurs fichiers téléversés/transcodés (`cloudflare_stream`, `r2`) et leur cycle de vie, tandis que `catalog_media_sources` décrit les sources distantes intégrées par code fichier (`uqload`, `vidmoly`). Les deux tables ne sont pas encore alimentées par un flux d’upload ; aucune n’est supprimée ni fusionnée automatiquement. Le catalogue partagé actuel conserve les métadonnées TMDB dans `catalog_titles.metadata_json` ; les migrations déjà appliquées ne doivent pas être modifiées. Toute évolution doit passer par une nouvelle migration D1 validée.

```bash
# Base locale Wrangler
npx wrangler d1 migrations apply <nom-ou-binding-d1> --local

# Base distante (à exécuter explicitement, jamais depuis un test)
npx wrangler d1 migrations apply <nom-ou-binding-d1> --remote
```

Ne jamais lancer de migration ni d'écriture sur la base de production sans validation explicite.

### Administration et bibliothèque locale

- L’administration est centrée sur le catalogue partagé D1 : Vue d’ensemble, Films, Séries, Vidéos et Médias. Les compteurs affichés proviennent uniquement de D1 ; en cas d’indisponibilité, ils restent à `—` et l’interface l’indique.
- Les anciennes fiches locales non publiées ne sont ni supprimées ni vidées. Elles restent lisibles et gérables (ouvrir, modifier, supprimer) depuis une liste compacte de la Vue d’ensemble, séparée des compteurs D1.
- L’onglet Médias inventorie les affiches, fonds et miniatures d’épisodes réellement enregistrés dans D1. Il ne lit aucun fichier IndexedDB du navigateur.
- Les données locales historiques non migrées sont conservées dans le navigateur. Aucun export ou transfert automatique de ces données n’est effectué.

## Lecture vidéo

- Les films et séries identifiés par un `tmdbId` sont lus via Vidsrc, dans une iframe autorisée par la CSP (`frame-src https://vidsrc.sh`).
- Les vidéos importées ou liées à un fichier local/direct utilisent le lecteur vidéo générique (`components/cinebox/VideoPlayer.tsx`).
- La progression, la reprise de lecture, la navigation entre épisodes et la lecture automatique de l'épisode suivant restent disponibles dans les deux modes.

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
  tmdb/[[path]].ts          Proxy TMDB
lib/cinebox/                Logique testable (.mjs) et types
migrations/                 Schéma D1 (catalogue partagé et sources média)
tests/                      Tests Node et Playwright
```

## Sécurité

- Les jetons restent côté serveur ; seules les variables `NEXT_PUBLIC_*` seraient exposées, et il n'y en a pas.
- Les routes d’écriture admin vérifient le cookie de session Discord `HttpOnly`, stocké sous forme de hash dans D1 et révocable à la déconnexion (durée maximale : 12 heures).
- L’administration est autorisée par l’identité Discord du compte, via `CINEBOX_ADMIN_DISCORD_USER_ID`, `users.role = 'admin'` ou `admin_allowlist`.
- Les requêtes mutantes admin sont protégées contre le CSRF par `SameSite=Strict`, un contrôle exact de l'`Origin`, `Sec-Fetch-Site` et l'en-tête `x-cinebox-request`.
- Les routes publiques du catalogue sont en lecture seule et ne renvoient que les titres publiés.
- Les données personnelles (favoris, progression, profils) restent dans `localStorage` / IndexedDB tant qu'une migration vérifiée n'est pas disponible.
- L’accès membre exige une session obtenue via Discord OAuth (`identify`). L’adhésion au serveur Discord n’est jamais vérifiée et reste facultative. Les secrets OAuth restent exclusivement côté serveur.
- Le navigateur ne conserve aucun jeton admin dans `sessionStorage` ou `localStorage` : la session vit exclusivement dans un cookie `HttpOnly`. La déconnexion efface ce cookie.
- Aucun `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` n'est utilisé dans le code source. Les contenus distants (TMDB, D1) sont rendus via React, qui échappe le texte.
- `public/_headers` applique `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY` et HSTS. `npm run build` génère ensuite la CSP SHA-256 dans `out/_headers` ; `npm run check:csp` vérifie que chaque script inline est couvert.

## Intégration continue

Le workflow `.github/workflows/ci.yml` exécute sur chaque push et pull request :

- **validate** : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:csp`, puis publication de l'export `out/` comme artefact.
- **E2E** : temporairement désactivé dans le workflow pendant l’analyse des temps d’exécution ; les tests Playwright restent disponibles via `npm run test:e2e`.
- **csp-smoke** : récupère l'artefact produit par `validate` (aucun second build), sert `out/` avec Wrangler en HTTPS local, puis exécute `npm run test:csp` avec Playwright.
- **auth-integration** : récupère le même artefact et exécute `npm run test:integration` contre les vraies Pages Functions servies par Wrangler, avec des secrets de test injectés en bindings locaux.

Les jobs Playwright et de validation s'exécutent dans des workspaces séparés : aucun build concurrent ne partage le même dossier `out/`.

## Limites actuelles

- Les comptes membres sont créés à partir de l’identité Discord et les sessions sont conservées côté serveur dans D1.
- Les données personnelles restent propres au navigateur.
- Le filtrage du mode enfant est indicatif : les titres partagés n'ont pas de classification d'âge fiable.
- Le catalogue public n'expose que les métadonnées nécessaires à l'affichage et à la lecture.
- La session Discord est stockée sous forme de hash dans D1 (`account_sessions`), expire après 12 heures et est révoquée côté serveur à la déconnexion. Les cookies temporaires OAuth `state` et `mode` expirent après 10 minutes.
- Le rate limiting du login dépend d'une règle Cloudflare WAF / Rate Limiting à configurer et à valider dans le compte Cloudflare ; aucun contournement applicatif n'est fourni.
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
| `npm run hash:admin` | Ancien utilitaire de migration du mot de passe admin (non utilisé par l'authentification actuelle) |
