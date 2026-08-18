# Radar Immobilier V2.2 — Premium + Sources élargies

Cette version remplace la V2 actuelle en une seule grosse mise à jour.

## Design
- Retour au thème clair beige / vert
- Hero « L’immobilier, sans le bruit. »
- Baromètre national avec jauge
- Rapport de force et financement à droite
- « Pulse du jour »
- Fil éditorial en cartes
- Encadré « Radar des lois » à droite
- Bloc « Sources vérifiées »
- Teaser Territoires

## Sources actives
### A — officielles
- Légifrance
- Sénat / DOSLEG
- EUR-Lex
- Service-Public.fr
- Insee
- Banque de France
- SDES / Sitadel

### B — institutionnelles
- ANIL
- Notaires de France

### C — médias immobiliers
- MySweetImmo
- Immo Matin
- Journal de l'Agence
- Batiactu
- Immobilier 2.0

### D — blog / expert
- Horiz.io

### Prêtes pour Territoires
- DVF / data.gouv.fr
- ADEME DPE
- Géorisques

## Sécurité éditoriale
Le moteur repart de zéro à chaque exécution : il ne réinjecte pas les anciennes cartes.
Le filtre exige un marqueur immobilier explicite. Les sujets voiture / automobile / smartphone / sport / crypto sont rejetés sans lien immobilier explicite.
Les articles sans date identifiable ne sont pas affichés comme « à l’instant ».

## Installation GitHub
Importer à la racine :
- index.html
- styles.css
- app.js
- requirements.txt
- scripts/collect.py
- data/feed.json
- data/market.json
- data/sources.json

Le workflow GitHub Actions existant peut rester inchangé.
