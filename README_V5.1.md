# Radar Immobilier V5.1 — Connexions locales réelles

Cette version branche réellement les premières sources locales.

## Connecté maintenant

### API Découpage administratif
Déjà utilisée pour :
- nom de commune,
- code INSEE,
- population,
- code postal,
- département,
- région,
- centre géographique.

### ADEME DPE
Connexion réelle à :
`https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg`

Le Radar calcule par commune :
- nombre de DPE observés,
- distribution A à G,
- part F + G,
- part A + B,
- classe dominante,
- niveau de confiance selon la taille de l’échantillon.

Important : les DPE réalisés ne représentent pas exhaustivement tout le parc immobilier.

### Géorisques
Connexion à l’API publique V1 :
`/api/v1/resultats_rapport_risque`

Le Radar utilise le code INSEE, puis le centre de la commune en repli si nécessaire.
Le lien vers le rapport officiel reste toujours disponible.

## Architecture hybride

1. GitHub Actions précharge les communes listées dans :
   `data/territories/monitored.json`
2. `scripts/update_local.py` génère :
   `data/territories/<CODE_INSEE>.json`
3. Pour une autre commune recherchée par l’utilisateur, le navigateur tente directement ADEME et Géorisques.
4. Les réponses sont mises en cache 24 h dans le navigateur.

Ainsi, les communes populaires sont rapides, mais le Radar reste utilisable avec des communes non préchargées.

## Ce qui reste volontairement "À brancher"

- DVF : prix ancien + transactions
- Observatoires des loyers : loyer médian

Aucun chiffre n’est inventé en attendant.

## GitHub Actions

Aucun changement manuel du workflow n’est requis :
`collect.py` appelle désormais automatiquement `update_local.py`.

## Installation

Importer à la racine du dépôt :
- `app.js`
- `styles.css`
- `scripts/collect.py`
- `scripts/update_local.py`
- `data/territories/monitored.json`
- `data/feed.json`
- `data/sources.json`

Tu peux aussi importer toute l’archive.

Commit conseillé :
`V5.1 - connexions ADEME DPE et Georisques`

Après le premier workflow GitHub Actions réussi, le dossier `data/territories/`
sera alimenté avec les fichiers JSON des communes surveillées.
