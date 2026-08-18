# Immo Radar V2 — Grosse mise à jour

Cette version remplace les petits patchs précédents.

## Inclus en une seule mise à jour

- Fil strictement immobilier
- Cartes inspirées de Business Radar
- Liens directs obligatoires
- Recherche interne
- Favoris
- Plus / Moins comme ça
- Filtre officiel uniquement
- Radar juridique France
- Base EUR-Lex + possibilité d'un RSS EUR-Lex personnalisé
- ANIL
- Service-Public
- Sénat
- Légifrance
- Immo Matin
- Immobilier 2.0
- Baromètre national fondé sur Insee / Notaires, Banque de France et SDES / Sitadel
- Zone « À surveiller »
- Détails du calcul du baromètre
- GitHub Actions existant compatible

## Installation

Remplacer / ajouter à la racine du dépôt :

- `index.html`
- `styles.css`
- `app.js`
- `requirements.txt`
- `scripts/collect.py`
- `data/market.json`
- `data/sources.json`

Puis commit. Le workflow `Update Immo Radar` se relancera.

## EUR-Lex

La V2 contient déjà une base de textes immobiliers/bâtiment européens officiels.
Pour une surveillance exhaustive et automatique de nouvelles recherches EUR-Lex, ajouter ensuite un secret GitHub `EURLEX_RSS_URL` contenant un flux RSS personnalisé EUR-Lex.

## Important

Le baromètre est un indicateur de lecture de marché, pas un conseil financier. Il conserve la période de chaque donnée afin de ne pas présenter une statistique trimestrielle comme du temps réel.
