
const state={
  page:"today", profile:localStorage.getItem("radarProfile")||"particulier",
  filter:"all", freshness:"fresh", sort:"pertinence",
  officialOnly:false,favoritesOnly:false,query:"",
  items:[],market:null,health:{},sourceStats:{},
  favorites:JSON.parse(localStorage.getItem("radarFavorites")||"[]"),
  feedback:JSON.parse(localStorage.getItem("radarFeedback")||"{}"),
  archiveItems:[], searchPeriod:"all",
  mobileFeedLimit:5,
  expandedStories:{}
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const isMobile=()=>window.matchMedia("(max-width:760px)").matches;
const resetMobileFeed=()=>{state.mobileFeedLimit=5};
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const dateObj=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d};
const TERRITORY_DEFAULT={
  nom:"Paris 11e Arrondissement",code:"75111",codesPostaux:["75011"],population:null,surface:null,
  departement:{code:"75",nom:"Paris"},region:{code:"11",nom:"Île-de-France"}
};
state.territoryFilter="overview";
state.territoryData=(()=>{try{return JSON.parse(localStorage.getItem("radarTerritoryData"))||TERRITORY_DEFAULT}catch{return TERRITORY_DEFAULT}})();
state.territorySearchTimer=null;
state.territoryLocal=null;
state.territoryLocalLoading=false;
state.territoryRequestId=0;

function territoryCurrent(){return state.territoryData||TERRITORY_DEFAULT}
function normalizeText(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function formatPopulation(v){return Number(v)>0?new Intl.NumberFormat("fr-FR").format(Number(v)):"Donnée indisponible"}
function territoryLabel(t=territoryCurrent()){return t.nom||"Territoire sélectionné"}
function territoryGeoTerms(t=territoryCurrent()){
  const vals=[t.nom,t.departement?.nom,t.region?.nom,...(t.codesPostaux||[])].filter(Boolean).map(normalizeText);
  const nom=normalizeText(t.nom||"").replace(/\b(arrondissement|municipal|commune)\b/g,"").replace(/\s+/g," ").trim();
  if(nom)vals.push(nom);
  return [...new Set(vals.filter(x=>x.length>1))];
}
function territoryMatchesText(i){
  const text=normalizeText([i.title,i.summary,i.why_it_matters,i.territory,i.topic].join(" "));
  return territoryGeoTerms().some(term=>term && text.includes(term));
}
function territoryFilterMatches(i){
  if(state.page!=="territories")return true;
  const text=normalizeText([i.title,i.summary,i.topic].join(" "));
  const f=state.territoryFilter;
  if(f==="overview")return true;
  if(f==="prix")return /prix|ancien|vente immobiliere|marche immobilier/.test(text);
  if(f==="loyers")return /loyer|location|locatif/.test(text);
  if(f==="transactions")return /transaction|mutation|vente|dvf/.test(text);
  if(f==="dpe")return /\bdpe\b|performance energetique|renovation energetique|passoire thermique/.test(text);
  if(f==="construction")return /construction|permis|mise en chantier|logements autorises/.test(text);
  if(f==="risques")return /risque|georisque|inondation|argile|radon|sismique|pollue/.test(text);
  return true;
}
function territoryBoost(i){
  if(state.page!=="territories")return 0;
  if(territoryMatchesText(i))return 22;
  if(i.territory==="France")return 4;
  return 0;
}
function geoRiskUrl(t=territoryCurrent()){
  if(!t.code||!t.nom)return "https://www.georisques.gouv.fr/";
  return `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2/${encodeURIComponent(t.code)}/${encodeURIComponent(t.nom)}/commune`;
}
async function fetchTerritoryByCode(code){
  const fields="nom,code,codesPostaux,population,surface,departement,region,codeDepartement,codeRegion,centre";
  const r=await fetch(`https://geo.api.gouv.fr/communes/${encodeURIComponent(code)}?fields=${encodeURIComponent(fields)}`);
  if(!r.ok)throw new Error("Territoire introuvable");
  return await r.json();
}
async function searchTerritories(q){
  q=String(q||"").trim();if(q.length<2)return [];
  const fields="nom,code,codesPostaux,population,surface,departement,region,codeDepartement,codeRegion,centre";
  const param=/^\d{5}$/.test(q)?`codePostal=${encodeURIComponent(q)}`:`nom=${encodeURIComponent(q)}&boost=population`;
  const r=await fetch(`https://geo.api.gouv.fr/communes?${param}&fields=${encodeURIComponent(fields)}`);
  if(!r.ok)throw new Error("Recherche indisponible");
  const data=await r.json();return (Array.isArray(data)?data:[]).slice(0,8);
}
async function selectTerritory(t){
  if(!t)return;
  state.territoryRequestId+=1;
  const rid=state.territoryRequestId;
  state.territoryData=t;
  state.territoryLocal=null;
  localStorage.setItem("radarTerritoryData",JSON.stringify(t));
  state.territoryFilter="overview";
  refreshTerritoryUI();
  await loadTerritoryLocalData(t,{requestId:rid});
}


const LOCAL_CACHE_TTL=24*60*60*1000;
const ADEME_DPE_AGG="https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg";
const GEORISQUES_API="https://georisques.gouv.fr/api/v1/resultats_rapport_risque";
const TABULAR_BASE="https://tabular-api.data.gouv.fr/api/resources";
const DVF_STATS_RESOURCE="851d342f-9c96-41c1-924a-11a7a7aae8a6";
const RENT_RESOURCES={
  apartment:"55b34088-0964-415f-9df7-d87dd98a09be",
  small:"14a1fe11-b2d1-49b3-9f6b-83d12df9482c",
  large:"5e3b28a4-cf56-43a3-ae79-43cceeb27f8c",
  house:"129f764d-b613-44e4-952c-5ff50a8c9b73"
};

function localCacheKey(code){return `radarLocalDataV6:${code}`}
function readLocalCache(code){
  try{
    const v=JSON.parse(localStorage.getItem(localCacheKey(code))||"null");
    if(v&&Date.now()-Number(v.cached_at||0)<LOCAL_CACHE_TTL)return v.data||null;
  }catch{}
  return null;
}
function writeLocalCache(code,data){
  try{localStorage.setItem(localCacheKey(code),JSON.stringify({cached_at:Date.now(),data}))}catch{}
}
function mergeLocalData(a,b){
  return {...(a||{}),...(b||{}),connections:{...(a?.connections||{}),...(b?.connections||{})}};
}
function parseDpeAgg(data){
  let buckets=data?.aggs||data?.aggregations||[];
  if(!Array.isArray(buckets)&&buckets&&typeof buckets==="object"){
    const collected=[];
    Object.values(buckets).forEach(v=>{
      if(Array.isArray(v))collected.push(...v);
      else if(v&&typeof v==="object")collected.push(...(v.buckets||v.values||[]));
    });
    buckets=collected;
  }
  const counts={A:0,B:0,C:0,D:0,E:0,F:0,G:0};
  (Array.isArray(buckets)?buckets:[]).forEach(b=>{
    const label=String(b?.value??b?.key??b?.label??b?._id??"").trim().toUpperCase();
    const count=Number(b?.count??b?.doc_count??b?.nb??b?.value_count??0);
    if(label in counts&&Number.isFinite(count))counts[label]+=count;
  });
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const fg=counts.F+counts.G,ab=counts.A+counts.B;
  const dominant=total?Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]:null;
  return {
    status:total?"connected":"no_data",
    total,counts,
    passoires_pct:total?Math.round((fg*1000)/total)/10:null,
    efficient_pct:total?Math.round((ab*1000)/total)/10:null,
    dominant_label:dominant,
    confidence:total>=50?"high":total?"low":"none",
    source:"ADEME — DPE logements existants",
    source_url:"https://data.ademe.fr/datasets/dpe03existant",
    scope:"DPE réalisés depuis juillet 2021 — échantillon non exhaustif du parc."
  };
}

