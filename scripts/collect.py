#!/usr/bin/env python3
"""
Collecteur V1 d'Immo Radar.

Objectif:
- conserver les cartes déjà présentes;
- récupérer les dernières actualités ANIL avec un scraper volontairement prudent;
- dédupliquer;
- recalculer des scores simples;
- écrire data/feed.json.

Les connecteurs Légifrance, INSEE, Banque de France et DVF sont prévus ensuite.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
FEED_PATH = ROOT / "data" / "feed.json"
UA = "ImmoRadar/1.0 (+GitHub Pages personal project)"

KEYWORDS = {
    "lois": ("loi", "juridique", "loyer", "décret", "réglement", "fiscal", "copropriété", "bail"),
    "marche": ("taux", "prix", "marché", "loyer", "crédit", "transaction", "construction"),
    "investir": ("invest", "bailleur", "loc'avantages", "fiscal", "location", "rendement", "scpi"),
    "territoires": ("commune", "territoire", "local", "observatoire", "loyers", "ville", "département"),
}

def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

def load_feed() -> dict:
    if FEED_PATH.exists():
        return json.loads(FEED_PATH.read_text(encoding="utf-8"))
    return {"generated_at": now_iso(), "items": []}

def stable_id(source: str, title: str, url: str) -> str:
    raw = f"{source}|{title}|{url}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]

def classify(title: str) -> str:
    txt = title.lower()
    best = ("marche", 0)
    for category, words in KEYWORDS.items():
        score = sum(1 for word in words if word in txt)
        if score > best[1]:
            best = (category, score)
    return best[0]

def score_item(title: str, category: str) -> tuple[int, int]:
    txt = title.lower()
    importance = 58
    relevance = 62

    strong = ("loi", "décret", "entrée en vigueur", "journal officiel", "taux", "irl", "fiscal")
    importance += min(24, 6 * sum(1 for w in strong if w in txt))

    if category == "lois":
        relevance += 10
    elif category == "marche":
        relevance += 7
    elif category == "investir":
        relevance += 8

    return min(100, importance), min(100, relevance)

def extract_date(text: str) -> str | None:
    months = {
        "janvier":1,"février":2,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,
        "juillet":7,"août":8,"aout":8,"septembre":9,"octobre":10,"novembre":11,"décembre":12,"decembre":12
    }
    m = re.search(r"\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(20\d{2})\b", text.lower())
    if not m:
        return None
    day, month_name, year = int(m.group(1)), m.group(2), int(m.group(3))
    return datetime(year, months[month_name], day, 8, 0).astimezone().isoformat(timespec="seconds")

def collect_anil(limit: int = 20) -> list[dict]:
    url = "https://www.anil.org/actualites-evenements/"
    r = requests.get(url, timeout=20, headers={"User-Agent": UA})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    found = []
    seen = set()

    # Le site ANIL utilise des liens /actualites-evenements/details/ pour les fiches.
    for a in soup.select('a[href*="/actualites-evenements/details/"]'):
        title = " ".join(a.get_text(" ", strip=True).split())
        href = urljoin(url, a.get("href", ""))
        if not title or len(title) < 8 or href in seen:
            continue
        seen.add(href)

        parent_text = " ".join((a.parent.parent if a.parent and a.parent.parent else a).get_text(" ", strip=True).split())
        published = extract_date(parent_text) or now_iso()
        category = classify(title)
        importance, relevance = score_item(title, category)

        found.append({
            "id": stable_id("ANIL", title, href),
            "title": title,
            "summary": "Nouvelle publication repérée automatiquement sur le site de l’ANIL. Ouvrez la source pour consulter le contenu complet.",
            "url": href,
            "source": "ANIL",
            "source_level": "B",
            "source_type": "institutionnelle",
            "category": category,
            "audiences": ["particulier", "investisseur", "pro"],
            "published_at": published,
            "status": "Publication ANIL",
            "importance": importance,
            "relevance": relevance,
            "territory": "France",
            "why_it_matters": "Source institutionnelle dédiée au logement ; le contenu est classé automatiquement pour faciliter la veille."
        })
        if len(found) >= limit:
            break

    return found

def dedupe(items: list[dict]) -> list[dict]:
    by_key = {}
    for item in items:
        key = (item.get("url") or item.get("title", "")).strip().lower()
        if not key:
            continue
        old = by_key.get(key)
        if old is None or item.get("relevance", 0) > old.get("relevance", 0):
            by_key[key] = item
    return sorted(by_key.values(), key=lambda x: x.get("published_at", ""), reverse=True)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="Ne contacte pas Internet; conserve les données existantes.")
    args = parser.parse_args()

    feed = load_feed()
    items = list(feed.get("items", []))
    errors = []

    if not args.demo:
        try:
            items.extend(collect_anil())
        except Exception as exc:
            errors.append({"source": "ANIL", "error": str(exc)})

    feed = {
        "generated_at": now_iso(),
        "items": dedupe(items)[:120],
        "errors": errors,
    }
    FEED_PATH.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(feed['items'])} éléments écrits dans {FEED_PATH}")
    if errors:
        print("Erreurs non bloquantes:", errors)

if __name__ == "__main__":
    main()
