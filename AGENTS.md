# CINÉBOX — Instructions du projet

## Présentation

CinéBox est une application personnelle de cinéma développée avec Next.js 15, React 19 et TypeScript.

Dépôt GitHub privé : yunoe7/cinebox\
Branche principale : main\
Hébergement : Cloudflare Pages\
URL : [https://cinebox-a1h.pages.dev](https://cinebox-a1h.pages.dev)

## Direction artistique

Créer une expérience premium, immersive et cinématographique.

- Fond noir et charbon profond.
- Accents dorés discrets.
- Typographie élégante.
- Animations fluides et sobres avec Motion.
- Inspiration : Apple TV+, Netflix, Magic UI, 21st.dev, shadcn/ui et Aceternity UI.
- Éviter les dégradés excessifs, le néon et les effets lumineux trop voyants.

## Fonctionnalités à préserver

- Navigation Accueil, Films, Séries, Vidéos, Ma liste et Administration.
- Ajout et modification des titres.
- Affiches et vidéos importées par l'utilisateur.
- Saisons et épisodes.
- Recherche, filtres, tri et favoris.
- Lecture vidéo, progression et lecture automatique de l'épisode suivant.
- Recommandations, Top 10 et carrousel d'accueil.

Ne supprime jamais une fonctionnalité pour simplifier une refonte visuelle.

## Stockage

Les données restent locales au navigateur.

- localStorage : cinebox-titles et cinebox-favorites.
- IndexedDB : cinebox-assets, store files.\
  Ne remplace pas ce fonctionnement par un stockage cloud ou une authentification.

## Architecture

- app/page.tsx
- app/globals.css
- components/cinebox/
- components/ui/
- components/magicui/
- lib/cinebox/

Réutiliser les composants existants et éviter de réécrire toute l'application.

## Règles de développement

- Lire le code existant avant toute modification.
- Faire des changements progressifs et cohérents.
- Préserver le responsive desktop et mobile.
- Respecter TypeScript.
- Ne pas inventer d'affiches ou de médias par défaut.
- Respecter prefers-reduced-motion.
- Vérifier les modifications avec les outils adaptés.
- Ne jamais prétendre qu'un build ou un test a réussi sans l'avoir exécuté.

## Git et déploiement

Le dépôt GitHub est privé.\
Cloudflare Pages est connecté à la branche main.\
Chaque push sur main peut déclencher un déploiement automatique.\
Ne jamais rendre le dépôt public.\
Ne jamais pousser directement sur main sans validation explicite de l'utilisateur.\
Ne pas utiliser Vercel pour le déploiement de CinéBox.

## Méthode de travail

Avant une tâche importante :

1. Analyser l'existant.
2. Présenter un plan.
3. Modifier progressivement.
4. Vérifier les changements.
5. Présenter un résumé des fichiers modifiés et des tests effectués.