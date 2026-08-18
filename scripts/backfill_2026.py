#!/usr/bin/env python3
"""
Backfill 2026 best-effort.

Objectif :
- compléter l'archive de recherche à partir des sitemaps publics de sources déjà autorisées ;
- conserver uniquement des pages immobilières datées du 1er janvier 2026 ou après ;
- ne jamais présenter ce backfill comme exhaustif.

Le collecteur quotidien reste la source de vérité pour les nouveautés.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup

import collect as c

ROOT = Path(__file__).resolve().parents[1]
STATUS = ROOT / "data" / "archive" / "backfill-status.json"
START = datetime(2026,1,1,tzinfo=timezone.utc)

SOURCES = [
    ("Service-Public.fr","A","https://www.service-public.fr/"),
    ("Banque de France","A","https://www.banque-france.fr/"),
    ("SDES / Sitadel","A","https://www.statistiques.developpement-durable.gouv.fr/"),
    ("ANIL","B","https://www.anil.org/"),
    ("Notaires de France","B","https://www.notaires.fr/"),
    ("MySweetImmo","C","https://www.mysweetimmo.com/"),
    ("Immo Matin","C","https://www.immomatin.com/"),
    ("Journal de l'Agence","C","https://www.journaldelagence.com/"),
    ("Batiactu","C","https://www.batiactu.com/"),
    ("Immobilier 2.0","C","https://immo2.pro/"),
    ("Horiz.io","D","https://horiz.io/"),
]

MAX_SITEMAPS_PER_SOURCE = 16
MAX_PAGES_PER_SOURCE = 90
SLEEP = 0.12

def host(url):
    return urlsplit(url).netloc.lower().replace("www.","")

def parse_xml(text):
    try:return ET.fromstring(text)
    except:return None

def tag_end(el,name):
    return str(el.tag).lower().endswith(name.lower())

def sitemap_candidates(root):
    out=[urljoin(root,"sitemap.xml")]
    try:
        r=c.http_get(urljoin(root,"robots.txt"))
        if r.ok:
            for line in r.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    u=line.split(":",1)[1].strip()
                    if u and u not in out:out.append(u)
    except Exception:
        pass
    return out

def crawl_sitemaps(root):
    queue=sitemap_candidates(root)
    seen=set();urls=[]
    root_host=host(root)
    while queue and len(seen)<MAX_SITEMAPS_PER_SOURCE:
        sm=queue.pop(0)
        if sm in seen:continue
        seen.add(sm)
        try:
            r=c.http_get(sm)
            if not r.ok:continue
            tree=parse_xml(r.text)
            if tree is None:continue
        except Exception:
            continue

        children=list(tree)
        is_index=any(tag_end(x,"sitemap") for x in children)
        if is_index:
            for node in children:
                loc=next((x.text.strip() for x in node if tag_end(x,"loc") and x.text),None)
                if loc and host(loc)==root_host and loc not in seen and len(queue)<MAX_SITEMAPS_PER_SOURCE*2:
                    queue.append(loc)
        else:
            for node in children:
                loc=next((x.text.strip() for x in node if tag_end(x,"loc") and x.text),None)
                last=next((x.text.strip() for x in node if tag_end(x,"lastmod") and x.text),None)
                if not loc or host(loc)!=root_host:continue
                keep=True
                if last:
                    try:
                        dt=datetime.fromisoformat(last.replace("Z","+00:00"))
                        if not dt.tzinfo:dt=dt.replace(tzinfo=timezone.utc)
                        keep=dt.astimezone(timezone.utc)>=START
                    except:pass
                elif "/2026/" not in loc and "2026-" not in loc:
                    # no reliable date signal: fetch only if room remains
                    keep=True
                if keep:
                    urls.append((loc,last))
                if len(urls)>=MAX_PAGES_PER_SOURCE*3:
                    break
        if len(urls)>=MAX_PAGES_PER_SOURCE*3:
            break
    return urls

def article_from_url(source,level,url,lastmod=None):
    if not c.direct(url):return None
    try:
        r=c.http_get(url)
        if not r.ok:return None
        soup=BeautifulSoup(r.text,"html.parser")
        h1=soup.find("h1")
        og=soup.find("meta",attrs={"property":"og:title"})
        title=c.clean((og.get("content") if og else "") or (h1.get_text(" ",strip=True) if h1 else "") or (soup.title.get_text(" ",strip=True) if soup.title else ""))
        desc=soup.find("meta",attrs={"name":"description"})
        summary=c.clean(desc.get("content") if desc and desc.get("content") else "")
        body=c.clean(soup.get_text(" ",strip=True))
        if not summary:summary=body[:520]
        if len(title)<10 or not c.is_immo(title+" "+summary+" "+body[:1800]):return None

        pub=c.parse_date(body[:5000],url)
        if not pub and lastmod:
            try:
                dt=datetime.fromisoformat(lastmod.replace("Z","+00:00"))
                if not dt.tzinfo:dt=dt.replace(tzinfo=timezone.utc)
                pub=dt.astimezone().isoformat(timespec="seconds")
            except:pass
        if not pub:return None
        try:
            dt=datetime.fromisoformat(pub.replace("Z","+00:00"))
            if not dt.tzinfo:dt=dt.replace(tzinfo=timezone.utc)
            if dt.astimezone(timezone.utc)<START:return None
        except:return None
        return c.make(source,level,title,summary,url,pub,"Archive 2026")
    except Exception:
        return None

def main():
    kept=[];stats={}
    # Seed with the current daily feed.
    try:
        current=json.loads(c.FEED.read_text(encoding="utf-8"))
        kept.extend([i for i in current.get("items",[]) if str(i.get("published_at","")).startswith("2026")])
    except:pass

    for source,level,root in SOURCES:
        urls=crawl_sitemaps(root)
        source_items=[]
        for url,lastmod in urls:
            item=article_from_url(source,level,url,lastmod)
            if item:
                source_items.append(item)
                if len(source_items)>=MAX_PAGES_PER_SOURCE:break
            time.sleep(SLEEP)
        kept.extend(source_items)
        stats[source]={"candidate_urls":len(urls),"retained":len(source_items)}
        print(source,len(source_items),"archive items")

    c._merge_archive(kept)
    STATUS.parent.mkdir(parents=True,exist_ok=True)
    STATUS.write_text(json.dumps({
        "generated_at":c.now(),
        "scope":"Backfill best-effort depuis le 1er janvier 2026. Non exhaustif.",
        "sources":stats,
        "retained_this_run":len(kept)
    },ensure_ascii=False,indent=2),encoding="utf-8")
    print("Backfill terminé",len(kept))

if __name__=="__main__":main()
