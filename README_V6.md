# Radar Immobilier V6 — Territoires Full Data

Grosse mise à jour en une seule fois.

## Ce qui est branché

- API Découpage administratif : commune, arrondissement, code INSEE, population, département, région.
- DVF / data.gouv.fr : prix médian au m² appartements, prix médian maisons, volumes de ventes sur les 10 semestres disponibles.
- Carte des loyers 2025 : loyer appartement, T1-T2, T3+, maison, observations, intervalle et qualité de l’estimation.
- ADEME DPE : répartition A-G, part F-G, classe dominante, nombre de DPE observés.
- Géorisques : rapport officiel et signaux détectés.

## Corrections importantes

- Le territoire sélectionné est maintenant synchronisé partout : titre du fil, fiche locale, sidebar et données.
- Protection contre les réponses API tardives : Lyon ne peut plus remplacer Bordeaux après un changement rapide de commune.
- Nouveau cache V6 : les anciens caches V5.1 n’empêchent pas le branchement DVF/loyers.
- Fil Territoires moins bruyant : priorité aux informations réellement locales et aux signaux nationaux importants.
- 24 informations maximum dans le fil territorial.

## Lecture Investisseur

Quand prix DVF + loyer appartement sont disponibles, le Radar calcule un rendement brut indicatif :

`loyer mensuel au m² × 12 / prix médian au m²`

Ce ratio est explicitement présenté comme indicatif : il ne tient pas compte de la fiscalité, des charges, de la vacance, des travaux ou du financement.

## Architecture

GitHub Actions appelle `scripts/collect.py`, qui lance automatiquement `scripts/update_local.py`.
Les communes surveillées sont listées dans `data/territories/monitored.json`.
Les fichiers générés sont enregistrés sous `data/territories/<CODE_INSEE>.json`.
Pour une commune non préchargée, le navigateur tente également les API publiques en direct et conserve un cache V6 de 24 h.

## Installation

Importer tout le contenu de l’archive à la racine du dépôt GitHub.
Le workflow GitHub Actions existant reste compatible.

Commit conseillé :
`V6 - Territoires Full Data`
