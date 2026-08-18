#!/usr/bin/env python3
from __future__ import annotations
import hashlib, html, io, json, os, re, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
import feedparser, requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
FEED=ROOT/"data"/"feed.json"; MARKET=ROOT/"data"/"market.json"
UA="Mozilla/5.0 (compatible; ImmoRadar/2.0; +https://github.com/damienktzpro/immo-radar)"
TIMEOUT=30

REAL_ESTATE=(
"immobilier","logement","habitation","loyer","location","locataire","bailleur","bail ","baux","copropriété","copropriete","syndic","construction","urbanisme","foncier","propriété","propriete","dpe","performance énergétique","performance energetique","rénovation énergétique","renovation energetique","passoire thermique","meublé","meuble","taxe foncière","taxe fonciere","ptz","prêt à taux zéro","pret a taux zero","crédit immobilier","credit immobilier","action logement","anah","maprimerénov","maprimerenov","encadrement des loyers","permis de construire","vente immobilière","vente immobiliere","bâtiment","batiment","scpi","lmnp","promoteur","agence immobilière","agence immobiliere","mandataire immobilier","proptech","résidence principale","residence principale","résidence secondaire","residence secondaire","diagnostic immobilier","patrimoine bâti","patrimoine bati"
)
EXCLUDE=("football","basket","crypto-monnaie","cryptomonnaie","gaming","smartphone","cinéma","cinema","restaurant","mode ","santé ","sante ","automobile")
CATEGORY={
"lois":("loi","décret","decret","arrêté","arrete","ordonnance","règlement","reglement","juridique","journal officiel","directive","proposition de loi","projet de loi","copropriété","bail"),
"marche":("prix","marché","marche","taux","crédit","credit","transaction","vente","construction","loyer","indice"),
"investir":("invest","bailleur","fiscal","location","rendement","meublé","meuble","lmnp","scpi","foncière","fonciere"),
"territoires":("commune","territoire","ville","département","departement","local","urbanisme","zone tendue","foncier")
}

def now(): return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
def clean(v):
    if not v:return ""
    return " ".join(BeautifulSoup(html.unescape(str(v)),"html.parser").get_text(" ").split())
def norm_url(v):
    try:
        p=urlsplit(v);return urlunsplit((p.scheme,p.netloc,p.path,"",""))
    except:return v or ""
def sid(source,title,url): return hashlib.sha1(f"{source}|{title}|{norm_url(url)}".encode()).hexdigest()[:16]
def immobilier(text):
    t=clean(text).lower()
    return any(k in t for k in REAL_ESTATE) and not (sum(1 for x in EXCLUDE if x in t)>=2 and not any(k in t for k in ("immobilier","logement","construction","bâtiment","batiment")))
def category(text):
    t=clean(text).lower();best=("marche",0)
    for c,ws in CATEGORY.items():
        s=sum(1 for w in ws if w in t)
        if s>best[1]:best=(c,s)
    return best[0]
def audience(text,c):
    t=text.lower()
    if any(x in t for x in ("lmnp","scpi","bailleur","invest","fiscal","rendement")):return ["investisseur","pro","particulier"]
    if any(x in t for x in ("agence","syndic","promoteur","proptech","urbanisme")):return ["pro","investisseur","particulier"]
    return ["particulier","investisseur","pro"]
def scores(level,c,title):
    imp=55+(12 if level=="A" else 7 if level=="B" else 2);rel=60+(10 if level=="A" else 7 if level=="B" else 2)
    if c=="lois":imp+=8;rel+=7
    if c=="investir":rel+=7
    if any(x in title.lower() for x in ("entrée en vigueur","entree en vigueur","loi","décret","decret","taux","prix","dpe")):imp+=7
    return min(100,imp),min(100,rel)
def item(source,level,title,summary,url,published,status="",territory="France",legal_stage=None,topic=None,source_type=None,excerpt=None,confirmation=None):
    text=f"{title} {summary}";c=category(text);imp,rel=scores(level,c,title)
    d={"id":sid(source,title,url),"title":clean(title),"summary":clean(summary)[:520],"url":url,"source":source,"source_level":level,"source_type":source_type or "source","category":c,"audiences":audience(text,c),"published_at":published,"status":status,"importance":imp,"relevance":rel,"territory":territory,"topic":topic or c.capitalize(),"why_it_matters":why(c,level)}
    if legal_stage:d["legal_stage"]=legal_stage
    if excerpt:d["original_excerpt"]=clean(excerpt)[:500]
    if confirmation:d["confirmation"]=confirmation
    return d
