# CinéBox

Bibliothèque vidéo personnelle construite avec Next.js, React et TypeScript.

## Développement

```bash
npm install
npm run dev
```

## Vérifications

```bash
npm run typecheck
npm run build
```

## Publication

Le dépôt GitHub est relié à Vercel. Les commits poussés sur `main` déclenchent les déploiements configurés dans le projet.

## Fonctionnalités

- Catalogue de films, séries et vidéos
- Recherche, filtres, tri et favoris
- Fiches détaillées et lecteur vidéo
- Gestion des saisons et des épisodes
- Reprise de lecture et progression
- Administration des titres
- Affiches et vidéos stockées localement dans le navigateur (IndexedDB)

## Limites actuelles

Les données et les médias sont propres au navigateur et à l'appareil utilisés. Il n'y a pas encore de comptes, de base de données distante ni de synchronisation entre appareils.
