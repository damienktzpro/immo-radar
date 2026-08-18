# Immo Radar — Patch V1.2 Radar juridique

Fichiers à remplacer dans le dépôt :

- `index.html`
- `styles.css`
- `app.js`
- `scripts/collect.py`
- `requirements.txt`
- `data/sources.json`

## Nouveautés

- Radar juridique visible dans l'onglet **Lois & réglementation**.
- 5 étapes affichées : Déposé, En discussion, Adopté, Promulgué, Publié au JORF.
- Source officielle **Sénat / DOSLEG**.
- Les états officiels du Sénat sont normalisés pour le radar.
- Légifrance reste distinct : un texte publié au JORF n'est pas automatiquement marqué "en vigueur".
- Les sources niveau B, comme l'ANIL, restent visibles hors filtre "Officiel uniquement".

## Installation

1. Décompresser l'archive.
2. GitHub → Code → Add file → Upload files.
3. Glisser le contenu du dossier.
4. Commit.
5. Attendre le workflow GitHub Actions.
6. Recharger le site avec Cmd+Shift+R.
7. Cliquer sur **Lois & réglementation** pour voir le radar.