function tabularRows(data){
  if(Array.isArray(data))return data;
  if(data&&typeof data==="object"){
    for(const key of ["data","results","records","items"]){
      if(Array.isArray(data[key]))return data[key];
    }
  }
  return [];
}
function nnum(v){
  if(v===null||v===undefined||v==="")return null;
  const n=Number(String(v).replace(/\s/g,"").replace(",","."));
  return Number.isFinite(n)?n:null;
}
async function fetchTabular(resource,params){
  const u=new URL(`${TABULAR_BASE}/${resource}/data/`);
  Object.entries({...params,page_size:20}).forEach(([k,v])=>u.searchParams.set(k,v));
  const r=await fetch(u,{cache:"no-store"});
  if(!r.ok)throw new Error(`data.gouv tabular ${r.status}`);
  return tabularRows(await r.json());
}
async function fetchDvfLive(code){
  const rows=await fetchTabular(DVF_STATS_RESOURCE,{code_geo__exact:code});
  const row=rows.find(r=>String(r.code_geo||"")===String(code))||rows[0];
  if(!row)return {status:"no_data",source:"data.gouv.fr — Statistiques DVF",source_url:"https://www.data.gouv.fr/datasets/statistiques-dvf",period:"10 semestres disponibles"};
  const apartment={median_price_m2:nnum(row.med_prix_m2_whole_appartement),mean_price_m2:nnum(row.moy_prix_m2_whole_appartement),sales:nnum(row.nb_ventes_whole_appartement)};
  const house={median_price_m2:nnum(row.med_prix_m2_whole_maison),mean_price_m2:nnum(row.moy_prix_m2_whole_maison),sales:nnum(row.nb_ventes_whole_maison)};
  const totalSales=(apartment.sales||0)+(house.sales||0)||null;
  return {status:(apartment.median_price_m2||house.median_price_m2||totalSales)?"connected":"no_data",apartment,house,total_sales:totalSales,source:"data.gouv.fr — Statistiques DVF",source_url:"https://www.data.gouv.fr/datasets/statistiques-dvf",explorer_url:"https://explore.data.gouv.fr/fr/immobilier",period:"10 semestres disponibles",method:"Médiane du prix au m² selon la méthodologie data.gouv.fr."};
}
async function fetchRentOne(resource,code){
  const rows=await fetchTabular(resource,{INSEE_C__exact:code});
  const row=rows.find(r=>String(r.INSEE_C||"")===String(code))||rows[0];
  if(!row)return null;
  return {rent_m2:nnum(row.loypredm2),low_m2:nnum(row["lwr.IPm2"]),high_m2:nnum(row["upr.IPm2"]),prediction_type:row.TYPPRED,observations_commune:nnum(row.nbobs_com),observations_mesh:nnum(row.nbobs_mail),r2:nnum(row.R2_adj)};
}
async function fetchRentsLive(code){
  const results=await Promise.allSettled(Object.entries(RENT_RESOURCES).map(async([k,r])=>[k,await fetchRentOne(r,code)]));
  const out={};results.forEach(res=>{if(res.status==="fulfilled")out[res.value[0]]=res.value[1]});
  const available=Object.values(out).filter(v=>v?.rent_m2!=null),main=out.apartment;
  let confidence="none",warning=null;
  if(main){
    const obs=main.observations_commune||0,r2=main.r2;
    if(obs>=30&&(r2==null||r2>=.5))confidence="high";
    else if(obs>0){confidence="medium";warning="À interpréter avec prudence : échantillon communal limité ou R² faible."}
    else{confidence="estimated";warning="Estimation issue d’une maille élargie : peu ou pas d’annonces observées directement dans la commune."}
  }
  return {status:available.length?"connected":"no_data",...out,confidence,warning,source:"Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin",source_url:"https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025",period:"T3 2025",scope:"Loyers d’annonce charges comprises, logements loués vides."};
}
function buildLocalIndicators(data){
  const price=data?.dvf?.apartment?.median_price_m2,rent=data?.rents?.apartment?.rent_m2;
  const gross=price&&rent?Math.round((rent*12/price)*10000)/100:null;
  const connected=["geo","dvf","rents","dpe","risks"].filter(k=>data?.connections?.[k]==="connected").length;
  return {gross_yield_apartment_pct:gross,data_completeness:connected,data_completeness_total:5};
}

async function fetchDpeLive(code){
  const u=new URL(ADEME_DPE_AGG);
  u.searchParams.set("field","etiquette_dpe");
  u.searchParams.set("qs",`code_insee_ban:"${code}"`);
  u.searchParams.set("agg_size","20");
  u.searchParams.set("size","0");
  const r=await fetch(u,{cache:"no-store"});
  if(!r.ok)throw new Error(`ADEME ${r.status}`);
  return parseDpeAgg(await r.json());
}
function centreLonLat(t){
  const c=t?.centre?.coordinates;
  return Array.isArray(c)&&c.length>=2?[Number(c[0]),Number(c[1])]:null;
}
function countPresentRiskFlags(obj){
  const labels=[],seen=new Set();
  function walk(v,path=[]){
    if(Array.isArray(v)){v.forEach((x,i)=>walk(x,[...path,String(i)]));return}
    if(!v||typeof v!=="object")return;
    if(v.present===true){
      const label=String(v.libelle||v.libelleRisque||v.nom||v.type||path.at(-1)||"Risque").trim();
      if(label&&!seen.has(label.toLowerCase())){seen.add(label.toLowerCase());labels.push(label)}
    }
    Object.entries(v).forEach(([k,x])=>{if(k!=="present")walk(x,[...path,k])});
  }
  walk(obj);
  return labels;
}
async function fetchGeorisquesLive(t){
  const attempts=[];
  if(t?.code)attempts.push({code_insee:t.code});
  const center=centreLonLat(t);
  if(center)attempts.push({latlon:`${center[0]},${center[1]}`});
  let last=null;
  for(const params of attempts){
    try{
      const u=new URL(GEORISQUES_API);
      Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
      const r=await fetch(u,{cache:"no-store"});
      if(!r.ok)throw new Error(`Géorisques ${r.status}`);
      const data=await r.json();
      if(data&&Object.keys(data).length){
        const labels=countPresentRiskFlags(data);
        return {
          status:"connected",
          present_count:labels.length,
          present_labels:labels.slice(0,12),
          source:"Géorisques",
          source_url:"https://www.georisques.gouv.fr/",
          report_url:geoRiskUrl(t),
          scope:"Rapport officiel de risques. La précision dépend des données disponibles."
        };
      }
    }catch(e){last=e}
  }
  throw last||new Error("Géorisques indisponible");
}
async function fetchStaticLocal(code){
  try{
    const r=await fetch(`./data/territories/${encodeURIComponent(code)}.json`,{cache:"no-store"});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null}
}
async function loadTerritoryLocalData(t,{force=false,requestId=null}={}){
  if(!t?.code)return;
  const code=String(t.code),rid=requestId??state.territoryRequestId;
  state.territoryLocalLoading=true;
  if(state.page==="territories")refreshTerritoryUI();
  if(!force){
    const cached=readLocalCache(code);
    if(cached){
      if(String(territoryCurrent()?.code)===code&&rid===state.territoryRequestId){state.territoryLocal=cached;state.territoryLocalLoading=false;refreshTerritoryUI()}
      return cached;
    }
  }
  let data=await fetchStaticLocal(code)||{version:"6.0",code_insee:code,connections:{geo:"connected",dvf:"pending",rents:"pending",dpe:"pending",risks:"pending"}};
  const jobs=[];
  if(!data.dvf||["pending","error"].includes(data.dvf.status))jobs.push(fetchDvfLive(code).then(v=>{data=mergeLocalData(data,{dvf:v,connections:{dvf:v.status}})}).catch(()=>{}));
  if(!data.rents||["pending","error"].includes(data.rents.status))jobs.push(fetchRentsLive(code).then(v=>{data=mergeLocalData(data,{rents:v,connections:{rents:v.status}})}).catch(()=>{}));
  if(!data.dpe||["pending","error"].includes(data.dpe.status))jobs.push(fetchDpeLive(code).then(v=>{data=mergeLocalData(data,{dpe:v,connections:{dpe:v.status}})}).catch(()=>{}));
  if(!data.risks||["pending","error"].includes(data.risks.status))jobs.push(fetchGeorisquesLive(t).then(v=>{data=mergeLocalData(data,{risks:v,connections:{risks:v.status}})}).catch(()=>{}));
  await Promise.allSettled(jobs);
  data.market_indicators={...(data.market_indicators||{}),...buildLocalIndicators(data)};
  writeLocalCache(code,data);
  if(String(territoryCurrent()?.code)===code&&rid===state.territoryRequestId){state.territoryLocal=data;state.territoryLocalLoading=false;refreshTerritoryUI()}
  return data;
}
function connectionLabel(status){
  return status==="connected"?"Connectée":status==="no_data"?"Aucune donnée":status==="error"?"Indisponible":status==="loading"?"Connexion…":"À brancher";
}
function connectionClass(status){
  return status==="connected"?"ok":status==="error"?"error":"pending";
}

