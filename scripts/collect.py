#!/usr/bin/env python3
from __future__ import annotations
import hashlib, html, io, json, os, re, zipfile, time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
import feedparser, requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
FEED=ROOT/"data"/"feed.json"
ARCHIVE=ROOT/"data"/"archive"/"2026.json"
UA="Mozilla/5.0 (compatible; RadarImmobilier/7.0; +https://github.com/damienktzpro/immo-radar)"
TIMEOUT=22
MAX_PER_SOURCE=16
MAX_TOTAL=240

_RETRY=Retry(
    total=3,
    connect=3,
    read=3,
    status=3,
    backoff_factor=0.8,
    status_forcelist=(429,500,502,503,504),
    allowed_methods=frozenset(["GET"]),
    respect_retry_after_header=True,
)
_SESSION=requests.Session()
_SESSION.headers.update({"User-Agent":UA,"Accept-Language":"fr-FR,fr;q=0.9,en;q=0.5"})
_SESSION.mount("https://",HTTPAdapter(max_retries=_RETRY))
_SESSION.mount("http://",HTTPAdapter(max_retries=_RETRY))

def http_get(url,**kwargs):
    kwargs.setdefault("timeout",TIMEOUT)
    headers=kwargs.pop("headers",{}) or {}
    merged={"User-Agent":UA,**headers}
    return _SESSION.get(url,headers=merged,**kwargs)


ANCHORS=(
"immobilier","immobilière","immobiliere","logement","logements","habitation","maison","appartement",
"loyer","loyers","locataire","bailleur","bail d'habitation","copropriété","copropriete","syndic",
"construction de logements","construction neuve","permis de construire","mise en chantier","urbanisme",
"foncier","foncière","fonciere","vente immobilière","vente immobiliere","transaction immobilière",
"transaction immobiliere","prix des logements","prix immobilier","prix au m²","prix au m2","dpe",
"diagnostic de performance énergétique","diagnostic de performance energetique","diagnostic immobilier",
"rénovation énergétique","renovation energetique","passoire thermique","meublé de tourisme","meuble de tourisme",
"location meublée","location meublee","location nue","lmnp","lmp","scpi","opci","crédit immobilier",
"credit immobilier","crédit à l'habitat","credit a l'habitat","prêt immobilier","pret immobilier",
"prêt à taux zéro","pret a taux zero","ptz","taux immobilier","action logement","anah","maprimerénov",
"maprimerenov","agence immobilière","agence immobiliere","agent immobilier","mandataire immobilier",
"promoteur immobilier","promotion immobilière","promotion immobiliere","proptech","résidence principale",
"residence principale","résidence secondaire","residence secondaire","performance énergétique des bâtiments",
"performance energetique des batiments","marché immobilier","marche immobilier","parc immobilier",
"patrimoine immobilier","taxe foncière","taxe fonciere","plus-value immobilière","plus-value immobiliere",
"fiscalité immobilière","fiscalite immobiliere","gestion locative","marché locatif","marche locatif"
)
REJECT=("voiture","voitures","véhicule","vehicule","automobile","moto","scooter","vélo","velo","batterie",
"borne de recharge","bonus écologique","bonus ecologique","leasing social","permis de conduire","smartphone",
"console","football","basket","tennis","cryptomonnaie","crypto-monnaie","bitcoin")
MONTHS={"janvier":1,"février":2,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,"juillet":7,
"août":8,"aout":8,"septembre":9,"octobre":10,"novembre":11,"décembre":12,"decembre":12}

def now(): return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
def clean(v):
    if not v:return ""
    return " ".join(BeautifulSoup(html.unescape(str(v)),"html.parser").get_text(" ").split())
def norm_url(v):
    try:
        p=urlsplit(v);return urlunsplit((p.scheme,p.netloc,p.path,"",""))
    except:return v or ""
def sid(source,title,url):return hashlib.sha1(f"{source}|{title}|{norm_url(url)}".encode()).hexdigest()[:16]
def is_immo(text):
    t=clean(text).lower();has=any(k in t for k in ANCHORS)
    if any(k in t for k in REJECT) and not has:return False
    return has
def direct(url):
    if not url:return False
    p=urlsplit(norm_url(url));path=p.path.rstrip("/")
    return path not in ("","/fr","/actualites","/actualites-evenements","/centre-de-ressources","/dossiers-legislatifs","/actualite-immobilier")
