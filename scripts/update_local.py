#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "territories"
MONITORED = DATA_DIR / "monitored.json"

UA = "Mozilla/5.0 (compatible; RadarImmobilier/5.1; +https://github.com/damienktzpro/immo-radar)"
TIMEOUT = 25

GEO_BASE = "https://geo.api.gouv.fr"
ADEME_DPE_AGG = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg"
GEORISQUES_REPORT = "https://georisques.gouv.fr/api/v1/resultats_rapport_risque"


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def get_json(url, *, params=None, timeout=TIMEOUT):
    r = requests.get(
        url,
        params=params,
        timeout=timeout,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    r.raise_for_status()
    if not r.text.strip():
        return {}
    return r.json()


def fetch_geo(code):
    fields = "nom,code,codesPostaux,population,surface,departement,region,codeDepartement,codeRegion,centre"
    return get_json(
        f"{GEO_BASE}/communes/{code}",
        params={"fields": fields, "format": "json"},
    )


def _bucket_label(bucket):
    for key in ("value", "key", "label", "_id", "name"):
        value = bucket.get(key)
        if value not in (None, ""):
            return str(value).strip().upper()
    return ""


def _bucket_count(bucket):
    for key in ("count", "doc_count", "nb", "value_count", "total"):
        value = bucket.get(key)
        if isinstance(value, (int, float)):
            return int(value)
    return 0


def parse_dpe_aggregation(data):
    buckets = data.get("aggs") or data.get("aggregations") or []

    if isinstance(buckets, dict):
        # Data Fair / Elastic-like envelopes can nest the bucket list.
        candidates = []
        for value in buckets.values():
            if isinstance(value, list):
                candidates.extend(value)
            elif isinstance(value, dict):
                candidates.extend(value.get("buckets") or value.get("values") or [])
        buckets = candidates

    counts = {label: 0 for label in "ABCDEFG"}
    for bucket in buckets if isinstance(buckets, list) else []:
        if not isinstance(bucket, dict):
            continue
        label = _bucket_label(bucket)
        if label in counts:
            counts[label] += _bucket_count(bucket)

    total = sum(counts.values())
    fg = counts["F"] + counts["G"]
    ab = counts["A"] + counts["B"]

    dominant = None
    if total:
        dominant = max(counts, key=counts.get)

    return {
        "total": total,
        "counts": counts,
        "passoires_pct": round(fg * 100 / total, 1) if total else None,
        "efficient_pct": round(ab * 100 / total, 1) if total else None,
        "dominant_label": dominant,
        "confidence": "high" if total >= 50 else ("low" if total else "none"),
    }


def fetch_dpe(code):
    params = {
        "field": "etiquette_dpe",
        "qs": f'code_insee_ban:"{code}"',
        "agg_size": 20,
        "size": 0,
    }
    data = get_json(ADEME_DPE_AGG, params=params)
    stats = parse_dpe_aggregation(data)
    stats.update({
        "status": "connected" if stats["total"] else "no_data",
        "source": "ADEME — DPE logements existants",
        "source_url": "https://data.ademe.fr/datasets/dpe03existant",
        "api_url": requests.Request("GET", ADEME_DPE_AGG, params=params).prepare().url,
        "scope": "DPE réalisés depuis juillet 2021 — ne représente pas exhaustivement tout le parc",
    })
    return stats


def _walk_present(obj, path=()):
    """Collect a conservative list of risk blocks explicitly flagged present=true."""
    found = []
    if isinstance(obj, dict):
        if obj.get("present") is True:
            label = (
                obj.get("libelle")
                or obj.get("libelleRisque")
                or obj.get("nom")
                or obj.get("type")
                or (path[-1] if path else "Risque")
            )
            found.append(str(label))
        for key, value in obj.items():
            if key in {"present"}:
                continue
            found.extend(_walk_present(value, path + (str(key),)))
    elif isinstance(obj, list):
        for idx, value in enumerate(obj):
            found.extend(_walk_present(value, path + (str(idx),)))
    return found


def _geo_center(geo):
    centre = geo.get("centre") or {}
    coords = centre.get("coordinates") if isinstance(centre, dict) else None
    if isinstance(coords, list) and len(coords) >= 2:
        return float(coords[0]), float(coords[1])  # lon, lat
    return None


def fetch_georisques(code, geo):
    attempts = [
        {"code_insee": code},
    ]
    center = _geo_center(geo)
    if center:
        lon, lat = center
        attempts.append({"latlon": f"{lon:.6f},{lat:.6f}"})

    last_error = None
    data = {}
    api_url = None

    for params in attempts:
        try:
            data = get_json(GEORISQUES_REPORT, params=params)
            api_url = requests.Request("GET", GEORISQUES_REPORT, params=params).prepare().url
            if data:
                break
        except Exception as exc:
            last_error = str(exc)
            continue

    if not data:
        return {
            "status": "error" if last_error else "no_data",
            "error": last_error,
            "source": "Géorisques",
            "source_url": "https://www.georisques.gouv.fr/",
            "report_url": f"https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2/{quote(code)}/commune",
        }

    present = []
    seen = set()
    for label in _walk_present(data):
        normalized = " ".join(label.split()).strip()
        if normalized and normalized.lower() not in seen:
            seen.add(normalized.lower())
            present.append(normalized)

    # The public report URL is kept even if the JSON structure evolves.
    report_url = (
        data.get("url")
        or data.get("urlRapport")
        or data.get("url_rapport")
        or f"https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2/{quote(code)}/commune"
    )

    return {
        "status": "connected",
        "present_count": len(present),
        "present_labels": present[:12],
        "source": "Géorisques",
        "source_url": "https://www.georisques.gouv.fr/",
        "api_url": api_url,
        "report_url": report_url,
        "scope": "Rapport de risques officiel. Le niveau de précision dépend des données disponibles.",
    }


def build_one(code):
    generated = now_iso()
    result = {
        "version": "5.1",
        "generated_at": generated,
        "code_insee": code,
        "identity": None,
        "dpe": {"status": "pending"},
        "risks": {"status": "pending"},
        "dvf": {
            "status": "pending",
            "source": "DVF / data.gouv.fr",
            "source_url": "https://explore.data.gouv.fr/fr/immobilier",
        },
        "rents": {
            "status": "pending",
            "source": "Observatoires locaux des loyers",
            "source_url": "https://www.observatoires-des-loyers.org/",
        },
        "connections": {
            "geo": "pending",
            "dpe": "pending",
            "risks": "pending",
            "dvf": "pending",
            "rents": "pending",
        },
        "errors": [],
    }

    try:
        geo = fetch_geo(code)
        result["identity"] = geo
        result["connections"]["geo"] = "connected"
    except Exception as exc:
        result["errors"].append({"source": "geo", "error": str(exc)})
        result["connections"]["geo"] = "error"
        return result

    try:
        result["dpe"] = fetch_dpe(code)
        result["connections"]["dpe"] = result["dpe"]["status"]
    except Exception as exc:
        result["dpe"] = {"status": "error", "error": str(exc)}
        result["connections"]["dpe"] = "error"
        result["errors"].append({"source": "dpe", "error": str(exc)})

    # Be polite with the 1 req/s risk-report endpoint.
    time.sleep(1.05)
    try:
        result["risks"] = fetch_georisques(code, result["identity"])
        result["connections"]["risks"] = result["risks"]["status"]
    except Exception as exc:
        result["risks"] = {"status": "error", "error": str(exc)}
        result["connections"]["risks"] = "error"
        result["errors"].append({"source": "georisques", "error": str(exc)})

    return result


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(MONITORED.read_text(encoding="utf-8"))
    codes = [str(c).strip() for c in cfg.get("codes", []) if str(c).strip()]

    index = {
        "version": "5.1",
        "generated_at": now_iso(),
        "territories": [],
    }

    for code in codes:
        print(f"[local] {code}")
        try:
            payload = build_one(code)
            path = DATA_DIR / f"{code}.json"
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            index["territories"].append({
                "code_insee": code,
                "name": (payload.get("identity") or {}).get("nom"),
                "generated_at": payload.get("generated_at"),
                "connections": payload.get("connections"),
                "errors": len(payload.get("errors") or []),
            })
        except Exception as exc:
            index["territories"].append({
                "code_insee": code,
                "name": None,
                "generated_at": now_iso(),
                "connections": {},
                "errors": 1,
                "error": str(exc),
            })

    (DATA_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[local] {len(index['territories'])} territoires traités")


if __name__ == "__main__":
    main()
