# Architecture de l’authentification membre CinéBox

## Règle d’accès

- Une connexion avec un compte Discord est obligatoire pour accéder à l’application.
- Il n’est pas nécessaire de rejoindre le serveur Discord CinéBox.
- Le bouton d’invitation au serveur est une option communautaire, sans effet sur l’autorisation d’accès.
- Le flux OAuth demande uniquement le scope `identify`. Aucun scope de serveur, de rôle ou d’adhésion n’est demandé.

## Architecture

- Interface : export statique Next.js ; aucun secret OAuth n’est livré au navigateur.
- API : Cloudflare Pages Functions sous `functions/api/auth/discord/*` et `functions/api/account/*`.
- Persistance : Cloudflare D1 via le binding `DB`.
- Identité : `users` est le compte CinéBox canonique ; `auth_identities` associe le compte à son identifiant Discord.
- Session membre : cookie opaque `__Host-cinebox_session`, HttpOnly, Secure, SameSite=Lax, Path=/ ; seule son empreinte SHA-256 est stockée dans D1. Durée initiale : 12 heures.
- La session membre est distincte de la session administrateur `__Host-cinebox_admin`.

## Parcours de connexion

1. L’interface appelle `GET /api/account/session` pour vérifier la session membre.
2. Sans session valide, l’application masque le catalogue et affiche `DiscordAccessGate`.
3. Le bouton de connexion appelle `GET /api/auth/discord/start`. Le serveur crée un état CSRF aléatoire dans un cookie HttpOnly court et redirige vers Discord avec le scope `identify`.
4. `GET /api/auth/discord/callback` compare l’état OAuth, échange le code côté serveur puis appelle `GET https://discord.com/api/users/@me`.
5. Le serveur retrouve ou crée le compte D1 et enregistre les informations publiques du profil Discord.
6. Le serveur émet le cookie de session membre et redirige vers CinéBox.

Aucune vérification d’appartenance à un serveur Discord n’est effectuée. Le compte peut se connecter même s’il n’a jamais rejoint le serveur CinéBox.

## Profil et avatar

- `GET /api/account/session` renvoie les informations publiques utiles au profil.
- L’avatar est chargé depuis le CDN officiel `cdn.discordapp.com`. La CSP autorise explicitement ce domaine.
- Si le compte n’a pas d’avatar personnalisé, l’URL de l’avatar par défaut est calculée depuis son identifiant Discord.
- Aucun jeton OAuth n’est conservé ni transmis au navigateur.

## Déconnexion et bibliothèque

- `POST /api/account/logout` révoque la session membre courante.
- `GET /api/account/library` et les routes de bibliothèque associées servent les données personnelles du compte.
- Les données locales historiques sont conservées ; aucune suppression ou migration destructive n’est déclenchée automatiquement.

## Variables Cloudflare

Configurer dans Preview et Production :

- `DISCORD_CLIENT_ID` : identifiant de l’application OAuth Discord.
- `DISCORD_CLIENT_SECRET` : secret OAuth, stocké comme secret Cloudflare.
- `DISCORD_REDIRECT_URI` : URL HTTPS exacte de `/api/auth/discord/callback`, également déclarée dans le portail développeur Discord.
- `DB` : binding D1.

Ne jamais utiliser le token d’un bot Discord comme secret OAuth. Ne jamais exposer ces valeurs dans une variable `NEXT_PUBLIC_*`.

## Migrations D1

Les migrations `0004_account_auth.sql` et suivantes ajoutent les identités, sessions, limites de tentatives et données de compte. Les migrations déjà appliquées ne doivent jamais être modifiées ; toute évolution du schéma doit passer par une nouvelle migration additive, testée localement. Aucune migration de production ne doit être exécutée sans validation explicite.

## Garde-fous

- Ne jamais confondre session membre et session administrateur.
- Ne jamais stocker de mot de passe, code OAuth ou jeton Discord dans le navigateur.
- Ne jamais fusionner automatiquement des comptes à partir d’une adresse e-mail.
- Vérifier l’état OAuth et limiter les tentatives sur les endpoints sensibles.
- Ne jamais exiger l’adhésion au serveur Discord pour ouvrir une session CinéBox.