def parse_date(text,url=""):
    t=clean(text).lower()
    m=re.search(r"\b(\d{1,2})\s+("+ "|".join(MONTHS)+r")\s+(20\d{2})\b",t)
    if m:return datetime(int(m.group(3)),MONTHS[m.group(2)],int(m.group(1)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
    m=re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b",t)
    if m:return datetime(int(m.group(3)),int(m.group(2)),int(m.group(1)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
    m=re.search(r"/(20\d{2})/(\d{1,2})/(\d{1,2})/",url)
    if m:return datetime(int(m.group(1)),int(m.group(2)),int(m.group(3)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
    return None
def category(text,source=""):
    t=clean(text).lower()
    if any(x in t for x in ("loi","décret","decret","directive","règlement","reglement","journal officiel","juridique")):return"lois"
    if any(x in t for x in ("crédit immobilier","credit immobilier","crédit à l'habitat","credit a l'habitat","prêt immobilier","pret immobilier","taux immobilier")):return"credit"
    if any(x in t for x in ("lmnp","scpi","rendement","investissement locatif","fiscalité immobilière","fiscalite immobiliere")):return"investir"
    if any(x in t for x in ("commune","agglomération","agglomeration","territoire","local","dvf")):return"territoires"
    if source in ("Immobilier 2.0","Journal de l'Agence") and any(x in t for x in ("proptech","agent immobilier","agence immobilière","syndic","professionnel")):return"pro"
    return"marche"
def audiences(text,c):
    t=text.lower()
    if c=="pro":return["pro","investisseur"]
    if c=="investir" or any(x in t for x in ("bailleur","lmnp","scpi","rendement")):return["investisseur","pro","particulier"]
    return["particulier","investisseur","pro"]
def why(c,level):
    prefix="Source officielle. " if level=="A" else "Source institutionnelle. " if level=="B" else "Source éditoriale immobilière sélectionnée. " if level=="C" else "Source expert / blog à confronter aux données officielles. "
    tails={"lois":"Cette évolution peut modifier les règles applicables aux propriétaires, locataires, investisseurs ou professionnels.","credit":"Le financement détermine directement le pouvoir d’achat immobilier et la faisabilité des projets.","investir":"Cette information peut modifier le rendement, la fiscalité ou le risque d’un investissement.","territoires":"Cette donnée locale aide à comparer plus précisément les marchés.","pro":"Ce signal peut faire évoluer les pratiques et outils des professionnels de l’immobilier.","marche":"Cette information aide à lire les prix, la demande, l’offre ou le niveau d’activité du marché."}
    return prefix+tails.get(c,tails["marche"])
def make(source,level,title,summary,url,pub,status="",territory="France",legal_stage=None,topic=None):
    text=f"{title} {summary}";c=category(text,source);base={"A":82,"B":76,"C":67,"D":60}.get(level,60)
    d={"id":sid(source,title,url),"title":clean(title),"summary":clean(summary)[:540],"url":url,"source":source,
    "source_level":level,"category":c,"audiences":audiences(text,c),"published_at":pub,"status":status,
    "importance":min(100,base+(9 if c=="lois" else 6)),"relevance":min(100,base+6),
    "territory":territory,"topic":topic or c.capitalize(),"why_it_matters":why(c,level)}
    if legal_stage:d["legal_stage"]=legal_stage
    return d

def service_public():
    f=feedparser.parse("https://www.service-public.fr/abonnements/rss/actu-actualites-particuliers.rss",request_headers={"User-Agent":UA});out=[]
    for e in f.entries:
        title=clean(getattr(e,"title",""));summary=clean(getattr(e,"summary",""));url=getattr(e,"link","")
        if not is_immo(title+" "+summary) or not direct(url):continue
        p=getattr(e,"published_parsed",None);pub=datetime(*p[:6],tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds") if p else parse_date(summary,url)
        out.append(make("Service-Public.fr","A",title,summary,url,pub,"Information officielle"))
    return out[:MAX_PER_SOURCE]


BAD_TITLES=(
    "page suivante","page précédente","aller au contenu principal","accueil",
    "toutes les actualités","carte des prix immobiliers","en savoir plus",
    "lire la suite","voir plus","menu","rechercher"
)
def bad_editorial_title(title):
    t=clean(title).lower().strip(" ›»:-")
    if len(t)<14:return True
    if t in BAD_TITLES:return True
    if any(t.startswith(x) and len(t)<55 for x in BAD_TITLES):return True
    return False

def editorial_context(a,title):
    # Prefer the nearest semantic article/list item rather than climbing to a whole page.
    node=a.find_parent(["article","li"])
    if node is None:
        node=a.parent
        for _ in range(2):
            if node and node.parent:node=node.parent
    context=clean(node.get_text(" ",strip=True)) if node else title
    # If a listing container is still huge, keep the local text around this title only.
    if len(context)>1100:
        pos=context.lower().find(clean(title).lower())
        if pos>=0:context=context[max(0,pos-80):pos+760]
        else:context=context[:760]
    return context

def generic(page,source,level,require_date=True):
    r=http_get(page,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status()
    s=BeautifulSoup(r.text,"html.parser");out=[];seen=set();rejected=0
    for a in s.find_all("a",href=True):
        title=clean(a.get_text(" ",strip=True));url=urljoin(page,a.get("href",""))
        if bad_editorial_title(title) or len(title)>190 or not direct(url) or url in seen:continue
        context=editorial_context(a,title);text=f"{title} {context}"
        if not is_immo(text):rejected+=1;continue
        pub=parse_date(context,url)
        if require_date and not pub:rejected+=1;continue
        seen.add(url)
        summary=context.replace(title,"",1).strip()
        summary=re.sub(r"\s+(Lire l'actualité|Lire la suite|En savoir plus)\s*$","",summary,flags=re.I)
        summary=(summary[:430] or title).strip()
        out.append(make(source,level,title,summary,url,pub,"Publication"))
        if len(out)>=MAX_PER_SOURCE:break
    return out,rejected

def bdf():
    d=datetime.now();pairs=[];y,m=d.year,d.month
    for _ in range(10):
        m-=1
        if m==0:y-=1;m=12
        pairs.append((y,m))
    last_error=None
    for y,m in pairs:
        url=f"https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers-{y}-{m:02}"
        try:
            r=http_get(url)
            if not r.ok:continue
            text=clean(BeautifulSoup(r.text,"html.parser").get_text(" "))
            if "crédits à l'habitat" not in text.lower():continue
            pub=parse_date(text,url)
            return [make("Banque de France","A","Crédits à l’habitat : dernières données de la Banque de France",text[:500],url,pub,"Donnée officielle",topic="Crédit")],0
        except Exception as exc:
            last_error=exc
            continue
    if last_error:raise last_error
    return [],0

def insee():
    url="https://www.insee.fr/fr/statistiques/8995299";r=http_get(url,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");text=clean(s.get_text(" "));h=s.find("h1")
    return [make("Insee","A",clean(h.get_text(" ",strip=True)) if h else "Prix des logements anciens : dernière publication",text[:500],url,parse_date(text,url),"Chiffre officiel",topic="Prix")],0

def sdes():
    page="https://www.statistiques.developpement-durable.gouv.fr/la-construction-neuve";r=http_get(page,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser")
    a=next((a for a in s.find_all("a",href=True) if "construction-de-logements-resultats" in a.get("href","")),None)
    if not a:return [],0
    url=urljoin(page,a["href"]);rr=http_get(url,timeout=TIMEOUT,headers={"User-Agent":UA});rr.raise_for_status();ss=BeautifulSoup(rr.text,"html.parser");text=clean(ss.get_text(" "));h=ss.find("h1")
    return [make("SDES / Sitadel","A",clean(h.get_text(" ",strip=True)) if h else clean(a.get_text(" ",strip=True)),text[:500],url,parse_date(text,url),"Donnée officielle",topic="Construction")],0

def eurlex():
    docs=[
      ("Directive (UE) 2024/1275 sur la performance énergétique des bâtiments","https://eur-lex.europa.eu/eli/dir/2024/1275/oj?locale=fr","Directive — version consolidée","Le texte européen fixe une trajectoire de performance énergétique et de rénovation du parc immobilier.","2026-05-24T09:00:00+02:00"),
      ("Règlement délégué (UE) 2026/52 sur le potentiel de réchauffement global des bâtiments","https://eur-lex.europa.eu/eli/reg_del/2026/52/oj/eng","Règlement délégué — en vigueur","Le règlement précise le cadre de calcul du potentiel de réchauffement global sur le cycle de vie des bâtiments.","2026-05-04T09:00:00+02:00")
    ]
    out=[make("EUR-Lex","A",t,summary,u,pub,st,"Union européenne","jorf","Droit européen") for t,u,st,summary,pub in docs]
    return out,0

def senat():
    url="https://data.senat.fr/data/dosleg/dosleg.zip";r=http_get(url,timeout=60,headers={"User-Agent":UA});r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:sql=z.read([n for n in z.namelist() if n.endswith(".sql")][0]).decode("utf-8",errors="replace")
    def table(name):
        m=re.search(rf"^COPY (?:public\.)?{name} \(([^)]*)\) FROM stdin;\n(.*?)\n\\\\\.$",sql,re.M|re.S)
        if not m:return [],[]
        return [x.strip() for x in m.group(1).split(",")],[[None if v==r"\N" else v for v in line.split("\t")] for line in m.group(2).splitlines() if line]
    ec,er=table("etaloi");lc,lr=table("loi");emap={str(r[0]).strip():clean(r[1]) for r in er if len(r)>1 and r[0]};idx={c:i for i,c in enumerate(lc)}
    def get(r,*names):
        for n in names:
            if n in idx and idx[n]<len(r):return clean(r[idx[n]])
        return ""
    def stage(s):
        t=s.lower()
        if "promulgu" in t:return"promulgue"
        if any(x in t for x in ("lecture","commission mixte","congrès","congres")):return"discussion"
        if t.strip() in ("adopté","adopte"):return"adopte"
        return"depot"
    out=[];rejected=0
    for row in lr:
        title=get(row,"loiint","loitit","titre","intitule")
        if not is_immo(title):rejected+=1;continue
        signet=get(row,"signet")
        if not signet:continue
        st=emap.get(get(row,"etaloicod","etatloicod","etat"),"Dossier législatif")
        out.append(make("Sénat","A",title,f"Dossier législatif immobilier. État officiel : {st}.",f"https://www.senat.fr/dossier-legislatif/{signet}.html",None,st,legal_stage=stage(st),topic="Législation"))
        if len(out)>=MAX_PER_SOURCE:break
    return out,rejected

def legifrance():
    r=http_get("https://www.legifrance.gouv.fr/");r.raise_for_status()
    s=BeautifulSoup(r.text,"html.parser");jo=[];pat=re.compile(r"/eli/jo/20\d{2}/\d{1,2}/\d{1,2}/\d+")
    for a in s.find_all("a",href=True):
        if pat.search(a["href"]):
            u=urljoin("https://www.legifrance.gouv.fr/",a["href"])
            if u not in jo:jo.append(u)
        if len(jo)>=7:break
    out=[];rejected=0;page_errors=[]
    for ju in jo:
        try:
            rr=http_get(ju);rr.raise_for_status()
            ss=BeautifulSoup(rr.text,"html.parser");page=clean(ss.get_text(" "));pub=parse_date(page,ju)
            for a in ss.find_all("a",href=True):
                title=clean(a.get_text(" ",strip=True));u=urljoin(ju,a["href"])
                if len(title)<15 or norm_url(u)==norm_url(ju) or not direct(u):continue
                if not is_immo(title):rejected+=1;continue
                out.append(make("Légifrance","A",title,"Texte immobilier repéré dans un Journal officiel récent. Vérifier dans le texte la date exacte d’application.",u,pub,"Publié au JORF",legal_stage="jorf",topic="Texte officiel"))
                if len(out)>=MAX_PER_SOURCE:return out,rejected
        except Exception as exc:
            page_errors.append(str(exc))
            continue
    if not out and page_errors:
        raise RuntimeError("JORF temporairement indisponible: "+page_errors[-1][:180])
    return out,rejected

def _previous_feed():
    try:return json.loads(FEED.read_text(encoding="utf-8"))
    except:return {"items":[],"health":{}}

def _source_fallback(prev,name):
    return [i for i in prev.get("items",[]) if i.get("source")==name][:MAX_PER_SOURCE]

def _merge_archive(items):
    ARCHIVE.parent.mkdir(parents=True,exist_ok=True)
    try:old=json.loads(ARCHIVE.read_text(encoding="utf-8"))
    except:old={"items":[]}
    rank={"A":4,"B":3,"C":2,"D":1};dedup={}
    for i in [*(old.get("items") or []),*items]:
        if not str(i.get("published_at","")).startswith("2026"):continue
        key=norm_url(i.get("url","")) or i.get("id") or re.sub(r"\W+"," ",i.get("title","").lower()).strip()
        cur=dedup.get(key)
        if not cur or rank.get(i.get("source_level"),0)>=rank.get(cur.get("source_level"),0):
            dedup[key]=i
    vals=list(dedup.values())
    vals.sort(key=lambda x:(x.get("published_at") or "",x.get("relevance",0)),reverse=True)
    ARCHIVE.write_text(json.dumps({
        "version":"7.1",
        "scope":"Archive 2026 constituée progressivement à partir des collectes du Radar. Le backfill manuel est best-effort et n’est pas présenté comme exhaustif.",
        "generated_at":now(),
        "items":vals[:2500]
    },ensure_ascii=False,indent=2),encoding="utf-8")

def main():
    jobs=[
      ("Service-Public.fr","A",lambda:(service_public(),0)),
      ("Banque de France","A",bdf),("Insee","A",insee),("SDES / Sitadel","A",sdes),
      ("Sénat / DOSLEG","A",senat),("Légifrance","A",legifrance),("EUR-Lex","A",eurlex),
      ("ANIL","B",lambda:generic("https://www.anil.org/actualites-evenements/","ANIL","B",True)),
      ("Notaires de France","B",lambda:generic("https://www.notaires.fr/fr/actualites","Notaires de France","B",True)),
      ("MySweetImmo","C",lambda:generic("https://www.mysweetimmo.com/","MySweetImmo","C",True)),
      ("Immo Matin","C",lambda:generic("https://www.immomatin.com/","Immo Matin","C",True)),
      ("Journal de l'Agence","C",lambda:generic("https://www.journaldelagence.com/actualites-immobilier","Journal de l'Agence","C",True)),
      ("Batiactu","C",lambda:generic("https://www.batiactu.com/theme/theme-logement.php","Batiactu","C",True)),
      ("Immobilier 2.0","C",lambda:generic("https://immo2.pro/actualite-immobilier/","Immobilier 2.0","C",True)),
      ("Horiz.io","D",lambda:generic("https://horiz.io/investissement-immobilier","Horiz.io","D",True))
    ]
    prev=_previous_feed()
    items=[];errors=[];by_source={};rejected_total=0
    for name,level,fn in jobs:
        got=None;rejected=0;last_exc=None
        for attempt in range(2):
            try:
                got,rejected=fn();last_exc=None;break
            except Exception as exc:
                last_exc=exc
                if attempt==0:time.sleep(1.4)
        if last_exc is None:
            got=got or [];items.extend(got);rejected_total+=rejected
            by_source[name]={
                "level":level,
                "ok":True,
                "status":"ok" if got else "empty",
                "retained":len(got),
                "last_success":now(),
                "fallback":False
            }
            print(name,len(got),"retained")
        else:
            fallback=_source_fallback(prev,name)
            if fallback:
                items.extend(fallback)
                by_source[name]={
                    "level":level,"ok":False,"status":"degraded","retained":len(fallback),
                    "last_success":prev.get("generated_at"),"fallback":True,
                    "error_type":type(last_exc).__name__
                }
                errors.append({"source":name,"error":str(last_exc),"fallback":True})
                print(name,"DEGRADED",last_exc,"fallback",len(fallback))
            else:
                by_source[name]={
                    "level":level,"ok":False,"status":"error","retained":0,
                    "last_success":None,"fallback":False,"error_type":type(last_exc).__name__
                }
                errors.append({"source":name,"error":str(last_exc),"fallback":False})
                print(name,"ERROR",last_exc)

    rank={"A":4,"B":3,"C":2,"D":1};cutoff=datetime.now(timezone.utc)-timedelta(days=730);dedup={}
    for i in items:
        if not is_immo(i.get("title","")+" "+i.get("summary","")):rejected_total+=1;continue
        if not direct(i.get("url","")):rejected_total+=1;continue
        if i.get("published_at"):
            try:
                if datetime.fromisoformat(i["published_at"].replace("Z","+00:00")).astimezone(timezone.utc)<cutoff:continue
            except:pass
        key=norm_url(i["url"]) or re.sub(r"\W+"," ",i["title"].lower()).strip();cur=dedup.get(key)
        if not cur or rank.get(i["source_level"],0)>rank.get(cur["source_level"],0):dedup[key]=i
    vals=list(dedup.values());vals.sort(key=lambda x:((datetime.fromisoformat(x["published_at"]).timestamp() if x.get("published_at") else 0),x.get("relevance",0)),reverse=True)
    counts={};final=[]
    for i in vals:
        src=i["source"];counts[src]=counts.get(src,0)
        if counts[src]>=MAX_PER_SOURCE:continue
        counts[src]+=1;final.append(i)
        if len(final)>=MAX_TOTAL:break

    degraded=sum(1 for v in by_source.values() if v.get("status")=="degraded")
    hard_errors=sum(1 for v in by_source.values() if v.get("status")=="error")
    sources_ok=sum(1 for v in by_source.values() if v.get("status") in ("ok","empty"))
    health={
        "sources_total":len(jobs),"sources_ok":sources_ok,"sources_degraded":degraded,
        "errors":hard_errors,"retained":len(final),"rejected":rejected_total,"by_source":by_source
    }
    data={"generated_at":now(),"version":"7.1","items":final,"source_stats":counts,"health":health,"errors":errors}
    FEED.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    _merge_archive(final)
    print("TOTAL",len(final),health)

    try:
        from update_local import main as update_local_main
        update_local_main()
    except Exception as exc:
        print("LOCAL UPDATE ERROR", exc)

if __name__=="__main__":main()
