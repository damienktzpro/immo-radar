# Radar Immobilier — V7.1 Mobile Polish

Cette version conserve le rendu desktop de la V7 et retravaille fortement l’expérience téléphone.

## Mobile

- header réduit à logo + recherche + menu hamburger ;
- navigation dans un menu déroulant propre ;
- hero plus compact ;
- profils utilisables en une ligne ;
- baromètre redimensionné pour téléphone ;
- chiffres-clés conservés sur une seule ligne ;
- détails du score en carrousel horizontal ;
- étapes juridiques en stepper horizontal ;
- filtres scrollables ;
- 5 articles affichés par défaut, puis bouton « afficher 5 de plus » ;
- cartes d’actualité raccourcies ;
- résumés et « pourquoi c’est important » repliés avec bouton Lire plus ;
- actions Favori / Plus / Moins masquées sur mobile pour éviter le bruit ;
- cartes Territoires en carrousel horizontal ;
- sources locales compactées ;
- sidebar et footer raccourcis.

## Qualité du collecteur

Le patch ajoute également un nettoyage léger des pages éditoriales :
- rejet de titres de navigation comme « Page suivante », « Accueil », etc. ;
- préférence pour le conteneur article / liste le plus proche ;
- limitation des gros blocs de navigation utilisés comme résumés.

Le nettoyage prendra pleinement effet après le prochain workflow `Update Immo Radar`.

## Installation

Importer à la racine du repo :
- `index.html`
- `app.js`
- `styles.css`
- `scripts/collect.py`

Vous pouvez aussi remplacer tous les fichiers avec le contenu du ZIP.

Commit conseillé :

`V7.1 - Mobile polish`

Puis :
1. attendre `Update Immo Radar` au vert ;
2. recharger le site avec cache vidé ;
3. tester en largeur iPhone / Android ;
4. ouvrir 2 ou 3 articles pour vérifier les liens.
