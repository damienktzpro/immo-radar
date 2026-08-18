#!/usr/bin/env python3
from __future__ import annotations

import json, math, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT=Path(__file__).resolve().parents[1]
DATA_DIR=ROOT/'data'/'territories'
MONITORED=DATA_DIR/'monitored.json'
UA='Mozilla/5.0 (compatible; RadarImmobilier/7.0; +https://github.com/damienktzpro/immo-radar)'
TIMEOUT=28
GEO_BASE='https://geo.api.gouv.fr'
TABULAR_BASE='https://tabular-api.data.gouv.fr/api/resources'
ADEME_DPE_AGG='https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg'
GEORISQUES_REPORT='https://georisques.gouv.fr/api/v1/resultats_rapport_risque'
DVF_STATS_RESOURCE='851d342f-9c96-41c1-924a-11a7a7aae8a6'
RENT_RESOURCES={
 'apartment':'55b34088-0964-415f-9df7-d87dd98a09be',
 'small':'14a1fe11-b2d1-49b3-9f6b-83d12df9482c',
 'large':'5e3b28a4-cf56-43a3-ae79-43cceeb27f8c',
 'house':'129f764d-b613-44e4-952c-5ff50a8c9b73',
}

def now_iso(): return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')

def get_json(url,params=None,timeout=TIMEOUT):
 r=_SESSION.get(url,params=params,timeout=timeout)
 r.raise_for_status(); return r.json() if r.text.strip() else {}

def as_number(v):
 if v in (None,'','null'): return None
 try:
  if isinstance(v,str): v=v.replace('\u202f','').replace(' ','').replace(',','.')
  n=float(v); return n if math.isfinite(n) else None
 except: return None

def as_int(v):
 n=as_number(v); return int(round(n)) if n is not None else None

def tabular_rows(resource_id,filters,page_size=20):
 p={'page_size':page_size,**filters}
 d=get_json(f'{TABULAR_BASE}/{resource_id}/data/',p)
 if isinstance(d,list): return d
 if isinstance(d,dict):
  for k in ('data','results','records','items'):
   if isinstance(d.get(k),list): return d[k]
 return []

def fetch_geo(code):
 fields='nom,code,codesPostaux,population,surface,departement,region,codeDepartement,codeRegion,centre'
 return get_json(f'{GEO_BASE}/communes/{code}',{'fields':fields,'format':'json'})

def fetch_dvf(code):
 rows=tabular_rows(DVF_STATS_RESOURCE,{'code_geo__exact':code},10)
 row=next((r for r in rows if str(r.get('code_geo',''))==str(code)),rows[0] if rows else None)
 if not row:
  return {'status':'no_data','source':'data.gouv.fr — Statistiques DVF','source_url':'https://www.data.gouv.fr/datasets/statistiques-dvf','period':'10 semestres disponibles'}
 app={'median_price_m2':as_number(row.get('med_prix_m2_whole_appartement')),'mean_price_m2':as_number(row.get('moy_prix_m2_whole_appartement')),'sales':as_int(row.get('nb_ventes_whole_appartement'))}
 house={'median_price_m2':as_number(row.get('med_prix_m2_whole_maison')),'mean_price_m2':as_number(row.get('moy_prix_m2_whole_maison')),'sales':as_int(row.get('nb_ventes_whole_maison'))}
 total=(app['sales'] or 0)+(house['sales'] or 0) or None
 return {'status':'connected' if (app['median_price_m2'] or house['median_price_m2'] or total) else 'no_data','apartment':app,'house':house,'total_sales':total,'source':'data.gouv.fr — Statistiques DVF','source_url':'https://www.data.gouv.fr/datasets/statistiques-dvf','explorer_url':'https://explore.data.gouv.fr/fr/immobilier','period':'10 semestres disponibles','method':'Médiane du prix au m² selon la méthodologie data.gouv.fr.'}