function fmtDate(v){const d=dateObj(v);return d?new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(d).toUpperCase():"DATE NON DISPONIBLE"}
function fmtUpdate(v){const d=dateObj(v);return d?`VEILLE MISE À JOUR LE ${new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(d).toUpperCase()}`:"VEILLE MISE À JOUR"}
function ageDays(v){const d=dateObj(v);return d?Math.floor((Date.now()-d.getTime())/86400000):9999}
function score(i){
  let n=Number(i.relevance||0);
  if((i.audiences||[]).includes(state.profile))n+=5;

  const weights={
    particulier:{lois:7,credit:11,marche:7,territoires:5,investir:1,pro:-8},
    investisseur:{lois:8,credit:9,marche:7,territoires:7,investir:14,pro:3},
    pro:{lois:10,credit:4,marche:9,territoires:8,investir:4,pro:15}
  };
  n+=(weights[state.profile]?.[i.category]||0);

  const fb=state.feedback[i.id];
  if(fb==="more")n+=7;
  if(fb==="less")n-=12;
  n+=territoryBoost(i);
  return Math.max(0,Math.min(100,n));
}
function savePrefs(){localStorage.setItem("radarFavorites",JSON.stringify(state.favorites));localStorage.setItem("radarFeedback",JSON.stringify(state.feedback))}

