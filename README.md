# Immo Radar — V1

Un centre de veille immobilière automatisé sur le modèle de Business Radar.

## V1

- fil « Aujourd’hui » ;
- profils Particulier / Investisseur / Pro ;
- rubriques Lois, Marché, Investir et Territoires ;
- tri par pertinence, récence ou importance ;
- filtre « officiel uniquement » ;
- niveau de fiabilité A / B / C / D ;
- premier baromètre marché ;
- collecte Python ;
- mise à jour automatique toutes les 6 heures ;
- publication gratuite sur GitHub Pages.

## Structure

```text
.
├── .github/workflows/update.yml
├── data/
│   ├── feed.json
│   ├── market.json
│   └── sources.json
├── scripts/
│   └── collect.py
├── app.js
├── index.html
├── requirements.txt
└── styles.css
```

## Tester en local

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/collect.py --demo
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Mise en ligne

1. Créer un dépôt public GitHub nommé `immo-radar`.
2. Importer tous les fichiers de ce dossier à la racine.
3. Aller dans **Settings → Pages**.
4. Choisir **GitHub Actions** comme source.
5. Aller dans **Actions → Update Immo Radar → Run workflow**.
6. Le site sera ensuite disponible sur `https://VOTRE-PSEUDO.github.io/immo-radar/`.

## Important

Le baromètre présent dans cette V1 contient encore des valeurs de démonstration. La prochaine étape consiste à brancher les données officielles (Banque de France, INSEE, DVF, etc.) et à ajouter le suivi juridique Légifrance / UE.

La V1 ne doit jamais transformer une opinion de blog ou une annonce politique en « loi en vigueur ». Les statuts juridiques doivent rester explicites.