def rent_one(rid,code):
 rows=tabular_rows(rid,{'INSEE_C__exact':code},5)
 row=next((r for r in rows if str(r.get('INSEE_C',''))==str(code)),rows[0] if rows else None)
 if not row: return None
 return {'rent_m2':as_number(row.get('loypredm2')),'low_m2':as_number(row.get('lwr.IPm2')),'high_m2':as_number(row.get('upr.IPm2')),'prediction_type':row.get('TYPPRED'),'observations_commune':as_int(row.get('nbobs_com')),'observations_mesh':as_int(row.get('nbobs_mail')),'r2':as_number(row.get('R2_adj'))}

def fetch_rents(code):
 out={}; errs=[]
 for k,rid in RENT_RESOURCES.items():
  try: out[k]=rent_one(rid,code)
  except Exception as e: out[k]=None; errs.append(f'{k}: {e}')
 available=[v for v in out.values() if v and v.get('rent_m2') is not None]; main=out.get('apartment')
 confidence='none'; warning=None
 if main:
  obs=main.get('observations_commune') or 0; r2=main.get('r2')
  if obs>=30 and (r2 is None or r2>=.5): confidence='high'
  elif obs>0: confidence='medium'; warning='À interpréter avec prudence : échantillon communal limité ou R² faible.'
  else: confidence='estimated'; warning='Estimation issue d’une maille élargie : peu ou pas d’annonces observées directement dans la commune.'
 return {'status':'connected' if available else ('error' if errs else 'no_data'),**out,'confidence':confidence,'warning':warning,'source':'Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin','source_url':'https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025','period':'T3 2025','scope':'Loyers d’annonce, charges comprises, logements loués vides. Indicateur expérimental.','errors':errs}

def parse_dpe(data):
 buckets=data.get('aggs') or data.get('aggregations') or []
 if isinstance(buckets,dict):
  c=[]
  for v in buckets.values():
   if isinstance(v,list): c.extend(v)
   elif isinstance(v,dict): c.extend(v.get('buckets') or v.get('values') or [])
  buckets=c
 counts={x:0 for x in 'ABCDEFG'}
 for b in buckets if isinstance(buckets,list) else []:
  label=str(b.get('value') or b.get('key') or b.get('label') or b.get('_id') or '').strip().upper()
  count=next((b.get(k) for k in ('count','doc_count','nb','value_count','total') if isinstance(b.get(k),(int,float))),0)
  if label in counts: counts[label]+=int(count)
 total=sum(counts.values()); fg=counts['F']+counts['G']; ab=counts['A']+counts['B']
 return {'total':total,'counts':counts,'passoires_pct':round(fg*100/total,1) if total else None,'efficient_pct':round(ab*100/total,1) if total else None,'dominant_label':max(counts,key=counts.get) if total else None,'confidence':'high' if total>=50 else ('low' if total else 'none')}

def fetch_dpe(code):
 params={'field':'etiquette_dpe','qs':f'code_insee_ban:"{code}"','agg_size':20,'size':0}
 s=parse_dpe(get_json(ADEME_DPE_AGG,params)); s.update({'status':'connected' if s['total'] else 'no_data','source':'ADEME — DPE logements existants','source_url':'https://data.ademe.fr/datasets/dpe03existant','scope':'DPE réalisés depuis juillet 2021 — échantillon non exhaustif du parc.'}); return s

def walk_present(obj,path=()):
 found=[]
 if isinstance(obj,dict):
  if obj.get('present') is True: found.append(str(obj.get('libelle') or obj.get('libelleRisque') or obj.get('nom') or obj.get('type') or (path[-1] if path else 'Risque')))
  for k,v in obj.items():
   if k!='present': found.extend(walk_present(v,path+(str(k),)))
 elif isinstance(obj,list):
  for i,v in enumerate(obj): found.extend(walk_present(v,path+(str(i),)))
 return found

