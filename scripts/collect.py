#!/usr/bin/env python3
"""
Immo Radar V1.1 — collecteur multi-sources.

Sources activées :
- Service-Public.fr : RSS officiel des actualités particuliers (niveau A)
- Légifrance : derniers Journaux officiels, filtrés par thèmes immobiliers (niveau A)
- ANIL : actualités et analyses logement (niveau B)

Principes de prudence :
- un texte repéré dans le JORF est étiqueté "Publié au JORF",
  pas automatiquement "en vigueur" ;
- les publications ANIL restent niveau B institutionnel ;
- les notes techniques de développement sont supprimées du flux public ;
- aucune opinion/blog ne peut être promue au niveau A ou B.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
FEED_PATH = ROOT / "data" / "feed.json"

UA = (
    "Mozilla/5.0 (compatible; ImmoRadar/1.1; "
    "+https://github.com/damienktzpro/immo-radar)"
)

TIMEOUT = 25
MAX_ITEMS = 180
MAX_AGE_DAYS = 365

SERVICE_PUBLIC_RSS = (
    "https://www.service-public.fr/abonnements/"
    "rss/actu-actualites-particuliers.rss"
)
ANIL_ACTUS = "https://www.anil.org/actualites-evenements/"
LEGIFRANCE_HOME = "https://www.legifrance.gouv.fr/"

REAL_ESTATE_KEYWORDS = (
    "immobilier", "logement", "habitation", "loyer", "location", "locataire",
    "bailleur", "bail ", "baux", "copropriété", "copropriete", "syndic",
    "construction", "urbanisme", "foncier", "propriété", "propriete",
    "dpe", "diagnostic de performance énergétique",
    "diagnostic de performance energetique", "rénovation énergétique",
    "renovation energetique", "passoire thermique", "meublé de tourisme",
    "meuble de tourisme", "taxe foncière", "taxe fonciere",
    "prêt à taux zéro", "pret a taux zero", "ptz", "crédit immobilier",
    "credit immobilier", "action logement", "anah", "ma prime rénov",
    "ma prime renov", "maPrimeRénov".lower(), "encadrement des loyers",
    "permis de construire", "vente immobilière", "vente immobiliere",
)

CATEGORY_KEYWORDS = {
    "lois": (
        "loi", "décret", "decret", "arrêté", "arrete", "ordonnance",
        "règlement", "reglement", "juridique", "journal officiel",
        "loyer", "bail", "copropriété", "copropriete", "fiscal",
    ),
    "marche": (
        "prix", "marché", "marche", "taux", "crédit", "credit",
        "transaction", "vente", "construction", "loyer", "indice",
    ),
    "investir": (
        "invest", "bailleur", "fiscal", "location", "rendement",
        "meublé", "meuble", "loc'avantages", "scpi",
    ),
    "territoires": (
        "commune", "territoire", "ville", "département", "departement",
        "local", "observatoire", "zone tendue", "urbanisme",
    ),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = BeautifulSoup(html.unescape(value), "html.parser").get_text(" ")
    return " ".join(value.split())


def normalize_url(value: str) -> str:
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except Exception:
        return value


def stable_id(source: str, title: str, url: str) -> str:
    raw = f"{source}|{title}|{normalize_url(url)}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def is_real_estate(text: str) -> bool:
    txt = clean_text(text).lower()
    return any(keyword in txt for keyword in REAL_ESTATE_KEYWORDS)


def classify(text: str) -> str:
    txt = clean_text(text).lower()

    best_category = "marche"
    best_score = 0

    for category, words in CATEGORY_KEYWORDS.items():
        score = sum(1 for word in words if word in txt)
        if score > best_score:
            best_category = category
            best_score = score

    return best_category


def audience_for(category: str, text: str) -> list[str]:
    txt = text.lower()

    if any(x in txt for x in ("bailleur", "invest", "fiscal", "meublé", "rendement")):
        return ["investisseur", "pro", "particulier"]

    if any(x in txt for x in ("copropriété", "syndic", "professionnel", "urbanisme")):
        return ["pro", "particulier", "investisseur"]

    return ["particulier", "investisseur", "pro"]


def score_item(
    title: str,
    source_level: str,
    category: str,
    status: str,
) -> tuple[int, int]:
    txt = title.lower()

    importance = 55
    relevance = 60

    if source_level == "A":
        importance += 12
        relevance += 10
    elif source_level == "B":
        importance += 7
        relevance += 7

    if category == "lois":
        importance += 8
        relevance += 7
    elif category == "marche":
        relevance += 5
    elif category == "investir":
        relevance += 6

    strong = (
        "loi", "décret", "decret", "entrée en vigueur", "entree en vigueur",
        "journal officiel", "taux", "irl", "fiscal", "loyer", "dpe",
        "prêt à taux zéro", "pret a taux zero",
    )
    importance += min(18, 3 * sum(1 for word in strong if word in txt))

    if "jorf" in status.lower():
        importance += 6

    return min(100, importance), min(100, relevance)


def parse_struct_time(entry) -> str:
    parsed = getattr(entry, "published_parsed", None) or getattr(
        entry, "updated_parsed", None
    )
    if parsed:
        dt = datetime(*parsed[:6], tzinfo=timezone.utc)
        return dt.astimezone().isoformat(timespec="seconds")
    return now_iso()


def extract_french_date(text: str) -> str | None:
    months = {
        "janvier": 1,
        "février": 2,
        "fevrier": 2,
        "mars": 3,
        "avril": 4,
        "mai": 5,
        "juin": 6,
        "juillet": 7,
        "août": 8,
        "aout": 8,
        "septembre": 9,
        "octobre": 10,
        "novembre": 11,
        "décembre": 12,
        "decembre": 12,
    }

    match = re.search(
        r"\b(\d{1,2})\s+"
        r"(janvier|février|fevrier|mars|avril|mai|juin|juillet|"
        r"août|aout|septembre|octobre|novembre|décembre|decembre)"
        r"\s+(20\d{2})\b",
        clean_text(text).lower(),
    )

    if not match:
        return None

    day = int(match.group(1))
    month = months[match.group(2)]
    year = int(match.group(3))

    return datetime(
        year, month, day, 8, 0, tzinfo=timezone.utc
    ).astimezone().isoformat(timespec="seconds")


def make_item(
    *,
    source: str,
    source_level: str,
    source_type: str,
    title: str,
    summary: str,
    url: str,
    published_at: str,
    status: str,
    territory: str = "France",
) -> dict:
    combined = f"{title} {summary}"
    category = classify(combined)
    importance, relevance = score_item(
        title, source_level, category, status
    )

    return {
        "id": stable_id(source, title, url),
        "title": clean_text(title),
        "summary": clean_text(summary)[:520],
        "url": url,
        "source": source,
        "source_level": source_level,
        "source_type": source_type,
        "category": category,
        "audiences": audience_for(category, combined),
        "published_at": published_at,
        "status": status,
        "importance": importance,
        "relevance": relevance,
        "territory": territory,
        "why_it_matters": why_it_matters(category, source_level),
    }


def why_it_matters(category: str, source_level: str) -> str:
    prefix = (
        "Source officielle. "
        if source_level == "A"
        else "Source institutionnelle spécialisée. "
    )

    endings = {
        "lois": (
            "Cette publication peut modifier les règles applicables aux "
            "propriétaires, locataires, investisseurs ou professionnels."
        ),
        "marche": (
            "Cette information peut influencer les prix, les loyers, "
            "le crédit ou le niveau d’activité du marché."
        ),
        "investir": (
            "Cette information peut modifier la fiscalité, les contraintes "
            "ou l’intérêt économique d’un investissement."
        ),
        "territoires": (
            "Cette information peut avoir un impact différent selon la "
            "commune, le département ou la zone concernée."
        ),
    }

    return prefix + endings.get(category, endings["marche"])


def load_existing_items() -> list[dict]:
    if not FEED_PATH.exists():
        return []

    try:
        data = json.loads(FEED_PATH.read_text(encoding="utf-8"))
        return list(data.get("items", []))
    except Exception:
        return []


def collect_service_public(limit: int = 20) -> list[dict]:
    feed = feedparser.parse(
        SERVICE_PUBLIC_RSS,
        request_headers={"User-Agent": UA},
    )

    if getattr(feed, "bozo", False) and not feed.entries:
        raise RuntimeError(
            f"Flux RSS Service-Public illisible: {getattr(feed, 'bozo_exception', '')}"
        )

    items = []

    for entry in feed.entries:
        title = clean_text(getattr(entry, "title", ""))
        summary = clean_text(
            getattr(entry, "summary", "")
            or getattr(entry, "description", "")
        )
        link = getattr(entry, "link", "")

        if not title or not link:
            continue

        if not is_real_estate(f"{title} {summary}"):
            continue

        items.append(
            make_item(
                source="Service-Public.fr",
                source_level="A",
                source_type="officielle",
                title=title,
                summary=summary or (
                    "Actualité officielle repérée dans le flux RSS "
                    "de Service-Public.fr."
                ),
                url=link,
                published_at=parse_struct_time(entry),
                status="Information officielle",
            )
        )

        if len(items) >= limit:
            break

    return items


def collect_anil(limit: int = 30) -> list[dict]:
    response = requests.get(
        ANIL_ACTUS,
        timeout=TIMEOUT,
        headers={"User-Agent": UA},
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    items = []
    seen = set()

    for anchor in soup.select(
        'a[href*="/actualites-evenements/details/"]'
    ):
        title = clean_text(anchor.get_text(" ", strip=True))
        url = urljoin(ANIL_ACTUS, anchor.get("href", ""))

        if (
            not title
            or len(title) < 8
            or url in seen
        ):
            continue

        seen.add(url)

        container = anchor
        for _ in range(3):
            if container.parent:
                container = container.parent

        context = clean_text(container.get_text(" ", strip=True))
        published = extract_french_date(context) or now_iso()

        if not is_real_estate(f"{title} {context}"):
            continue

        items.append(
            make_item(
                source="ANIL",
                source_level="B",
                source_type="institutionnelle",
                title=title,
                summary=(
                    "Publication de l’ANIL repérée automatiquement. "
                    "Consultez la source pour l’analyse juridique ou "
                    "pratique complète."
                ),
                url=url,
                published_at=published,
                status="Analyse / actualité ANIL",
            )
        )

        if len(items) >= limit:
            break

    return items


def latest_jorf_urls(limit: int = 8) -> list[str]:
    response = requests.get(
        LEGIFRANCE_HOME,
        timeout=TIMEOUT,
        headers={"User-Agent": UA},
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    urls = []

    pattern = re.compile(
        r"/eli/jo/20\d{2}/\d{1,2}/\d{1,2}/\d+"
    )

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")

        if not pattern.search(href):
            continue

        url = urljoin(LEGIFRANCE_HOME, href)

        if url not in urls:
            urls.append(url)

        if len(urls) >= limit:
            break

    return urls


def collect_legifrance(limit: int = 35) -> list[dict]:
    items = []
    seen = set()

    for jorf_url in latest_jorf_urls():
        response = requests.get(
            jorf_url,
            timeout=TIMEOUT,
            headers={"User-Agent": UA},
        )
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        page_text = clean_text(soup.get_text(" ", strip=True))
        published = extract_french_date(page_text) or now_iso()

        # Les textes du JORF sont normalement liés depuis la page du numéro.
        # On parcourt tous les liens et on ne conserve que les intitulés
        # comportant un vocabulaire immobilier.
        for anchor in soup.find_all("a", href=True):
            title = clean_text(anchor.get_text(" ", strip=True))

            if len(title) < 12:
                continue

            if not is_real_estate(title):
                continue

            href = anchor.get("href", "")
            url = urljoin(jorf_url, href)

            # Évite navigation, PDF génériques et doublons.
            if not url.startswith("https://www.legifrance.gouv.fr/"):
                continue

            key = normalize_url(url) or title.lower()
            if key in seen:
                continue

            seen.add(key)

            items.append(
                make_item(
                    source="Légifrance",
                    source_level="A",
                    source_type="officielle",
                    title=title,
                    summary=(
                        "Texte repéré dans un Journal officiel récent "
                        "à partir de mots-clés immobiliers. "
                        "Le statut affiché signifie qu’il est publié au JORF ; "
                        "la date d’entrée en vigueur doit être vérifiée dans le texte."
                    ),
                    url=url,
                    published_at=published,
                    status="Publié au JORF",
                )
            )

            if len(items) >= limit:
                return items

    return items


def is_development_note(item: dict) -> bool:
    status = str(item.get("status", "")).lower()
    title = str(item.get("title", "")).lower()
    item_id = str(item.get("id", "")).lower()

    return (
        "connecteur prévu" in status
        or item_id.startswith("demo-")
        or title.startswith("prochaine étape :")
    )


def not_too_old(item: dict) -> bool:
    value = item.get("published_at")
    if not value:
        return True

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
        return dt.astimezone(timezone.utc) >= cutoff
    except Exception:
        return True


def dedupe(items: list[dict]) -> list[dict]:
    by_key = {}

    for item in items:
        if is_development_note(item):
            continue

        if not not_too_old(item):
            continue

        url = normalize_url(item.get("url", ""))
        title = clean_text(item.get("title", "")).lower()

        key = url or title

        if not key:
            continue

        current = by_key.get(key)

        if current is None:
            by_key[key] = item
            continue

        # En cas de doublon, garde le niveau le plus fiable,
        # puis la meilleure pertinence.
        rank = {"A": 4, "B": 3, "C": 2, "D": 1}
        new_tuple = (
            rank.get(item.get("source_level"), 0),
            item.get("relevance", 0),
        )
        old_tuple = (
            rank.get(current.get("source_level"), 0),
            current.get("relevance", 0),
        )

        if new_tuple > old_tuple:
            by_key[key] = item

    return sorted(
        by_key.values(),
        key=lambda x: x.get("published_at", ""),
        reverse=True,
    )[:MAX_ITEMS]


def source_stats(items: list[dict]) -> dict:
    stats = {}

    for item in items:
        source = item.get("source", "Inconnue")
        stats[source] = stats.get(source, 0) + 1

    return dict(sorted(stats.items(), key=lambda kv: (-kv[1], kv[0])))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Ne contacte pas Internet et nettoie uniquement les données existantes.",
    )
    args = parser.parse_args()

    items = load_existing_items()
    errors = []

    collectors = [
        ("Service-Public.fr", collect_service_public),
        ("Légifrance", collect_legifrance),
        ("ANIL", collect_anil),
    ]

    if not args.demo:
        for name, collector in collectors:
            try:
                new_items = collector()
                items.extend(new_items)
                print(f"{name}: {len(new_items)} élément(s) pertinent(s)")
            except Exception as exc:
                errors.append({
                    "source": name,
                    "error": f"{type(exc).__name__}: {exc}",
                })
                print(f"{name}: erreur non bloquante: {exc}")

    items = dedupe(items)

    feed = {
        "generated_at": now_iso(),
        "version": "1.1",
        "items": items,
        "source_stats": source_stats(items),
        "errors": errors,
    }

    FEED_PATH.write_text(
        json.dumps(feed, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(
        f"{len(items)} éléments écrits dans {FEED_PATH}. "
        f"Sources: {feed['source_stats']}"
    )


if __name__ == "__main__":
    main()
