# Immo Radar — Patch V1.1 Sources réelles

À copier à la racine du dépôt `immo-radar`.

Fichiers remplacés :

- `app.js`
- `scripts/collect.py`
- `requirements.txt`
- `data/sources.json`

## Changements

1. `Officiel uniquement` = niveau A seulement.
2. Les cartes techniques comme `Prochaine étape : intégrer DVF...` sont exclues.
3. Service-Public.fr est collecté via son RSS officiel.
4. Légifrance est scanné sur les Journaux officiels récents avec des mots-clés immobiliers.
5. ANIL reste collecté comme source institutionnelle niveau B.
6. Le flux ajoute `source_stats` pour faciliter les contrôles futurs.
7. Les textes Légifrance repérés sont marqués `Publié au JORF`, et non automatiquement `En vigueur`.

Après import sur GitHub, le workflow `Update Immo Radar` se lancera automatiquement.