def fetch_georisques(code,geo):
 attempts=[{'code_insee':code}]; centre=(geo.get('centre') or {}).get('coordinates')
 if isinstance(centre,list) and len(centre)>=2: attempts.append({'latlon':f'{float(centre[0]):.6f},{float(centre[1]):.6f}'})
 data={}; err=None
 for p in attempts:
  try:
   data=get_json(GEORISQUES_REPORT,p)
   if data: break
  except Exception as e: err=str(e)
 if not data: return {'status':'error' if err else 'no_data','error':err,'source':'Géorisques','source_url':'https://www.georisques.gouv.fr/','report_url':f'https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2/{quote(code)}/commune'}
 labels=[]; seen=set()
 for x in walk_present(data):
  x=' '.join(x.split()).strip()
  if x and x.lower() not in seen: seen.add(x.lower()); labels.append(x)
 return {'status':'connected','present_count':len(labels),'present_labels':labels[:12],'source':'Géorisques','source_url':'https://www.georisques.gouv.fr/','report_url':data.get('url') or data.get('urlRapport') or data.get('url_rapport') or f'https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2/{quote(code)}/commune','scope':'Rapport officiel de risques.'}

def market_indicators(r):
 price=((r.get('dvf') or {}).get('apartment') or {}).get('median_price_m2'); rent=((r.get('rents') or {}).get('apartment') or {}).get('rent_m2')
 gross=round(rent*12/price*100,2) if price and rent else None
 connected=sum(1 for k in ('geo','dvf','rents','dpe','risks') if r.get('connections',{}).get(k)=='connected')
 return {'gross_yield_apartment_pct':gross,'data_completeness':connected,'data_completeness_total':5,'note':'Rendement brut indicatif : loyer d’annonce 2025 / prix médian DVF multi-semestres.'}

def build_one(code):
 r={'version':'6.0','generated_at':now_iso(),'code_insee':code,'identity':None,'dvf':{'status':'pending'},'rents':{'status':'pending'},'dpe':{'status':'pending'},'risks':{'status':'pending'},'connections':{k:'pending' for k in ('geo','dvf','rents','dpe','risks')},'errors':[]}
 try: r['identity']=fetch_geo(code); r['connections']['geo']='connected'
 except Exception as e: r['connections']['geo']='error'; r['errors'].append({'source':'geo','error':str(e)}); return r
 for key,fn in [('dvf',lambda:fetch_dvf(code)),('rents',lambda:fetch_rents(code)),('dpe',lambda:fetch_dpe(code))]:
  try: v=fn(); r[key]=v; r['connections'][key]=v.get('status','error')
  except Exception as e: r[key]={'status':'error','error':str(e)}; r['connections'][key]='error'; r['errors'].append({'source':key,'error':str(e)})
 time.sleep(1.05)
 try: v=fetch_georisques(code,r['identity']); r['risks']=v; r['connections']['risks']=v.get('status','error')
 except Exception as e: r['risks']={'status':'error','error':str(e)}; r['connections']['risks']='error'; r['errors'].append({'source':'georisques','error':str(e)})
 r['market_indicators']=market_indicators(r); return r

def main():
 DATA_DIR.mkdir(parents=True,exist_ok=True); cfg=json.loads(MONITORED.read_text(encoding='utf-8')); codes=[str(c).strip() for c in cfg.get('codes',[]) if str(c).strip()]
 index={'version':'6.0','generated_at':now_iso(),'territories':[]}
 for code in codes:
  print('[local-v6]',code)
  try:
   payload=build_one(code); (DATA_DIR/f'{code}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
   index['territories'].append({'code_insee':code,'name':(payload.get('identity') or {}).get('nom'),'generated_at':payload.get('generated_at'),'connections':payload.get('connections'),'errors':len(payload.get('errors') or [])})
  except Exception as e: index['territories'].append({'code_insee':code,'generated_at':now_iso(),'errors':1,'error':str(e)})
 (DATA_DIR/'index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8'); print('[local-v6] territoires:',len(index['territories']))

if __name__=='__main__': main()
