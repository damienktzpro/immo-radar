# Radar Immobilier V3 — Product Upgrade

Grosse mise à jour en une seule fois.

## Ce qui change

### Design
- Identité claire premium, mais plus originale que la maquette de référence.
- Hero plus compact.
- Navigation sticky.
- Baromètre + mini tendance.
- Sidebar dynamique.
- Mobile corrigé : aucun chevauchement sidebar / Sources.

### Aujourd'hui
- Trois horizons : Récent / Cette semaine / À connaître.
- Les contenus sans date ne sont jamais affichés comme « à l'instant ».
- Recherche globale.
- Favoris et Plus/Moins comme ça.

### Lois
- Tableau de bord France séparé de l'Union européenne.
- France : déposé / discussion / adopté / promulgué / publié.
- Europe : publication et besoin de transposition distingués.

### Marché
- Score explicable.
- Composantes avec source, période et tendance.
- Sidebar Marché dédiée.

### Investir
- Mini tableau de bord LMNP / location nue / SCPI / ancien + travaux.

### Sources & monitoring
- Niveaux A/B/C/D.
- Santé du collecteur par source.
- Nombre d'infos retenues, rejetées et erreurs.
- 15 sources configurées.

### Filtre immobilier
- Les thèmes voiture / automobile / smartphone / sport / crypto sont rejetés sans marqueur immobilier explicite.
- Les mots « achat », « crédit », « location » seuls ne suffisent pas.

## Installation

Dans GitHub `immo-radar` :
1. Code → Add file → Upload files
2. Importer le contenu de cette archive à la racine :
   - index.html
   - styles.css
   - app.js
   - requirements.txt
   - scripts/collect.py
   - data/feed.json
   - data/market.json
   - data/sources.json
3. Commit : `Radar Immobilier V3 - Product Upgrade`
4. Attendre `Update Immo Radar` ✅
5. Recharger avec Cmd+Shift+R.

Le workflow GitHub Actions existant peut rester inchangé.