function profileContext(){
  return {
    particulier:{
      hero:"Achat, vente, crédit, travaux : les signaux qui peuvent réellement changer votre projet.",
      note:"Le fil privilégie achat, crédit, DPE, travaux, location et copropriété.",
      feed:"Ce qui peut changer votre projet",
      lens:"Pour un particulier : regardez surtout le coût du crédit, la capacité de négociation et l’évolution des prix."
    },
    investisseur:{
      hero:"Rendement, fiscalité, loyers, financement : une lecture conçue pour décider avec plus de contexte.",
      note:"Le fil privilégie rendement, fiscalité, financement, loyers et réglementation bailleurs.",
      feed:"Ce qui peut changer votre rendement",
      lens:"Pour un investisseur : surveillez le coût du financement, la tension locative, la fiscalité et l’offre future."
    },
    pro:{
      hero:"Volumes, réglementation, construction, réseaux et outils : les signaux utiles pour piloter votre activité.",
      note:"Le fil privilégie réglementation, volumes, construction, agences, syndic, proptech et marché local.",
      feed:"Ce qui peut changer votre activité",
      lens:"Pour un professionnel : l’activité dépend surtout des volumes, du crédit, de la réglementation et du marché local."
    }
  }[state.profile];
}
function profileWhy(i){
  const base=i.why_it_matters||"Cette information a un impact immobilier concret à surveiller.";
  const extra={
    particulier:{
      lois:" À vérifier avant d’acheter, vendre, louer ou engager des travaux.",
      credit:" Impact direct sur votre capacité d’emprunt, votre mensualité et votre budget.",
      marche:" Peut modifier le bon moment pour acheter, vendre ou négocier.",
      territoires:" À confronter aux données de votre commune avant toute décision."
    },
    investisseur:{
      lois:" Peut modifier votre fiscalité, vos obligations ou la rentabilité nette.",
      credit:" Le coût de la dette peut faire basculer la rentabilité d’une opération.",
      marche:" À lire avec les loyers, la vacance et le prix d’entrée.",
      investir:" À intégrer directement dans votre calcul de rendement et de risque.",
      territoires:" La rentabilité se joue souvent à l’échelle locale, pas nationale."
    },
    pro:{
      lois:" Peut modifier vos obligations, vos process ou l’information à transmettre aux clients.",
      credit:" Peut affecter la solvabilité des acquéreurs et les volumes de transactions.",
      marche:" Peut changer les volumes, les délais et le rapport de force avec les clients.",
      pro:" Signal à intégrer dans vos outils, vos argumentaires ou votre organisation.",
      territoires:" Peut avoir un impact direct sur votre activité commerciale locale."
    }
  };
  return base+(extra[state.profile]?.[i.category]||"");
}
function renderProfileContext(){
  const c=profileContext();
  if($("#heroProfileCopy"))$("#heroProfileCopy").textContent=c.hero;
  if($("#profileNote"))$("#profileNote").textContent=c.note;
  if($("#activeProfileBadge")){
    const labels={particulier:"Particulier",investisseur:"Investisseur",pro:"Professionnel"};
    $("#activeProfileBadge").textContent=`Vue : ${labels[state.profile]||state.profile}`;
  }
  if($("#marketProfileLens"))$("#marketProfileLens").innerHTML=`<strong>Lecture ${state.profile==="pro"?"professionnelle":state.profile} :</strong> ${esc(c.lens)}`;
}
function sourceReliability(i){return i.source_level==="A"?"Officielle · Fiabilité 100/100":i.source_level==="B"?"Institutionnelle · Fiabilité 96/100":i.source_level==="C"?"Média spécialisé · Fiabilité 78/100":"Blog / expert · Fiabilité 68/100"}
function kind(i){if(i.category==="lois")return i.legal_stage?"NOUVELLE RÈGLE":"ACTUALITÉ JURIDIQUE";if(i.category==="credit")return"CRÉDIT IMMOBILIER";if(i.category==="investir")return"INVESTISSEMENT";if(i.category==="territoires")return"DONNÉES LOCALES";if(i.category==="pro")return"PROFESSIONNELS";if(i.source_level==="A")return"CHIFFRE OFFICIEL";if(i.source_level==="C")return"ANALYSE MÉDIA";if(i.source_level==="D")return"ANALYSE EXPERT";return"ACTUALITÉ IMMOBILIÈRE"}
function filterMatches(i){
  if(state.filter==="all")return true;
  if(state.filter==="credit")return i.category==="credit"||/crédit immobilier|credit immobilier|crédit à l'habitat|credit a l'habitat|prêt immobilier|pret immobilier|taux immobilier/i.test(`${i.title} ${i.summary}`);
  if(state.filter==="pro")return i.category==="pro"||(i.audiences||[]).includes("pro")&&/agence|syndic|promoteur|proptech|professionnel/i.test(`${i.title} ${i.summary}`);
  return i.category===state.filter;
}
function pageMatches(i){
  if(state.page==="today")return true;
  if(state.page==="laws")return i.category==="lois";
  if(state.page==="market")return ["marche","credit"].includes(i.category);
  if(state.page==="invest")return i.category==="investir"||/\blmnp\b|\bscpi\b|investissement locatif|fiscalité immobilière/i.test(`${i.title} ${i.summary}`.toLowerCase());
  if(state.page==="territories"){
    if(!territoryFilterMatches(i))return false;
    if(i.category==="territoires")return territoryMatchesText(i);
    const national=i.territory==="France"&&["lois","marche","credit","investir"].includes(i.category);
    if(!national)return false;
    return Number(i.relevance||0)>=82||Number(i.importance||0)>=88||i.source_level==="A";
  }
  return true;
}
function freshnessMatches(i){
  if(state.page!=="today")return true;
  const d=ageDays(i.published_at);
  if(state.freshness==="fresh")return d<=3;
  if(state.freshness==="week")return d<=8;
  return true;
}
function filteredItems(){
  const q=state.query.trim().toLowerCase();
  let arr=state.items.filter(i=>{
    const profile=(i.audiences||[]).includes(state.profile)||(i.audiences||[]).includes("tous");
    const official=!state.officialOnly||i.source_level==="A";
    const fav=!state.favoritesOnly||state.favorites.includes(i.id);
    const text=[i.title,i.summary,i.why_it_matters,i.source,i.topic,i.territory].join(" ").toLowerCase();
    return profile&&official&&fav&&filterMatches(i)&&pageMatches(i)&&freshnessMatches(i)&&(!q||text.includes(q));
  });
  if(state.page==="today"&&state.freshness==="fresh"&&arr.length<5){
    arr=state.items.filter(i=>{
      const profile=(i.audiences||[]).includes(state.profile)||(i.audiences||[]).includes("tous");
      const official=!state.officialOnly||i.source_level==="A";
      const fav=!state.favoritesOnly||state.favorites.includes(i.id);
      const text=[i.title,i.summary,i.why_it_matters,i.source,i.topic,i.territory].join(" ").toLowerCase();
      return profile&&official&&fav&&filterMatches(i)&&pageMatches(i)&&ageDays(i.published_at)<=14&&(!q||text.includes(q));
    });
  }
  arr.sort((a,b)=>state.sort==="recent"?(dateObj(b.published_at)?.getTime()||0)-(dateObj(a.published_at)?.getTime()||0):state.sort==="important"?Number(b.importance||0)-Number(a.importance||0):score(b)-score(a));
  if(state.page==="territories")arr=arr.slice(0,24);
  return arr;
}
function marketWeightedScore(m){
  const comps=m?.score_components||[];
  const denom=comps.reduce((s,c)=>s+Number(c.weight||0),0);
  if(!denom)return Number(m?.temperature?.score||0);
  return Math.round(comps.reduce((s,c)=>s+Number(c.score||0)*Number(c.weight||0),0)/denom);
}
function selectDynamicPulse(){
  const eligible=state.items.filter(i=>{
    const d=ageDays(i.published_at);
    return d<=35&&["A","B","C"].includes(i.source_level)&&i.url&&directLike(i.url);
  });
  const categories=["credit","lois","marche","territoires","investir"];
  const picked=[];
  categories.forEach(cat=>{
    const best=eligible.filter(i=>i.category===cat).sort((a,b)=>score(b)-score(a))[0];
    if(best&&!picked.some(x=>x.id===best.id))picked.push(best);
  });
  return picked.sort((a,b)=>score(b)-score(a)).slice(0,3);
}
function directLike(url){
  try{const u=new URL(url,location.href);return !["","/"].includes(u.pathname)}catch{return false}
}
function renderMarket(){
  const m=state.market;if(!m)return;
  const s=marketWeightedScore(m);
  $("#marketScore").textContent=s;
  $("#marketStatus").textContent=(m.temperature?.status||m.temperature?.label||"MARCHÉ").toUpperCase();
  $("#marketHeadline").textContent=m.temperature?.headline||m.temperature?.label||"";
  $("#marketComment").textContent=m.temperature?.comment||"";
  $("#marketGauge").style.background=`conic-gradient(var(--coral) 0deg ${s*3.6}deg,#deded7 ${s*3.6}deg 360deg)`;
  $("#marketPeriod").textContent=m.period_label||"DERNIERS POINTS DISPONIBLES";
  $("#marketTrendMini").innerHTML=(m.history||[45,47,49,50,48]).map(v=>`<i style="height:${Math.max(6,v/2.2)}px" title="${v}/100"></i>`).join("");

  $("#balanceLabel").textContent=m.balance?.label||"";
  $("#balanceComment").textContent=m.balance?.comment||"";
  const bs=Math.max(0,Math.min(100,m.balance?.score||50));
  $("#balanceFill").style.width=`${bs}%`;$("#balanceDot").style.left=`${bs}%`;

  $("#financeLabel").textContent=m.financing?.label||"";
  $("#financeComment").textContent=m.financing?.comment||"";
  $("#financeBars").innerHTML=(m.financing?.bars||[35,39,41,48,45,51,47,44,40,39,36,37]).map(v=>`<i style="height:${v}px"></i>`).join("");

  $("#marketKeyFigures").innerHTML=(m.key_figures||[]).slice(0,3).map(k=>`<div class="key-figure ${k.negative?"negative":""}"><small>${esc(k.label)}</small><strong>${esc(k.value)}</strong></div>`).join("");

  const comps=m.score_components||m.components||[];
  $("#marketComponents").innerHTML=comps.map(c=>`<div class="component">
    <small>${esc(c.label)}</small>
    <strong>${c.score!=null?`${esc(c.score)}/100`:esc(c.value)}</strong>
    ${c.score!=null?`<span class="component-value">${esc(c.value||"")}</span>`:""}
    <span>${esc(c.source||"")} · ${esc(c.period||"")}</span>
    ${c.weight!=null?`<span class="component-weight">Poids ${esc(c.weight)} %</span>`:""}
    ${c.reason?`<span class="component-reason">${esc(c.reason)}</span>`:""}
    <span class="trend">${esc(c.trend||"→")}</span>
  </div>`).join("");
  $("#marketConfidence").textContent=`${m.confidence||0}/100`;
  if($("#marketMethodNote"))$("#marketMethodNote").textContent=m.methodology_note||"";

  const nxt=(m.next_publications||[])[0];
  if($("#marketNextPublication"))$("#marketNextPublication").innerHTML=nxt?`<strong>Prochaine échéance :</strong> ${esc(nxt.date)} · ${esc(nxt.label)} <span>${esc(nxt.source)}</span>`:"";

  renderProfileContext();

  const livePulse=selectDynamicPulse();
  const pulse=livePulse.length>=3?livePulse.map(i=>({
    label:kind(i).replace("ACTUALITÉ ",""),
    title:i.title,
    text:i.summary,
    url:i.url,
    source:i.source
  })):(m.pulse||[]);
  $("#pulseGrid").innerHTML=pulse.slice(0,3).map((p,idx)=>`<article class="pulse-card">
    <span class="pulse-index">0${idx+1}</span>
    <span class="label">${esc(p.label)}</span>
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.text)}</p>
    ${p.source?`<small class="pulse-source">${esc(p.source)}</small>`:""}
    ${p.url?`<a href="${esc(p.url)}" target="_blank" rel="noopener">Voir la source ↗</a>`:""}
  </article>`).join("");
}
function pageConfig(){
  return {
    today:{eyebrow:"Fil personnalisé",title:profileContext().feed,desc:""},
    laws:{eyebrow:"Radar juridique",title:"Lois & réglementation",desc:"Suivez les textes immobiliers français et européens sans confondre projet, adoption, publication et entrée en vigueur."},
    market:{eyebrow:"Marché immobilier",title:"Prix, crédit & activité",desc:"Les données officielles et les analyses qui permettent de lire la situation du marché."},
    invest:{eyebrow:"Investissement",title:"Investir avec plus de contexte",desc:"Fiscalité, LMNP, location nue, SCPI, financement et signaux de marché."},
    territories:{eyebrow:"Territoires",title:"Votre marché, à l’échelle locale.",desc:"Choisissez une commune ou un arrondissement. Le Radar priorise les informations qui concernent ce territoire et conserve les signaux nationaux réellement utiles."}
  }[state.page];
}
function refreshTerritoryUI(){
  if(state.page!=="territories")return;
  if($("#feedEyebrow"))$("#feedEyebrow").textContent="Veille territoriale";
  if($("#feedTitle"))$("#feedTitle").textContent=`Ce qui affecte ${territoryLabel()}`;
  renderTerritoryDashboard();renderTerritoryFeedControls();renderSidebar();renderFeed();
}
function renderPage(){
  const c=pageConfig();
  $("#feedEyebrow").textContent=c.eyebrow;$("#feedTitle").textContent=c.title;
  const intro=$("#pageIntro");intro.hidden=state.page==="today";
  if(!intro.hidden){$("#pageEyebrow").textContent=c.eyebrow;$("#pageTitle").textContent=c.title;$("#pageDescription").textContent=c.desc}
  $("#todayOverview").hidden=state.page!=="today"&&state.page!=="market";$("#pulseSection").hidden=state.page!=="today";
  $("#legalDashboard").hidden=state.page!=="laws";$("#investDashboard").hidden=state.page!=="invest";$("#territoryDashboard").hidden=state.page!=="territories";
  $("#freshnessTabs").hidden=state.page!=="today";
  if($("#globalFeedControls"))$("#globalFeedControls").hidden=state.page==="territories";
  if($("#territoryFeedControls"))$("#territoryFeedControls").hidden=state.page!=="territories";
  if(state.page==="territories"){$("#feedEyebrow").textContent="Veille territoriale";$("#feedTitle").textContent=`Ce qui affecte ${territoryLabel()}`;}
  renderLegalDashboard();renderInvestDashboard();renderTerritoryDashboard();renderTerritoryFeedControls();renderSidebar();renderFeed();
}
function renderLegalDashboard(){
  if(state.page!=="laws")return;
  const fr=state.items.filter(i=>i.category==="lois"&&(i.territory||"France")!=="Union européenne"),eu=state.items.filter(i=>i.category==="lois"&&i.territory==="Union européenne");
  $("#frLegalCount").textContent=`${fr.length} texte${fr.length>1?"s":""}`;$("#euLegalCount").textContent=`${eu.length} texte${eu.length>1?"s":""}`;
  const counts=(items,euMode=false)=>{
    const defs=euMode?[["proposal","Proposition"],["discussion","Discussion"],["adopte","Adopté"],["jorf","Publié"],["transposition","À transposer / applicable"]]:[["depot","Déposé"],["discussion","Discussion"],["adopte","Adopté"],["promulgue","Promulgué"],["jorf","Publié / en vigueur"]];
    return defs.map(([key,label])=>{
      let n=items.filter(i=>euMode?(key==="transposition"?/directive|règlement|reglement/i.test(i.status||""):i.legal_stage===key):i.legal_stage===key).length;
      return `<div class="stage-box"><small>Étape</small><strong>${n}</strong><span>${esc(label)}</span></div>`;
    }).join("");
  };
  $("#frLegalStages").innerHTML=counts(fr,false);$("#euLegalStages").innerHTML=counts(eu,true);
}
function renderInvestDashboard(){
  if(state.page!=="invest")return;
  const cards=[
    ["LMNP","À surveiller","Fiscalité et règles d’amortissement : suivre les textes et la rentabilité nette.","Fiscalité","Location"],
    ["Location nue","Stable","Rendement à apprécier après fiscalité, travaux et niveau de loyer local.","Fiscalité","Loyers"],
    ["SCPI","Sélectif","Regarder la collecte, les valeurs de parts, la liquidité et l’exposition sectorielle.","Liquidité","Rendement"],
    ["Ancien + travaux","Opportunité conditionnelle","Le financement et le DPE restent déterminants dans l’équation économique.","DPE","Travaux"]
  ];
  $("#investCards").innerHTML=cards.map(c=>`<article class="invest-card"><span class="flag">${c[1]}</span><h3>${c[0]}</h3><p>${c[2]}</p><div class="invest-metrics"><span>${c[3]}</span><span>${c[4]}</span></div></article>`).join("");
}

