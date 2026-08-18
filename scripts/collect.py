#!/usr/bin/env python3
from __future__ import annotations
import hashlib, html, io, json, os, re, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
import feedparser, requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
FEED=ROOT/"data"/"feed.json"
MARKET=ROOT/"data"/"market.json"
UA="Mozilla/5.0 (compatible; RadarImmobilier/2.2; +https://github.com/damienktzpro/immo-radar)"
TIMEOUT=22
MAX_PER_SOURCE=16
MAX_TOTAL=220

ANCHORS=(
"immobilier","immobilière","immobiliere","logement","logements","habitation",
"maison","appartement","loyer","loyers","locataire","bailleur","bail d'habitation",
"copropriété","copropriete","syndic","construction de logements","construction neuve",
"permis de construire","mise en chantier","urbanisme","foncier","foncière","fonciere",
"vente immobilière","vente immobiliere","transaction immobilière","transaction immobiliere",
"prix des logements","prix immobilier","prix au m²","prix au m2","dpe",
"diagnostic de performance énergétique","diagnostic de performance energetique",
"diagnostic immobilier","rénovation énergétique","renovation energetique",
"passoire thermique","meublé de tourisme","meuble de tourisme","location meublée",
"location meublee","location nue","lmnp","lmp","scpi","opci","crédit immobilier",
"credit immobilier","crédit à l'habitat","credit a l'habitat","prêt immobilier","pret immobilier",
"prêt à taux zéro","pret a taux zero","ptz","taux immobilier","action logement","anah",
"maprimerénov","maprimerenov","agence immobilière","agence immobiliere","agent immobilier",
"mandataire immobilier","promoteur immobilier","promotion immobilière","promotion immobiliere",
"proptech","résidence principale","residence principale","résidence secondaire","residence secondaire",
"performance énergétique des bâtiments","performance energetique des batiments",
"marché immobilier","marche immobilier","parc immobilier","patrimoine immobilier",
"taxe foncière","taxe fonciere","plus-value immobilière","plus-value immobiliere",
"fiscalité immobilière","fiscalite immobiliere","gestion locative","marché locatif","marche locatif"
)
REJECT=("voiture","voitures","véhicule","vehicule","automobile","moto","scooter","vélo","velo",
"batterie","borne de recharge","bonus écologique","bonus ecologique","leasing social","permis de conduire",
"smartphone","console","football","basket","tennis","cryptomonnaie","crypto-monnaie","bitcoin")
MONTHS={"janvier":1,"février":2,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,"juillet":7,"août":8,"aout":8,"septembre":9,"octobre":10,"novembre":11,"décembre":12,"decembre":12}

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
    t=clean(text).lower()
    has=any(k in t for k in ANCHORS)
    if any(k in t for k in REJECT) and not has:return False
    return has
def direct(url):
    if not url:return False
    p=urlsplit(norm_url(url));path=p.path.rstrip("/")
    return path not in ("","/fr","/actualites","/actualites-evenements","/centre-de-ressources","/dossiers-legislatifs","/actualite-immobilier")
