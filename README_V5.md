# Radar Immobilier V5 — Territoires refondus

Cette version remplace la page Territoires prototype par une vraie expérience locale.

## Principales évolutions
- Recherche réelle de communes / arrondissements / codes postaux via l’API Découpage administratif.
- Suppression des faux chiffres locaux de démonstration.
- Identité territoriale issue du référentiel officiel : nom, code INSEE, population, code postal, département, région.
- Données immobilières affichées uniquement si une source est branchée ; sinon `En connexion`.
- Liens officiels vers DVF, Observatoires des loyers, ADEME DPE et Géorisques.
- Filtres spécifiques Territoires : Vue d’ensemble, Prix, Loyers, Transactions, DPE, Construction, Risques.
- Le fil local exclut les actualités territoriales d’autres villes et conserve les signaux nationaux utiles.
- Sidebar locale corrigée : plus de confusion `Transactions = €/m²`.
- Responsive revu.

## Installation
Remplacer à la racine du repo :
- `index.html`
- `app.js`
- `styles.css`

Option complète : importer tout le contenu de l’archive.

Commit conseillé : `V5 - Territoires overhaul`