def why(c,l):
    base="Source officielle. " if l=="A" else "Source institutionnelle. " if l=="B" else "Source éditoriale immobilière sélectionnée. "
    return base+{"lois":"Cette évolution peut modifier les règles applicables aux propriétaires, locataires, investisseurs ou professionnels.","marche":"Cette information aide à lire l’évolution du marché immobilier, des prix, du crédit ou de la construction.","investir":"Cette information peut modifier la fiscalité, le rendement, les contraintes ou le risque d’un investissement.","territoires":"Cette information peut avoir un impact local différent selon la zone concernée."}.get(c,"Impact immobilier à surveiller.")
def direct(url):
    if not url:return False
    p=urlsplit(norm_url(url));path=p.path.rstrip("/")
    return path not in ("","/actualites-evenements","/centre-de-ressources","/dossiers-legislatifs","/fr/accueil","/fr/statistiques")
def frdate(text):
    months={"janvier":1,"février":2,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,"juillet":7,"août":8,"aout":8,"septembre":9,"octobre":10,"novembre":11,"décembre":12,"decembre":12}
    m=re.search(r"\b(\d{1,2})\s+("+ "|".join(months)+r")\s+(20\d{2})\b",clean(text).lower())
    if not m:return None
    return datetime(int(m.group(3)),months[m.group(2)],int(m.group(1)),8,tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")

def service_public():
    url="https://www.service-public.fr/abonnements/rss/actu-actualites-particuliers.rss";f=feedparser.parse(url,request_headers={"User-Agent":UA});out=[]
    for e in f.entries:
        title=clean(getattr(e,"title",""));summary=clean(getattr(e,"summary",""));link=getattr(e,"link","")
        if not immobilier(title+" "+summary) or not direct(link):continue
        p=getattr(e,"published_parsed",None);pub=datetime(*p[:6],tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds") if p else now()
        out.append(item("Service-Public.fr","A",title,summary or "Actualité officielle liée au logement.",link,pub,"Information officielle",topic="Logement",confirmation="Flux RSS officiel de Service-Public.fr."))
    return out[:30]

def generic_links(page,source,level,limit=35):
    r=requests.get(page,timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");out=[];seen=set()
    for a in s.find_all("a",href=True):
        title=clean(a.get_text(" ",strip=True));url=urljoin(page,a["href"])
        if len(title)<12 or not immobilier(title) or not direct(url) or url in seen:continue
        seen.add(url);ctx=clean(a.parent.get_text(" ",strip=True)) if a.parent else title;pub=frdate(ctx) or now()
        out.append(item(source,level,title,ctx[:420] or title,url,pub,"Publication",topic="Actualité immobilière",confirmation=f"Lien direct détecté sur {source}."))
        if len(out)>=limit:break
    return out

def anil(): return generic_links("https://www.anil.org/actualites-evenements/","ANIL","B",40)
def media():
    out=[]
    for page,source in [("https://www.immomatin.com/","Immo Matin"),("https://immo2.pro/","Immobilier 2.0")]:
        try: out+=generic_links(page,source,"C",25)
        except Exception as e: print(source,e)
    return out

def senat():
    url="https://data.senat.fr/data/dosleg/dosleg.zip";r=requests.get(url,timeout=60,headers={"User-Agent":UA});r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        sql=z.read([n for n in z.namelist() if n.endswith(".sql")][0]).decode("utf-8",errors="replace")
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
        if "promulgu" in t:return "promulgue"
        if any(x in t for x in ("lecture","commission mixte","congrès","congres")):return "discussion"
        if t.strip() in ("adopté","adopte"):return "adopte"
        return "depot"
    out=[]
    for r0 in lr:
        title=get(r0,"loiint","loitit","titre","intitule")
        if not immobilier(title):continue
        signet=get(r0,"signet")
        if not signet:continue
        st=emap.get(get(r0,"etaloicod","etatloicod","etat"),"Dossier législatif");sg=stage(st)
        out.append(item("Sénat","A",title,f"Dossier législatif immobilier. État officiel : {st}.",f"https://www.senat.fr/dossier-legislatif/{signet}.html",now(),st,legal_stage=sg,topic="Législation",confirmation="État du dossier issu des données ouvertes du Sénat."))
    return out[:70]

def legifrance():
    r=requests.get("https://www.legifrance.gouv.fr/",timeout=TIMEOUT,headers={"User-Agent":UA});r.raise_for_status();s=BeautifulSoup(r.text,"html.parser");jo=[];pat=re.compile(r"/eli/jo/20\d{2}/\d{1,2}/\d{1,2}/\d+")
    for a in s.find_all("a",href=True):
        if pat.search(a["href"]):
            u=urljoin("https://www.legifrance.gouv.fr/",a["href"])
            if u not in jo:jo.append(u)
        if len(jo)>=6:break
    out=[];seen=set()
    for ju in jo:
        rr=requests.get(ju,timeout=TIMEOUT,headers={"User-Agent":UA});rr.raise_for_status();ss=BeautifulSoup(rr.text,"html.parser");pub=frdate(ss.get_text(" ",strip=True)) or now()
        for a in ss.find_all("a",href=True):
            title=clean(a.get_text(" ",strip=True));u=urljoin(ju,a["href"])
            if len(title)<12 or not immobilier(title) or norm_url(u)==norm_url(ju) or u in seen:continue
            seen.add(u);out.append(item("Légifrance","A",title,"Texte immobilier repéré dans un Journal officiel récent. Vérifier dans le texte sa date exacte d’application.",u,pub,"Publié au JORF",legal_stage="jorf",topic="Texte officiel",confirmation="Lien direct vers Légifrance / Journal officiel."))
    return out[:50]

def eurlex():
    docs=[
      ("Règlement délégué (UE) 2026/52 sur le calcul du potentiel de réchauffement global des bâtiments","https://eur-lex.europa.eu/eli/reg_del/2026/52/oj/eng","2026-05-04","Règlement délégué","Cadre européen lié à la performance énergétique et au cycle de vie des bâtiments."),
      ("Recommandation (UE) 2026/536 sur les guichets uniques pour l’efficacité énergétique des bâtiments","https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32026H0536","2026-03-11","Recommandation","Orientations européennes sur les services liés à la rénovation et à la performance énergétique."),
      ("Directive (UE) 2024/1275 sur la performance énergétique des bâtiments — version consolidée 2026","https://eur-lex.europa.eu/eli/dir/2024/1275/oj?locale=fr","2026-05-24","Directive — transposition nationale","Texte européen majeur pour la rénovation et la performance énergétique des bâtiments.")
    ]
    out=[]
    for title,url,date,status,summary in docs:
        out.append(item("EUR-Lex","A",title,summary,url,datetime.fromisoformat(date).replace(tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds"),status,territory="Union européenne",legal_stage="jorf",topic="Droit européen",confirmation="Texte officiel EUR-Lex. Directive et règlement sont distingués."))
    rss=os.getenv("EURLEX_RSS_URL","").strip()
    if rss:
        f=feedparser.parse(rss,request_headers={"User-Agent":UA})
        for e in f.entries:
            title=clean(getattr(e,"title",""));summary=clean(getattr(e,"summary",""));link=getattr(e,"link","")
            if immobilier(title+" "+summary) and direct(link):
                p=getattr(e,"published_parsed",None);pub=datetime(*p[:6],tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds") if p else now()
                out.append(item("EUR-Lex","A",title,summary,link,pub,"Acte / procédure UE",territory="Union européenne",legal_stage="jorf",topic="Droit européen",confirmation="Flux RSS EUR-Lex configuré."))
    return out[:40]

def existing():
    try:return json.loads(FEED.read_text(encoding="utf-8")).get("items",[])
    except:return []

def dedupe(items):
    out={}
    for i in items:
        if not immobilier(i.get("title","")+" "+i.get("summary","")):continue
        if not direct(i.get("url","")):continue
        key=(i.get("source","").lower(),re.sub(r"\W+"," ",i.get("title","").lower()).strip())
        cur=out.get(key)
        rank={"A":4,"B":3,"C":2,"D":1}
        if not cur or (rank.get(i.get("source_level"),0),i.get("relevance",0))>(rank.get(cur.get("source_level"),0),cur.get("relevance",0)):out[key]=i
    vals=list(out.values());vals.sort(key=lambda x:x.get("published_at",""),reverse=True)
    cutoff=datetime.now(timezone.utc)-timedelta(days=730)
    final=[]
    for i in vals:
        try:
            d=datetime.fromisoformat(i["published_at"].replace("Z","+00:00")).astimezone(timezone.utc)
            if d<cutoff:continue
        except:pass
        final.append(i)
    return final[:260]

def find_bdf():
    today=datetime.now();months=[]
    y,m=today.year,today.month
    for _ in range(7):
        m-=1
        if m==0:y-=1;m=12
        months.append((y,m))
    for y,m in months:
        u=f"https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers-{y}-{m:02}"
        try:
            r=requests.get(u,timeout=TIMEOUT,headers={"User-Agent":UA})
            if r.ok and "crédits" in r.text.lower():return u,clean(BeautifulSoup(r.text,"html.parser").get_text(" "))
        except:pass
    return None,None

def market_update():
    try:m=json.loads(MARKET.read_text(encoding="utf-8"))
    except:m={}
    components=m.get("components",[])
    # Banque de France auto-refresh by month slug.
    u,text=find_bdf()
    if u and text:
        rate=re.search(r"reste stable (?:en \w+ )?à\s*([0-9]+,[0-9]+)\s*%",text.lower())
        prod=re.search(r"production cvs de crédits à l'habitat \(hors renégociations\).*?([0-9]+,[0-9]+)\s*mds",text.lower())
        for c in components:
            if c["key"]=="rates" and rate:c["value"]=rate.group(1).replace(",",".")+" %";c["url"]=u;c["source"]="Banque de France";c["score"]=49
            if c["key"]=="credit" and prod:c["value"]=prod.group(1).replace(",",".")+" Md€";c["url"]=u;c["source"]="Banque de France";c["score"]=48
    # SDES auto-refresh from current construction landing page.
    try:
        u2="https://www.statistiques.developpement-durable.gouv.fr/la-construction-neuve";r=requests.get(u2,timeout=TIMEOUT,headers={"User-Agent":UA});s=BeautifulSoup(r.text,"html.parser")
        a=next((a for a in s.find_all("a",href=True) if "construction-de-logements-resultats" in a.get("href","")),None)
        if a:
            page=urljoin(u2,a["href"]);rr=requests.get(page,timeout=TIMEOUT,headers={"User-Agent":UA});txt=clean(BeautifulSoup(rr.text,"html.parser").get_text(" "))
            n=re.search(r"([0-9][0-9\s\u202f]{5,})\s+logements ont été autorisés",txt)
            for c in components:
                if c["key"]=="construction" and n:c["value"]=re.sub(r"\s+"," ",n.group(1)).strip();c["url"]=page;c["source"]="SDES / Sitadel";c["score"]=42
    except Exception as e:print("SDES",e)
    weights=sum(c.get("weight",0) for c in components if c.get("score") is not None)
    sc=round(sum(c["score"]*c["weight"] for c in components if c.get("score") is not None)/weights) if weights else 50
    label="Marché bloqué" if sc<25 else "Marché ralenti" if sc<42 else "Marché équilibré mais fragile" if sc<58 else "Marché dynamique" if sc<78 else "Marché sous forte tension"
    m["updated_at"]=now();m["temperature"]={"score":sc,"label":label,"comment":"Score calculé avec les dernières données officielles disponibles. Les périodes de publication sont indiquées dans le détail."}
    m["confidence"]=min(95,70+3*len(components));m["components"]=components
    # financing score from rate+credit
    by={c["key"]:c for c in components};fs=round((by.get("rates",{}).get("score",50)+by.get("credit",{}).get("score",50))/2)
    m["financing"]={"score":fs,"label":"Conditions intermédiaires" if 42<=fs<60 else "Conditions favorables" if fs>=60 else "Conditions contraignantes","comment":"Lecture combinée des taux et de la production de crédit habitat."}
    m["balance"]={"score":47,"label":"Léger avantage acheteurs","comment":"Prix et transactions restent proches d’un marché équilibré ; ce module sera affiné avec davantage de données locales."}
    MARKET.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding="utf-8")

def watch(items):
    w=[{"date":"2026-09-08T08:45:00+02:00","date_label":"8 sept. 2026","title":"Prochaine publication Insee — prix des logements anciens T2 2026","source":"Insee / Notaires"}]
    return [x for x in w if datetime.fromisoformat(x["date"])>=datetime.now().astimezone()][:6]

def main():
    items=existing();errors=[]
    collectors=[("Service-Public",service_public),("ANIL",anil),("Sénat",senat),("Légifrance",legifrance),("EUR-Lex",eurlex),("Médias",media)]
    for name,fn in collectors:
        try:
            got=fn();items+=got;print(name,len(got))
        except Exception as e:errors.append({"source":name,"error":str(e)});print(name,e)
    items=dedupe(items);market_update()
    data={"generated_at":now(),"version":"2.0","items":items,"watch":watch(items),"source_stats":{},"errors":errors}
    for i in items:data["source_stats"][i["source"]]=data["source_stats"].get(i["source"],0)+1
    FEED.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(len(items),"items")

if __name__=="__main__":main()