def parse_date(text,url=""):
    t=clean(text).lower()
    m=re.search(r"\b(\d{1,2})\s+("+ "|".join(MONTHS)+r")\s+(20\d{2})\b",t)
    if m:
        return datetime(int(m.group(3)),MONTHS[m.group(2)],int(m.group(1)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
    m=re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b",t)
    if m:
        return datetime(int(m.group(3)),int(m.group(2)),int(m.group(1)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
    m=re.search(r"/(20\d{2})/(\d{1,2})/(\d{1,2})/",url)
    if m:
        return datetime(int(m.group(1)),int(m.group(2)),int(m.group(3)),9,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
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
    text=f"{title} {summary}";c=category(text,source)
    base={"A":82,"B":76,"C":67,"D":60}.get(level,60)
    imp=min(100,base+(9 if c=="lois" else 6 if c in ("credit","marche") else 4))
    rel=min(100,base+6)
    d={"id":sid(source,title,url),"title":clean(title),"summary":clean(summary)[:540],"url":url,"source":source,"source_level":level,"category":c,"audiences":audiences(text,c),"published_at":pub,"status":status,"importance":imp,"relevance":rel,"territory":territory,"topic":topic or c.capitalize(),"why_it_matters":why(c,level)}
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

def generic(page,source,level,require_date=True):
    r=requests.get(page,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");out=[];seen=set()
    for a in s.find_all("a",href=True):
        title=clean(a.get_text(" ",strip=True));url=urljoin(page,a.get("href",""))
        if len(title)<14 or len(title)>190 or not direct(url) or url in seen:continue
        node=a
        for _ in range(4):
            if node.parent:node=node.parent
        context=clean(node.get_text(" ",strip=True))
        text=f"{title} {context}"
        if not is_immo(text):continue
        pub=parse_date(context,url)
        if require_date and not pub:continue
        seen.add(url)
        summary=context.replace(title,"",1).strip()[:480] or title
        out.append(make(source,level,title,summary,url,pub,"Publication"))
        if len(out)>=MAX_PER_SOURCE:break
    return out

def bdf():
    d=datetime.now();pairs=[]
    y,m=d.year,d.month
    for _ in range(8):
        m-=1
        if m==0:y-=1;m=12
        pairs.append((y,m))
    for y,m in pairs:
        url=f"https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers-{y}-{m:02}"
        try:
            r=requests.get(url,timeout=TIMEOUT,headers={"User-Agent":UA})
            if not r.ok:continue
            text=clean(BeautifulSoup(r.text,"html.parser").get_text(" "))
            if "crédits à l'habitat" not in text.lower():continue
            rate=re.search(r"reste stable.*?à\s*([0-9]+,[0-9]+)\s*%",text.lower())
            prod=re.search(r"production cvs de crédits à l'habitat \(hors renégociations\).*?([0-9]+,[0-9]+)\s*mds",text.lower())
            title=f"Crédit immobilier : taux moyen à {rate.group(1)} %" if rate else "Crédits à l’habitat : les dernières données de la Banque de France"
            summary=(f"La production de crédits à l’habitat hors renégociations atteint {prod.group(1)} Md€ et le taux moyen {rate.group(1)} %." if prod and rate else text[:430])
            pub=parse_date(text,url)
            return [make("Banque de France","A",title,summary,url,pub,"Donnée officielle",topic="Crédit")]
        except Exception as e:print("Banque de France",e)
    return []

def insee():
    fixed="https://www.insee.fr/fr/statistiques/8995299"
    try:
        r=requests.get(fixed,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");text=clean(s.get_text(" "))
        title="Prix des logements anciens : dernière publication Notaires-Insee"
        h=s.find("h1")
        if h:title=clean(h.get_text(" ",strip=True))
        pub=parse_date(text,fixed)
        summary=""
        p=s.find("p")
        if p:summary=clean(p.get_text(" ",strip=True))
        return [make("Insee","A",title,summary or text[:450],fixed,pub,"Chiffre officiel",topic="Prix")]
    except Exception as e:print("Insee",e);return []

def sdes():
    page="https://www.statistiques.developpement-durable.gouv.fr/la-construction-neuve"
    try:
        r=requests.get(page,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser")
        a=next((a for a in s.find_all("a",href=True) if "construction-de-logements-resultats" in a.get("href","")),None)
        if not a:return []
        url=urljoin(page,a["href"]);rr=requests.get(url,timeout=TIMEOUT,headers={"User-Agent":UA});rr.raise_for_status();ss=BeautifulSoup(rr.text,"html.parser");text=clean(ss.get_text(" "))
        title=clean(ss.find("h1").get_text(" ",strip=True)) if ss.find("h1") else clean(a.get_text(" ",strip=True))
        pub=parse_date(text,url)
        summary=""
        for p in ss.find_all("p"):
            tx=clean(p.get_text(" ",strip=True))
            if "autorisations de logements" in tx.lower():summary=tx;break
        return [make("SDES / Sitadel","A",title,summary or text[:450],url,pub,"Donnée officielle",topic="Construction")]
    except Exception as e:print("SDES",e);return []

def senat():
    url="https://data.senat.fr/data/dosleg/dosleg.zip";r=requests.get(url,timeout=60,headers={"User-Agent":UA});r.raise_for_status()
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
    out=[]
    for row in lr:
        title=get(row,"loiint","loitit","titre","intitule")
        if not is_immo(title):continue
        signet=get(row,"signet")
        if not signet:continue
        st=emap.get(get(row,"etaloicod","etatloicod","etat"),"Dossier législatif")
        out.append(make("Sénat","A",title,f"Dossier législatif immobilier. État officiel : {st}.",f"https://www.senat.fr/dossier-legislatif/{signet}.html",None,st,legal_stage=stage(st),topic="Législation"))
    return out[:MAX_PER_SOURCE]

def legifrance():
    try:
        r=requests.get("https://www.legifrance.gouv.fr/",timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");jo=[];pat=re.compile(r"/eli/jo/20\d{2}/\d{1,2}/\d{1,2}/\d+")
        for a in s.find_all("a",href=True):
            if pat.search(a["href"]):
                u=urljoin("https://www.legifrance.gouv.fr/",a["href"])
                if u not in jo:jo.append(u)
            if len(jo)>=5:break
        out=[]
        for ju in jo:
            rr=requests.get(ju,timeout=TIMEOUT,headers={"User-Agent":UA});rr.raise_for_status();ss=BeautifulSoup(rr.text,"html.parser");page_text=clean(ss.get_text(" "));pub=parse_date(page_text,ju)
            for a in ss.find_all("a",href=True):
                title=clean(a.get_text(" ",strip=True));u=urljoin(ju,a["href"])
                if len(title)<15 or not is_immo(title) or norm_url(u)==norm_url(ju) or not direct(u):continue
                out.append(make("Légifrance","A",title,"Texte immobilier repéré dans un Journal officiel récent. La date d’application doit être vérifiée dans le texte.",u,pub,"Publié au JORF",legal_stage="jorf",topic="Texte officiel"))
                if len(out)>=MAX_PER_SOURCE:return out
        return out
    except Exception as e:print("Légifrance",e);return []

def eurlex():
    docs=[
      ("Directive (UE) 2024/1275 sur la performance énergétique des bâtiments","https://eur-lex.europa.eu/eli/dir/2024/1275/oj?locale=fr","Directive — transposition nationale","Le texte européen fixe une trajectoire de performance énergétique et de rénovation du parc immobilier."),
      ("Règlement délégué (UE) 2026/52 sur le potentiel de réchauffement global des bâtiments","https://eur-lex.europa.eu/eli/reg_del/2026/52/oj/eng","Règlement délégué","Le règlement précise le calcul du potentiel de réchauffement global sur le cycle de vie des bâtiments.")
    ]
    out=[make("EUR-Lex","A",t,s,u,"2026-05-24T09:00:00+02:00",st,"Union européenne","jorf","Droit européen") for t,u,st,s in docs]
    rss=os.getenv("EURLEX_RSS_URL","").strip()
    if rss:
        f=feedparser.parse(rss,request_headers={"User-Agent":UA})
        for e in f.entries:
            title=clean(getattr(e,"title",""));summary=clean(getattr(e,"summary",""));url=getattr(e,"link","")
            if is_immo(title+" "+summary) and direct(url):
                p=getattr(e,"published_parsed",None);pub=datetime(*p[:6],tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds") if p else None
                out.append(make("EUR-Lex","A",title,summary,url,pub,"Acte / procédure UE","Union européenne","jorf","Droit européen"))
    return out[:MAX_PER_SOURCE]

def collect_all():
    jobs=[
      ("Service-Public",service_public),
      ("Banque de France",bdf),("Insee",insee),("SDES",sdes),("Sénat",senat),("Légifrance",legifrance),("EUR-Lex",eurlex),
      ("ANIL",lambda:generic("https://www.anil.org/actualites-evenements/","ANIL","B",True)),
      ("Notaires",lambda:generic("https://www.notaires.fr/fr/actualites","Notaires de France","B",True)),
      ("MySweetImmo",lambda:generic("https://www.mysweetimmo.com/","MySweetImmo","C",True)),
      ("Immo Matin",lambda:generic("https://www.immomatin.com/","Immo Matin","C",True)),
      ("Journal de l'Agence",lambda:generic("https://www.journaldelagence.com/actualites-immobilier","Journal de l'Agence","C",True)),
      ("Batiactu",lambda:generic("https://www.batiactu.com/theme/theme-logement.php","Batiactu","C",True)),
      ("Immobilier 2.0",lambda:generic("https://immo2.pro/actualite-immobilier/","Immobilier 2.0","C",True)),
      ("Horiz.io",lambda:generic("https://horiz.io/investissement-immobilier","Horiz.io","D",True))
    ]
    items=[];errors=[]
    for name,fn in jobs:
        try:
            got=fn();items.extend(got);print(name,len(got))
        except Exception as e:errors.append({"source":name,"error":str(e)});print(name,e)
    return items,errors

def dedupe(items):
    by={}
    rank={"A":4,"B":3,"C":2,"D":1}
    cutoff=datetime.now(timezone.utc)-timedelta(days=730)
    for i in items:
        if not is_immo(i.get("title","")+" "+i.get("summary","")):continue
        if not direct(i.get("url","")):continue
        if i.get("published_at"):
            try:
                d=datetime.fromisoformat(i["published_at"].replace("Z","+00:00")).astimezone(timezone.utc)
                if d<cutoff:continue
            except:pass
        key=norm_url(i["url"]) or re.sub(r"\W+"," ",i["title"].lower()).strip()
        cur=by.get(key)
        if not cur or (rank.get(i["source_level"],0),i.get("relevance",0))>(rank.get(cur["source_level"],0),cur.get("relevance",0)):by[key]=i
    vals=list(by.values())
    vals.sort(key=lambda x:((datetime.fromisoformat(x["published_at"]).timestamp() if x.get("published_at") else 0),x.get("relevance",0)),reverse=True)
    # cap each source to keep the feed genuinely diverse
    counts={};out=[]
    for i in vals:
        src=i["source"];counts[src]=counts.get(src,0)
        if counts[src]>=MAX_PER_SOURCE:continue
        counts[src]+=1;out.append(i)
        if len(out)>=MAX_TOTAL:break
    return out

def main():
    items,errors=collect_all();items=dedupe(items);stats={}
    for i in items:stats[i["source"]]=stats.get(i["source"],0)+1
    data={"generated_at":now(),"version":"2.2","items":items,"source_stats":stats,"errors":errors}
    FEED.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print("TOTAL",len(items),"SOURCES",len(stats),stats)

if __name__=="__main__":main()
