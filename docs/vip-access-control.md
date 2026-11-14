# Accès VIP et avant-première (CinéBox)

## Objectif

Trois audiences possibles pour un titre du catalogue partagé (D1) :

| État | Visibilité |
| --- | --- |
| **Public** | Tous les comptes, y compris les visiteurs non connectés. |
| **Exclusif VIP** | Uniquement les membres VIP actifs et les administrateurs. Invisible partout pour les autres. |
| **Avant-première VIP** | Les VIP voient le titre immédiatement ; les autres comptes le voient automatiquement à `public_at`. |

Règles absolues :

- Un titre exclusif est **invisible** pour un non-VIP : ni dans le catalogue, ni
  dans la recherche, ni dans l'accueil, ni dans la fiche, ni dans l'URL de
  lecture. Un identifiant ou une URL deviné reçoit `404` (jamais `403`, pour ne
  rien révéler de l'existence du titre).
- L'avant-première exige **une date publique obligatoire**. Sans date valide,
  le titre reste VIP uniquement (fail-closed).
- Le passage au public est **automatique** : à partir de `public_at`, le titre
  devient visible par tous sans intervention d'un administrateur.
- Les droits ne sont **jamais modifiés silencieusement** : une publication ou
  une édition qui n'envoie pas les réglages VIP laisse les droits stockés
  intacts.

## Module central : `lib/cinebox/vip-access.mjs`

Toutes les règles sont isomorphes (utilisées par les Pages Functions **et** par
l'interface React), afin qu'il n'existe jamais deux logiques VIP divergentes.

| Fonction | Rôle |
| --- | --- |
| `normalizeVipFlags` | Normalise les trois colonnes ; `vipExclusive` l'emporte sur `vipEarlyAccess`. |
| `accessMode` | `"public" \| "vip-exclusive" \| "early-access"`. |
| `vipAccessState` | Audience à un instant donné : `"public"`, `"early"` (VIP seulement) ou `"vip"`. |
| `canAccessContent` | Décision d'accès pour un spectateur. Administrateur/VIP toujours autorisés. |
| `catalogVisibilitySql` | Prédicat SQL identique pour le listing, les statistiques et les épisodes. |
| `validateVipSettings` | Validation d'un payload administrateur (mutuellement exclusifs, date obligatoire, ISO 8601). |
| `filterAccessibleTitles` / `sanitizeTitleForViewer` | Filtrage et nettoyage côté client (défense en profondeur). |
| `applySharedVipRestrictions` | Un ancien titre personnel recopie les droits VIP du catalogue partagé. |
| `vipStatusLabel` | Libellé d'affichage réel (statut et audience). |

## Contrôle d'accès côté serveur

### Détermination du droit

1. `getAccount` lit le cookie de session `__Host-cinebox_session` (signé, 12 h).
2. `vip_memberships` : membership actif si `expires_at > now` (expiration et
   révocation sont donc prises en compte à chaque requête).
3. `isAdminAccount` : rôle `users.role='admin'`, identité Discord du
   Fondateur/Admin/Modérateur, ou allowlist (avec cache 30 s).
4. `entitled = vip || admin`. **Jamais** de paramètre de requête ni de valeur
   côté client n'est accepté.

### Endpoints

| Endpoint | Comportement |
| --- | --- |
| `GET /api/catalog` | Filtre SQL selon le droit du spectateur, renvoie `viewer: {authenticated, vip, admin, entitled}`. |
| `GET /api/catalog/access?id=` | Revalide **un** titre (détail, lecture) : `200` avec la fiche complète et les URLs de lecture si autorisé, sinon `404` générique. |
| `PATCH /api/catalog/manage` | Édite titre/synopsis **et**, uniquement si envoyés, les réglages VIP validés ; renvoie la ligne relue depuis D1. |
| `POST /api/catalog/publish` | Persiste les droits VIP **seulement** si le payload les contient ; sinon les droits existants sont conservés. |
| `GET /api/admin/vip-audit` | Rapport **lecture seule** des incohérences VIP (contradictions, dates manquantes/illisibles, titres masqués). N'écrit jamais. |

### Cache

Toutes les réponses de catalogue sont personnelles :

```
cache-control: private, no-store, max-age=0
cdn-cache-control: no-store
Vary: Cookie
```

Cloudflare, les proxys et le navigateur ne peuvent donc jamais réutiliser une
réponse VIP pour un autre spectateur.

## Interface administrateur

`components/cinebox/SharedCatalogManager.tsx` :

- Trois modes radio exclusifs (public / exclusif VIP / avant-première) : aucune
  combinaison contradictoire possible.
- La date est **obligatoire** en avant-première (bouton désactivé sinon) et
  convertie dans le fuseau **local** de l'administrateur (jamais `toISOString`
  affiché comme heure locale).
- Affiche le **statut réel** (`vipStatusLabel`) et la date d'ouverture publique
  sur chaque fiche, y compris « avant-première terminée ».
- Après enregistrement, la ligne renvoyée par le serveur est appliquée puis la
  liste est rechargée depuis D1 : l'écran montre la vérité serveur.
- Un avertissement signale une date déjà passée (le titre est déjà public).

## Interface publique (`app/page.tsx`)

- `browseTitles` applique `applySharedVipRestrictions` puis
  `filterAccessibleTitles` **avant** tout rendu : accueil, héros, rangées,
  recherche, Top 10, favoris, page VIP, fiche de détail.
- Révalidation du catalogue à chaque retour au plan / onglet visible (throttle
  30 s) : expiration VIP, révocation ou date atteinte sont propagées.
- Ouverture d'une fiche et sélection d'un épisode passent par
  `/api/catalog/access` : un droit périmé ferme la fiche au lieu de relancer
  une URL en cache.
- Une fiche encore ouverte qui disparaît du catalogue est fermée
  automatiquement avec un message explicite.

## Données

- Aucune migration de données n'est nécessaire : les colonnes existent déjà
  (`migrations/0008_vip_memberships.sql`, `migrations/0009_vip_catalog_access.sql`).
- Aucune donnée de production n'est modifiée par ce travail.
- Avant toute migration, lancer `GET /api/admin/vip-audit` (admin uniquement) :
  il liste les incohérences éventuelles sans jamais écrire.

## Tests

- `lib/cinebox/vip-access.test.mjs` : matrice public/exclusif/avant-première
  (avant/après) × invité/classique/VIP/admin, validation, SQL, filtrage client.
- `tests/api/catalog.test.mjs` : audience SQL par rôle, absence de fenêtre
  48 h, statistiques, en-têtes de cache.
- `tests/api/catalog-access.test.mjs` : accès direct fiche/lecture/épisodes,
  404 non révélable, downgrade, expiration, publication, cache.
- `tests/api/catalog-manage.test.mjs` : contradictions, date obligatoire,
  dates invalides, conservation des droits, réponse = ligne serveur.
- `tests/api/catalog-publish.test.mjs` : persistance et **conservation** des
  droits lors d'une republish sans champs VIP.
- `tests/api/admin-vip-audit.test.mjs` : rapport lecture seule.

Commandes : `npm run typecheck`, `npm test`, `npm run build`,
`npm run check:csp`, `npm run test:integration`, `npm run test:csp`,
`npm run test:e2e`.

## Risques résiduels

- Les données déjà présentes en production n'ont pas pu être inspectées depuis
  cet environnement : utiliser l'audit en lecture seule avant toute migration.
- Un onglet laissé ouvert avec une URL de lecture déjà reçue continue de
  lancer cette vidéo jusqu'à la prochaine révalidation ; le serveur, lui, ne
  sert jamais une nouvelle URL sans droit.
- Le droit est recalculé à chaque requête serveur, mais un `PATCH`/`POST`
  concurrent entre la lecture et l'écriture reste théoriquement possible (fenêtre
  très courte, D1 sérialise les écritures).
