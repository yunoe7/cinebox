# Architecture des comptes CinéBox

## Objectif

Proposer deux méthodes de connexion qui aboutissent au même compte CinéBox :
- compte classique (adresse e-mail + mot de passe) ;
- Discord OAuth2 (scope minimal `identify`).

La liaison d'identités est facultative et explicite. Une adresse e-mail Discord ne suffit jamais à fusionner automatiquement deux comptes.

## Architecture retenue

- Interface : Next.js export statique, aucun secret ni jeton OAuth dans le navigateur.
- API : Cloudflare Pages Functions sous `functions/api/auth/*`.
- Persistance : D1 via le binding existant `DB`.
- Identité : table `users` comme compte canonique ; `auth_identities` associe le compte à Discord.
- Sessions membres : jeton opaque aléatoire dans le cookie `__Host-cinebox_session`, HttpOnly, Secure, SameSite=Lax, Path=/ ; seule son empreinte SHA-256 et sa date d’expiration sont stockées dans D1, ce qui permet la révocation serveur. Aucun secret de session supplémentaire n’est nécessaire. Expiration initiale : 12 h. Il reste distinct de `__Host-cinebox_admin`.
- Secrets : variables Cloudflare Pages uniquement, jamais `NEXT_PUBLIC_*`, jamais dans Git.

## Parcours

### Compte classique
1. Inscription avec e-mail et mot de passe.
2. Normalisation de l'e-mail et unicité insensible à la casse.
3. Hachage du mot de passe côté serveur avec PBKDF2-SHA256 et sel aléatoire (paramètres compatibles Workers, à centraliser dans un module partagé).
4. Enregistrement du compte D1 ; émission d'un cookie de session après vérification de l'adresse e-mail.
5. Connexion, consultation de session et déconnexion par endpoints dédiés.
6. Réinitialisation par jeton aléatoire à usage unique, stocké uniquement sous forme hachée et avec expiration.

### Discord OAuth2
1. `GET /api/auth/discord/start` crée un état CSRF aléatoire, le place dans un cookie court HttpOnly et redirige vers Discord avec le scope `identify`.
2. `GET /api/auth/discord/callback` compare l'état retourné au cookie, échange le code côté serveur et appelle `GET https://discord.com/api/users/@me`.
3. Le serveur retrouve l'identité via (`provider='discord'`, `provider_user_id`). Si elle existe, il ouvre le compte associé.
4. Sinon, il crée un compte CinéBox puis l'identité Discord dans une transaction logique D1 (batch avec gestion des conflits).
5. Le serveur émet le cookie de session membre et efface le cookie d'état.
6. Les jetons d'accès/rafraîchissement Discord ne sont pas conservés : seul l'identifiant Discord et les informations de profil publiques utiles sont stockés.

### Liaison Discord à un compte existant
- L'utilisateur doit être déjà connecté au compte CinéBox avant de lancer le parcours de liaison.
- Le callback rattache l'identité Discord au compte de la session, seulement si elle n'est pas déjà liée ailleurs.
- Aucun rapprochement automatique par adresse e-mail Discord.
- Une identité Discord ne peut être liée qu'à un seul compte CinéBox.

## Endpoints prévus

| Méthode | Endpoint | Rôle |
| --- | --- | --- |
| POST | `/api/auth/register` | Créer un compte classique |
| POST | `/api/auth/login` | Connexion e-mail/mot de passe |
| POST | `/api/auth/logout` | Révoquer la session courante |
| GET | `/api/auth/session` | Lire l'état de connexion sans exposer le cookie |
| POST | `/api/auth/forgot-password` | Demander une réinitialisation sans révéler si l'e-mail existe |
| POST | `/api/auth/reset-password` | Consommer un jeton de réinitialisation |
| GET | `/api/auth/discord/start` | Démarrer OAuth2 (connexion ou liaison) |
| GET | `/api/auth/discord/callback` | Valider OAuth2 et ouvrir/lier le compte |

Les endpoints qui modifient l'état exigent un contrôle d'origine exact et une protection CSRF. Les routes de connexion/inscription nécessitent une règle Cloudflare Rate Limiting/WAF et une vérification d'adresse e-mail avant ouverture publique. Les premiers endpoints livrés utilisent les routes `/api/account/*` pour ne pas entrer en collision avec les routes d'administration existantes sous `/api/auth/*`.

## Variables Cloudflare à configurer

- `DISCORD_CLIENT_ID` : identifiant de l'application OAuth Discord.
- `DISCORD_CLIENT_SECRET` : secret OAuth Discord, stocké comme secret Cloudflare.
- `DISCORD_REDIRECT_URI` : URL HTTPS exacte de callback, identique à celle déclarée dans le portail développeur Discord.
- `CINEBOX_ACCOUNT_SESSION_SECRET` : secret HMAC distinct de l'administration, 32 caractères minimum.
- `CINEBOX_ACCOUNT_PASSWORD_PEPPER` : optionnel ; si utilisé, secret serveur uniquement et procédure de rotation documentée.

Ne pas réutiliser `DISCORD_TOKEN` du bot comme secret OAuth. Ne jamais transmettre le token du bot au site.

## Migration D1 0004

La migration `0004_account_auth.sql` est additive :
- ajoute les champs e-mail, vérificateur de mot de passe, validation e-mail et dernière connexion à `users` ;
- crée `auth_identities` pour l'identité Discord ;
- crée `account_email_tokens` pour validation/réinitialisation ;
- crée `account_sessions` pour révocation serveur.

Elle reprend également chaque `users.discord_user_id` existant dans `auth_identities` avec le même `user_id` (identifiant de migration déterministe `legacy-discord-*`) afin de préserver les connexions Discord déjà associées. Elle ne modifie aucune migration antérieure et ne supprime aucune donnée. Elle doit être testée localement puis appliquée en production uniquement après validation explicite.

## Découpage de livraison

1. Fondation D1 et primitives cryptographiques testées.
2. Inscription/connexion classique, session membre, logout et endpoint session (vérification e-mail et récupération à finaliser avec un fournisseur d’e-mail).
3. OAuth Discord (state, échange serveur, profil, création/connexion).
4. Liaison/déliaison explicite, validation e-mail et récupération du compte.
5. Synchronisation des favoris, profils et progression vers D1 après stratégie de fusion validée.

## Garde-fous

- Ne jamais confondre compte membre et compte administrateur.
- Ne jamais stocker un mot de passe en clair ni les jetons OAuth Discord.
- Ne jamais auto-fusionner des comptes sur la seule base d'une adresse e-mail.
- Cookies HttpOnly ; aucune session dans localStorage/sessionStorage.
- Réponses d'erreur non révélatrices pour l'inscription et la récupération.
- Rate limiting des endpoints sensibles et journalisation sans e-mail complet, mot de passe, code OAuth, cookie ni jeton.
- La migration ne doit pas être exécutée sur D1 production sans accord explicite.