function renderTerritoryFeedControls(){
  if(!$("#territoryFeedControls"))return;
  $$(".territory-filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.territoryFilter===state.territoryFilter));
}
function fmtEuroM2(v){const n=Number(v);return Number.isFinite(n)?`${new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(n)} €/m²`:"Donnée indisponible";}
function fmtRentM2(v){const n=Number(v);return Number.isFinite(n)?`${new Intl.NumberFormat("fr-FR",{minimumFractionDigits:1,maximumFractionDigits:1}).format(n)} €/m²`:"Donnée indisponible";}
function fmtCount(v){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("fr-FR").format(n):"Donnée indisponible";}
function territoryMarketMetric(label,source,url,status="En connexion",note="",stateClass=""){
  return `<article class="territory-market-metric ${esc(stateClass)}"><small>${esc(label)}</small><strong>${esc(status)}</strong><span>${esc(source)}</span>${note?`<em>${esc(note)}</em>`:""}<a href="${esc(url)}" target="_blank" rel="noopener">Source officielle ↗</a></article>`;
}
function renderTerritorySearchResults(results){
  const box=$("#territorySearchResults");if(!box)return;
  if(!results.length){box.innerHTML='<div class="territory-search-empty">Aucun territoire trouvé.</div>';box.hidden=false;return;}
  box.innerHTML=results.map(t=>`<button class="territory-search-result" data-code="${esc(t.code)}"><strong>${esc(t.nom)}</strong><span>${esc(t.codesPostaux?.join(" · ")||t.code)}${t.departement?.nom?` · ${esc(t.departement.nom)}`:""}</span></button>`).join("");
  box.hidden=false;
  box.querySelectorAll(".territory-search-result").forEach(b=>b.onclick=async()=>{try{const t=await fetchTerritoryByCode(b.dataset.code);await selectTerritory(t);$("#territorySearchInput").value=t.nom;box.hidden=true}catch(e){console.error(e)}});
}
function renderTerritoryDashboard(){
  if(state.page!=="territories")return;
  const t=territoryCurrent();
  $("#territoryName").textContent=territoryLabel(t);
  $("#territoryMeta").textContent=[t.departement?.nom,t.region?.nom].filter(Boolean).join(" · ")||"France";
  if($("#territorySearchInput")&&!$("#territorySearchInput").matches(":focus"))$("#territorySearchInput").value=territoryLabel(t);
  const identity=[["Code INSEE",t.code||"—"],["Population",formatPopulation(t.population)],["Code postal",(t.codesPostaux||[]).join(" · ")||"—"],["Département",t.departement?.nom||t.codeDepartement||"—"],["Région",t.region?.nom||t.codeRegion||"—"]];
  $("#territoryIdentityMetrics").innerHTML=identity.map(m=>`<div class="territory-identity-metric"><small>${esc(m[0])}</small><strong>${esc(m[1])}</strong></div>`).join("");
  const local=state.territoryLocal||{},loading=state.territoryLocalLoading,dvf=local.dvf||{},rents=local.rents||{},dpe=local.dpe||{},risks=local.risks||{};
  const appPrice=dvf.apartment?.median_price_m2,housePrice=dvf.house?.median_price_m2,appSales=dvf.apartment?.sales,houseSales=dvf.house?.sales,totalSales=dvf.total_sales;
  const rentApp=rents.apartment?.rent_m2;
  const dpeStatus=loading&&!dpe.status?"Chargement…":dpe.status==="connected"&&dpe.passoires_pct!=null?`F–G : ${String(dpe.passoires_pct).replace(".",",")} %`:dpe.status==="no_data"?"Aucun DPE trouvé":"En connexion";
  const dpeNote=dpe.status==="connected"?`${fmtCount(dpe.total||0)} DPE observés · classe dominante ${dpe.dominant_label||"—"}`:dpe.status==="no_data"?"La requête n’a renvoyé aucun DPE. Cela ne signifie pas qu’aucun logement de la commune ne possède de DPE.":"";
  const riskStatus=loading&&!risks.status?"Chargement…":risks.status==="connected"?"Rapport connecté":"Rapport disponible";
  const riskNote=risks.status==="connected"&&Number.isFinite(Number(risks.present_count))?`${risks.present_count} signal${Number(risks.present_count)>1?"aux":""} identifié${Number(risks.present_count)>1?"s":""}`:"";
  const rentNote=rents.status==="connected"?`${rents.period||"T3 2025"} · ${rents.apartment?.observations_commune??0} observation(s) communale(s)${rents.warning?` · ${rents.warning}`:""}`:"";
  $("#territoryMarketMetrics").innerHTML=[
    territoryMarketMetric("Prix médian appartements","Statistiques DVF",dvf.source_url||"https://www.data.gouv.fr/datasets/statistiques-dvf",dvf.status==="connected"&&appPrice?fmtEuroM2(appPrice):loading?"Chargement…":"Donnée indisponible",dvf.status==="connected"?`${fmtCount(appSales)} ventes · ${dvf.period||"période disponible"}`:"",dvf.status==="connected"?"is-connected":""),
    territoryMarketMetric("Prix médian maisons","Statistiques DVF",dvf.source_url||"https://www.data.gouv.fr/datasets/statistiques-dvf",dvf.status==="connected"&&housePrice?fmtEuroM2(housePrice):"Donnée indisponible",dvf.status==="connected"&&housePrice?`${fmtCount(houseSales)} ventes · ${dvf.period||"période disponible"}`:"",dvf.status==="connected"&&housePrice?"is-connected":""),
    territoryMarketMetric("Transactions","Statistiques DVF",dvf.explorer_url||"https://explore.data.gouv.fr/fr/immobilier",dvf.status==="connected"&&totalSales!=null?fmtCount(totalSales):loading?"Chargement…":"Donnée indisponible",dvf.status==="connected"?`Appartements ${fmtCount(appSales)} · maisons ${fmtCount(houseSales)}`:"",dvf.status==="connected"?"is-connected":""),
    territoryMarketMetric("Loyer appartement","Carte des loyers 2025",rents.source_url||"https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025",rents.status==="connected"&&rentApp?fmtRentM2(rentApp):loading?"Chargement…":"Donnée indisponible",rentNote,rents.status==="connected"?"is-connected":""),
    territoryMarketMetric("DPE","ADEME",dpe.source_url||"https://data.ademe.fr/datasets/dpe03existant",dpeStatus,dpeNote,dpe.status==="connected"?"is-connected":""),
    territoryMarketMetric("Risques","Géorisques",risks.report_url||geoRiskUrl(t),riskStatus,riskNote,risks.status==="connected"?"is-connected":"")
  ].join("");
  const indicators={...(local.market_indicators||{}),...buildLocalIndicators(local)},gross=indicators.gross_yield_apartment_pct,complete=indicators.data_completeness||0;
  if(state.profile==="investisseur"){
    $("#territoryReadingTitle").textContent=gross!=null?`Rendement brut indicatif : ${String(gross).replace(".",",")} %`:"Décider localement, sans confondre rendement et marché.";
    $("#territoryReadingText").textContent=gross!=null?`Ce ratio rapproche le loyer d’annonce appartement (${fmtRentM2(rentApp)}) du prix médian DVF (${fmtEuroM2(appPrice)}). Il reste à corriger de la fiscalité, des charges, de la vacance, des travaux et du financement.`:"Le Radar croise prix, loyers, financement, DPE et réglementation bailleur dès que les sources sont disponibles.";
  }else if(state.profile==="pro"){
    $("#territoryReadingTitle").textContent=`${complete}/5 familles de données locales connectées.`;
    $("#territoryReadingText").textContent="Le Radar distingue les volumes DVF, les niveaux de prix, les loyers d’annonce, le DPE et les risques pour donner une lecture plus opérationnelle du marché local.";
  }else{
    $("#territoryReadingTitle").textContent=appPrice?`Le prix local est désormais sourcé : ${fmtEuroM2(appPrice)} pour l’appartement.`:"Situer votre projet dans son vrai marché.";
    $("#territoryReadingText").textContent="Les valeurs affichées proviennent de sources publiques distinctes. Elles servent à cadrer une décision, pas à remplacer l’estimation précise d’un bien.";
  }
  const statuses=[["API Découpage administratif","connected","https://geo.api.gouv.fr/decoupage-administratif/communes"],["DVF",loading&&!dvf.status?"loading":(dvf.status||local.connections?.dvf||"pending"),dvf.source_url||"https://www.data.gouv.fr/datasets/statistiques-dvf"],["Carte des loyers",loading&&!rents.status?"loading":(rents.status||local.connections?.rents||"pending"),rents.source_url||"https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025"],["ADEME DPE",loading&&!dpe.status?"loading":(dpe.status||local.connections?.dpe||"pending"),dpe.source_url||"https://data.ademe.fr/datasets/dpe03existant"],["Géorisques",loading&&!risks.status?"loading":(risks.status||local.connections?.risks||"pending"),risks.report_url||geoRiskUrl(t)]];
  $("#territorySourceStatus").innerHTML=`<div class="territory-source-status-head"><span class="eyebrow">Sources locales</span><p>${complete}/5 familles de données sont connectées pour ce territoire. Les périodes et précautions méthodologiques restent visibles.</p></div><div class="territory-source-status-grid">${statuses.map(s=>`<a href="${esc(s[2])}" target="_blank" rel="noopener"><span>${esc(s[0])}</span><strong class="${connectionClass(s[1])}">${esc(connectionLabel(s[1]))}</strong></a>`).join("")}</div>`;
}

function legalSidebar(){
  let laws=state.items.filter(i=>i.category==="lois"&&i.source_level==="A").sort((a,b)=>(dateObj(b.published_at)?.getTime()||0)-(dateObj(a.published_at)?.getTime()||0)).slice(0,3);
  return `<span class="overline">Radar des lois</span><h2>À surveiller</h2><p>Le statut exact de chaque texte, de l’annonce à son application.</p><div class="timeline">${laws.map((i,idx)=>`<article class="timeline-item ${idx===1?"orange":idx===2?"gold":""}"><small>${esc(i.territory==="Union européenne"?(i.status||"UE"):(i.status||"France"))}</small><h3>${esc(i.title)}</h3><p>${esc(i.summary)}</p><a href="${esc(i.url)}" target="_blank" rel="noopener">Voir le texte ↗</a></article>`).join("")||"<p>Aucun texte récent détecté.</p>"}</div><button class="sidebar-cta" data-sidebar-action="laws">Voir toutes les lois →</button>`;
}
function marketSidebar(){
  const m=state.market||{};return `<span class="overline">Lecture du marché</span><h2>Ce qui pèse sur le score</h2><p>Les composantes nationales sont comparées avec leur dernière période disponible.</p><div>${(m.components||[]).slice(0,5).map(c=>`<div class="sidebar-metric"><span>${esc(c.label)}</span><strong>${esc(c.value)}</strong></div>`).join("")}</div><button class="sidebar-cta" data-sidebar-action="method">Voir la méthodologie →</button>`;
}
function investSidebar(){
  const inv=state.items.filter(i=>i.category==="investir").slice(0,3);return `<span class="overline">Investir</span><h2>Points de vigilance</h2><p>Le rendement brut ne suffit pas : fiscalité, financement, réglementation et demande locative doivent être lus ensemble.</p><div>${inv.map(i=>`<div class="sidebar-metric"><span>${esc(i.topic||"Signal")}</span><strong>${score(i)}/100</strong></div>`).join("")||'<div class="sidebar-metric"><span>Actualités ciblées</span><strong>En veille</strong></div>'}</div><button class="sidebar-cta" data-sidebar-action="sources">Sources investissement →</button>`;
}
function territorySidebar(){
  const t=territoryCurrent(),local=state.territoryLocal||{},dvf=local.dvf||{},rents=local.rents||{},dpe=local.dpe||{},risks=local.risks||{};
  const price=dvf.apartment?.median_price_m2,rent=rents.apartment?.rent_m2;
  const dpeText=dpe.status==="connected"&&dpe.passoires_pct!=null?`F–G ${String(dpe.passoires_pct).replace(".",",")} %`:connectionLabel(dpe.status||"pending");
  const riskText=risks.status==="connected"?"Connectés":connectionLabel(risks.status||"pending");
  return `<span class="overline">Radar local</span><h2>${esc(territoryLabel(t))}</h2><p>${esc([t.departement?.nom,t.region?.nom].filter(Boolean).join(" · ")||"France")}</p><div class="sidebar-metric"><span>Prix appartements</span><strong>${esc(price?fmtEuroM2(price):"—")}</strong></div><div class="sidebar-metric"><span>Loyer appartement</span><strong>${esc(rent?fmtRentM2(rent):"—")}</strong></div><div class="sidebar-metric"><span>DPE ADEME</span><strong>${esc(dpeText)}</strong></div><div class="sidebar-metric"><span>Géorisques</span><strong>${esc(riskText)}</strong></div><a class="sidebar-cta sidebar-link" href="${esc(dvf.explorer_url||"https://explore.data.gouv.fr/fr/immobilier")}" target="_blank" rel="noopener">Voir les ventes DVF ↗</a>`;
}

function renderSidebar(){
  const box=$("#dynamicSidebar");box.innerHTML=state.page==="laws"?legalSidebar():state.page==="market"?marketSidebar():state.page==="invest"?investSidebar():state.page==="territories"?territorySidebar():legalSidebar();
  const btn=box.querySelector("[data-sidebar-action]");if(btn)btn.onclick=()=>{const a=btn.dataset.sidebarAction;if(a==="laws")setPage("laws");if(a==="method"){$("#marketExplain").hidden=false;$("#marketExplain").scrollIntoView({behavior:"smooth"})}if(a==="sources")showSources()};
}
function story(i,idx){
  const s=score(i),fav=state.favorites.includes(i.id),fb=state.feedback[i.id],level=(i.source_level||"D").toLowerCase(),expanded=!!state.expandedStories[i.id];
  return `<article class="story level-${level} ${expanded?"expanded":""}" data-id="${esc(i.id)}"><div class="story-index">${String(idx+1).padStart(2,"0")}</div><div class="story-body">
    <div class="story-meta"><span class="kind">${esc(kind(i))}</span><span>·</span>${i.status?`<span class="status">${esc(i.status)}</span><span>·</span>`:""}<span>${esc(i.territory||"France")}</span><span>·</span><span>${esc(fmtDate(i.published_at))}</span></div>
    <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
    <p class="story-summary">${esc(i.summary)}</p>
    <div class="why-box"><strong>Pourquoi c’est important</strong><p>${esc(profileWhy(i))}</p></div>
    <button class="story-expand" data-action="expand">${expanded?"Réduire":"Lire plus"}</button>
    <div class="story-footer"><div class="source-info"><span class="source-check">✓</span><span><strong>${esc(i.source)}</strong><small>${esc(sourceReliability(i))}</small></span></div><div class="score"><span>Pertinence</span><strong>${s}</strong></div><a class="source-arrow" href="${esc(i.url)}" target="_blank" rel="noopener" aria-label="Ouvrir la source">↗</a></div>
    <div class="story-actions"><button data-action="fav" class="${fav?"active":""}">☆ Favori</button><button data-action="more" class="${fb==="more"?"active":""}">↑ Plus comme ça</button><button data-action="less" class="${fb==="less"?"active":""}">↓ Moins comme ça</button></div>
  </div></article>`;
}
function renderFeed(){
  const arr=filteredItems(), mobile=isMobile();
  $("#resultCount").textContent=`${arr.length} information${arr.length>1?"s":""} dans ce fil`;
  $("#freshnessHint").textContent=state.page==="today"?(state.freshness==="fresh"?"Priorité aux nouveautés des derniers jours":state.freshness==="week"?"Actualités de la semaine":"Contenus utiles, même plus anciens"):state.page==="territories"?`Local : ${territoryLabel()} · national : uniquement les signaux utiles`:"";

  const visible=mobile?arr.slice(0,state.mobileFeedLimit):arr;
  $("#feed").innerHTML=visible.map(story).join("");
  $("#emptyState").hidden=arr.length>0;

  const more=$("#feedMore");
  if(more){
    more.hidden=!mobile||arr.length<=visible.length;
    if(!more.hidden){
      const remain=arr.length-visible.length;
      more.textContent=`Afficher ${Math.min(5,remain)} information${Math.min(5,remain)>1?"s":""} supplémentaire${Math.min(5,remain)>1?"s":""} · ${remain} restante${remain>1?"s":""}`;
    }
  }

  $$(".story").forEach(card=>card.addEventListener("click",e=>{
    const b=e.target.closest("button[data-action]");if(!b)return;
    const id=card.dataset.id,a=b.dataset.action;
    if(a==="expand"){
      state.expandedStories[id]=!state.expandedStories[id];
      renderFeed();return;
    }
    if(a==="fav")state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];
    else state.feedback[id]=state.feedback[id]===a?null:a;
    savePrefs();renderFeed();
  }));
}
function archivePool(){
  const map=new Map();
  [...state.archiveItems,...state.items].forEach(i=>{
    const key=i.id||i.url||`${i.source}|${i.title}`;
    if(!map.has(key))map.set(key,i);
  });
  return [...map.values()];
}
function renderGlobalSearch(){
  const box=$("#searchGlobalResults");if(!box)return;
  const q=normalizeText($("#searchInput")?.value||"").trim();
  const cutoff=state.searchPeriod==="7"?7:state.searchPeriod==="30"?30:9999;
  let arr=archivePool().filter(i=>{
    if(cutoff!==9999&&ageDays(i.published_at)>cutoff)return false;
    if(!q)return true;
    const text=normalizeText([i.title,i.summary,i.why_it_matters,i.source,i.topic,i.territory,i.status].join(" "));
    return q.split(/\s+/).every(token=>text.includes(token));
  });
  arr.sort((a,b)=>(dateObj(b.published_at)?.getTime()||0)-(dateObj(a.published_at)?.getTime()||0));
  arr=arr.slice(0,30);
  if($("#searchArchiveStatus")){
    const total=archivePool().filter(i=>String(i.published_at||"").startsWith("2026")).length;
    $("#searchArchiveStatus").textContent=`${total} contenu${total>1?"s":""} 2026 indexé${total>1?"s":""} · archive progressive`;
  }
  box.innerHTML=arr.length?arr.map(i=>`<a class="search-result-card" href="${esc(i.url)}" target="_blank" rel="noopener">
    <div><span class="search-result-kind">${esc(kind(i))}</span><strong>${esc(i.title)}</strong><small>${esc(i.source)} · ${esc(fmtDate(i.published_at))}</small></div>
    <span>↗</span>
  </a>`).join(""):`<div class="search-no-result">Aucun résultat dans l’index actuel. L’archive 2026 est constituée progressivement.</div>`;
}
function feedbackText(){
  return [
    "Feedback Radar Immobilier — version bêta",
    `Profil testé : ${state.profile}`,
    `Territoire testé : ${territoryLabel()}`,
    `Cohérence des données : ${$("#feedbackCoherence")?.value||"À vérifier"}`,
    "",
    "Ce qui manque :",
    $("#feedbackMissing")?.value||"—",
    "",
    "Retour libre :",
    $("#feedbackFree")?.value||"—"
  ].join("\n");
}

