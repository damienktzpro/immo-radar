# Radar Immobilier — V7 Demo Pro

Version préparée pour une première revue par un professionnel de l'immobilier.

## Ce que la V7 cherche à démontrer

Radar Immobilier n'est pas présenté comme une source officielle en soi.
Il agrège, hiérarchise et explique des informations immobilières provenant de sources distinctes.

La V7 privilégie donc :
- la traçabilité ;
- l'affichage de la période ;
- les limites méthodologiques ;
- la distinction entre source officielle, institutionnelle, média et analyse ;
- l'absence de chiffres inventés lorsqu'une donnée manque.

## Nouveautés V7

### Recherche globale
La loupe ouvre maintenant une vraie recherche transversale :
- actualités ;
- lois ;
- marché ;
- investissement ;
- territoires ;
- archive 2026.

Filtres :
- Tout 2026 ;
- 30 jours ;
- 7 jours.

L'archive est progressive. Elle n'est pas présentée comme exhaustive.

### Archive 2026
Le collecteur quotidien conserve automatiquement les contenus 2026 dans :

`data/archive/2026.json`

Un workflow manuel permet également un backfill best-effort via les sitemaps publics :

`Actions → Backfill Immo Radar 2026 → Run workflow`

Ce backfill ne doit pas être présenté comme exhaustif.

### Sources plus robustes
Les appels HTTP ont maintenant :
- retries ;
- backoff ;
- gestion des codes 429 / 5xx ;
- conservation du dernier contenu connu si une source tombe temporairement.

La santé d'une source distingue :
- OK ;
- OK mais aucun contenu immobilier pertinent ;
- Dégradée — cache conservé ;
- Erreur.

### Baromètre
Le score national est désormais explicitement présenté comme un indice propre au Radar.

Le 48/100 est calculé à partir de six composantes :
- prix ;
- transactions ;
- taux de crédit ;
- production de crédit ;
- construction ;
- tension locative.

Les pondérations sont visibles dans « Comprendre le score ».

Il ne s'agit pas d'un indicateur officiel ni d'une prévision.

### Territoires
Données locales :
- API géographique officielle ;
- statistiques DVF ;
- carte des loyers 2025 ;
- ADEME DPE ;
- Géorisques.

Les cartes locales affichent autant que possible :
- source ;
- période ;
- volume / échantillon ;
- avertissement méthodologique.

Important :
- les statistiques DVF agrègent plusieurs semestres ;
- la carte des loyers 2025 fournit des loyers d'annonce expérimentaux, charges comprises ;
- les DPE ADEME ne couvrent pas tout le parc immobilier ;
- « aucun DPE trouvé » ne signifie pas qu'aucun bien de la commune n'a de DPE.

### Feedback métier
Un bouton `Feedback` permet au testeur de :
- signaler si les données lui semblent cohérentes ;
- indiquer ce qui manque ;
- copier un retour structuré à envoyer au créateur du site.

## Workflows

### Mise à jour normale
`.github/workflows/update.yml`

- toutes les 6 heures ;
- collecte nationale ;
- données territoriales ;
- archive progressive ;
- commit de `data/`.

### Backfill 2026
`.github/workflows/backfill-2026.yml`

Workflow manuel uniquement.

## Installation

Importer tout le contenu du ZIP à la racine du dépôt GitHub.

Commit conseillé :

`V7 - Demo Pro`

Puis :
1. attendre `Update Immo Radar` au vert ;
2. recharger le site en vidant le cache ;
3. lancer une fois `Backfill Immo Radar 2026` depuis l'onglet Actions si vous souhaitez enrichir l'historique avant la démo.

## Points à demander au professionnel

- Les chiffres locaux lui paraissent-ils cohérents avec sa connaissance du terrain ?
- Les périodes sont-elles assez visibles ?
- Le rendement brut indicatif est-il utile ou trompeur ?
- Le baromètre national a-t-il du sens comme synthèse ?
- Quelles données locales manquent réellement ?
- Les lois et réglementations sont-elles assez simples à comprendre ?
- Quelles sources professionnelles faudrait-il ajouter ?
- Le site aide-t-il à prendre une décision ou crée-t-il encore trop de bruit ?

## Limites assumées

Radar Immobilier est une version bêta.

Les décisions immobilières, juridiques, fiscales ou financières doivent être vérifiées auprès de la source officielle ou d'un professionnel compétent.