function renderSystem(){
  const h=state.health||{},total=Number(h.sources_total||Object.keys(state.sourceStats||{}).length);
  const ok=Number(h.sources_ok||0),degraded=Number(h.sources_degraded||0),errors=Number(h.errors||0);
  const retained=Number(h.retained||state.items.length),rejected=Number(h.rejected||0);
  $("#systemHealthMini").textContent=total?`${ok}/${total} sources OK${degraded?` · ${degraded} dégradée${degraded>1?"s":""}`:""}`:"";
  $("#systemStats").innerHTML=`<div class="system-row"><span>Sources OK</span><strong class="ok">${ok}/${total||ok}</strong></div>
    <div class="system-row"><span>Sources dégradées</span><strong class="${degraded?"warn":"ok"}">${degraded}</strong></div>
    <div class="system-row"><span>Informations retenues</span><strong>${retained}</strong></div>
    <div class="system-row"><span>Rejetées par les filtres</span><strong>${rejected}</strong></div>
    <div class="system-row"><span>Erreurs sans repli</span><strong class="${errors?"warn":"ok"}">${errors}</strong></div>`;
  const entries=Object.entries(h.by_source||{});
  $("#sourceHealthTable").innerHTML=entries.length?entries.map(([name,v])=>{
    const status=v.status||((v.ok===false)?"error":"ok");
    const label=status==="degraded"?"Dégradée":status==="empty"?"OK · aucun contenu pertinent":status==="error"?"Erreur":"OK";
    const cls=status==="error"?"warn":status==="degraded"?"degraded":status==="empty"?"empty":"ok";
    const detail=v.error_type?` · ${v.error_type}`:v.fallback?" · cache conservé":"";
    return `<div class="source-row-health"><strong>${esc(name)}</strong><span>${esc(v.level||"")}</span><b class="${cls}">${esc(label)}</b><span>${Number(v.retained||0)} retenue(s)${esc(detail)}</span></div>`;
  }).join(""):`<div class="source-row-health"><strong>Sources actives</strong><span>${Object.keys(state.sourceStats||{}).length}</span><b class="ok">OK</b><span>${state.items.length} infos</span></div>`;
}
function showSources(){$("#sourcesPanel").hidden=false;$("#sourcesPanel").scrollIntoView({behavior:"smooth"})}
function setPage(p){state.page=p;state.filter=p==="laws"?"lois":p==="market"?"all":p==="invest"?"investir":"all";resetMobileFeed();if(p==="territories")state.territoryFilter="overview";$$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===p));$$(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===state.filter));$(".main-nav")?.classList.remove("mobile-open");$("#mobileMenuBtn")?.setAttribute("aria-expanded","false");renderPage();if(p==="territories"&&territoryCurrent()?.code&&!state.territoryLocal&&!state.territoryLocalLoading){state.territoryRequestId+=1;loadTerritoryLocalData(territoryCurrent(),{requestId:state.territoryRequestId});}if(p!=="today")$("#pageIntro").scrollIntoView({behavior:"smooth",block:"start"})}
function bind(){
  $$(".profile-switch button").forEach(b=>{b.classList.toggle("active",b.dataset.profile===state.profile);b.onclick=()=>{state.profile=b.dataset.profile;resetMobileFeed();localStorage.setItem("radarProfile",state.profile);$$(".profile-switch button").forEach(x=>x.classList.toggle("active",x===b));renderProfileContext();renderMarket();renderPage()}});
  $$(".nav-btn").forEach(b=>b.onclick=()=>setPage(b.dataset.page));
  if($("#mobileMenuBtn"))$("#mobileMenuBtn").onclick=()=>{
    const nav=$(".main-nav"),open=!nav.classList.contains("mobile-open");
    nav.classList.toggle("mobile-open",open);
    $("#mobileMenuBtn").setAttribute("aria-expanded",String(open));
  };
  if($("#feedMore"))$("#feedMore").onclick=()=>{state.mobileFeedLimit+=5;renderFeed();};
  $$(".filter-btn").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;resetMobileFeed();$$(".filter-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $$(".fresh-btn").forEach(b=>b.onclick=()=>{state.freshness=b.dataset.freshness;resetMobileFeed();$$(".fresh-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $("#sortSelect").onchange=e=>{state.sort=e.target.value;resetMobileFeed();renderFeed()};$("#officialOnly").onchange=e=>{state.officialOnly=e.target.checked;resetMobileFeed();renderFeed()};$("#favoritesOnly").onchange=e=>{state.favoritesOnly=e.target.checked;resetMobileFeed();renderFeed()};
  $("#searchOpen").onclick=()=>{$("#searchPanel").hidden=false;$("#searchInput").focus();renderGlobalSearch()};$("#searchClose").onclick=()=>{$("#searchPanel").hidden=true};$("#searchInput").oninput=()=>renderGlobalSearch();
  $$(".search-period").forEach(b=>b.onclick=()=>{state.searchPeriod=b.dataset.searchPeriod;$$(".search-period").forEach(x=>x.classList.toggle("active",x===b));renderGlobalSearch()});
  $$(".territory-filter-btn").forEach(b=>b.onclick=()=>{state.territoryFilter=b.dataset.territoryFilter;resetMobileFeed();renderTerritoryFeedControls();renderFeed()});
  if($("#territoryOfficialOnly"))$("#territoryOfficialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};
  if($("#territorySearchInput"))$("#territorySearchInput").oninput=e=>{clearTimeout(state.territorySearchTimer);const q=e.target.value;state.territorySearchTimer=setTimeout(async()=>{try{const results=await searchTerritories(q);renderTerritorySearchResults(results)}catch(err){console.error(err)}},250)};
  if($("#territorySearchClear"))$("#territorySearchClear").onclick=()=>{$("#territorySearchInput").value="";$("#territorySearchResults").hidden=true};
  $$('[data-territory-code]').forEach(b=>b.onclick=async()=>{try{const t=await fetchTerritoryByCode(b.dataset.territoryCode);await selectTerritory(t)}catch(e){console.error(e)}});
  $("#marketExplainBtn").onclick=()=>{$("#marketExplain").hidden=false};$("#marketExplainClose").onclick=()=>{$("#marketExplain").hidden=true};
  $("#sourcesDetailsBtn").onclick=showSources;$("#sourcesOpen").onclick=showSources;$("#footerSources").onclick=showSources;$("#footerMethod").onclick=()=>{$("#marketExplain").hidden=false;$("#marketExplain").scrollIntoView({behavior:"smooth"})};$("#sourcesClose").onclick=()=>{$("#sourcesPanel").hidden=true};
  $("#territoryJump").onclick=()=>setPage("territories");
  if($("#feedbackOpen"))$("#feedbackOpen").onclick=()=>{$("#feedbackPanel").hidden=false};
  if($("#feedbackFab"))$("#feedbackFab").onclick=()=>{$("#feedbackPanel").hidden=false};
  if($("#feedbackClose"))$("#feedbackClose").onclick=()=>{$("#feedbackPanel").hidden=true};
  if($("#feedbackCopy"))$("#feedbackCopy").onclick=async()=>{
    const txt=feedbackText();
    try{await navigator.clipboard.writeText(txt);$("#feedbackCopied").textContent="Retour copié ✓";}
    catch{$("#feedbackCopied").textContent="Copie automatique indisponible — sélectionnez le texte manuellement."}
  };
}
async function load(){
  bind();
  window.addEventListener("resize",()=>{
    if(!isMobile()){$(".main-nav")?.classList.remove("mobile-open");$("#mobileMenuBtn")?.setAttribute("aria-expanded","false")}
    renderFeed();
  });
  try{
    const [f,m,a]=await Promise.all([
      fetch("./data/feed.json",{cache:"no-store"}),
      fetch("./data/market.json",{cache:"no-store"}),
      fetch("./data/archive/2026.json",{cache:"no-store"}).catch(()=>null)
    ]);
    const feed=await f.json();
    state.items=feed.items||[];
    state.sourceStats=feed.source_stats||{};
    state.health=feed.health||{};
    state.market=await m.json();
    if(a&&a.ok){try{const ar=await a.json();state.archiveItems=ar.items||[]}catch{state.archiveItems=[]}}
    $("#lastUpdate").textContent=fmtUpdate(feed.generated_at);
    try{if(state.territoryData?.code)state.territoryData=await fetchTerritoryByCode(state.territoryData.code)}catch(e){console.warn("Territory hydrate",e)}
    if(state.territoryData?.code){const cached=readLocalCache(state.territoryData.code);if(cached)state.territoryLocal=cached;}
    renderProfileContext();renderMarket();renderSystem();renderPage();renderGlobalSearch();
  }catch(e){
    console.error(e);$("#lastUpdate").textContent="ERREUR DE CHARGEMENT";
  }
}
load();
