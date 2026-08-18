
const state={
  page:"today", profile:localStorage.getItem("radarProfile")||"particulier",
  filter:"all", freshness:"fresh", sort:"pertinence",
  officialOnly:false,favoritesOnly:false,query:"",
  items:[],market:null,health:{},sourceStats:{},
  favorites:JSON.parse(localStorage.getItem("radarFavorites")||"[]"),
  feedback:JSON.parse(localStorage.getItem("radarFeedback")||"{}")
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
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
  state.territoryData=t;
  state.territoryLocal=null;
  localStorage.setItem("radarTerritoryData",JSON.stringify(t));
  state.territoryFilter="overview";
  renderTerritoryDashboard();renderTerritoryFeedControls();renderSidebar();renderFeed();
  await loadTerritoryLocalData(t);
}


const LOCAL_CACHE_TTL=24*60*60*1000;
const ADEME_DPE_AGG="https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg";
const GEORISQUES_API="https://georisques.gouv.fr/api/v1/resultats_rapport_risque";

function localCacheKey(code){return `radarLocalData:${code}`}
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
async function loadTerritoryLocalData(t,{force=false}={}){
  if(!t?.code)return;
  state.territoryLocalLoading=true;
  if(state.page==="territories"){renderTerritoryDashboard();renderSidebar()}
  if(!force){
    const cached=readLocalCache(t.code);
    if(cached){
      state.territoryLocal=cached;
      state.territoryLocalLoading=false;
      if(state.page==="territories"){renderTerritoryDashboard();renderSidebar()}
      return cached;
    }
  }

  let data=await fetchStaticLocal(t.code)||{
    version:"5.1",code_insee:t.code,connections:{geo:"connected",dpe:"pending",risks:"pending",dvf:"pending",rents:"pending"}
  };

  const jobs=[];
  if(!data.dpe||["pending","error"].includes(data.dpe.status)){
    jobs.push(fetchDpeLive(t.code).then(v=>{data=mergeLocalData(data,{dpe:v,connections:{dpe:v.status}})}).catch(()=>{}));
  }
  if(!data.risks||["pending","error"].includes(data.risks.status)){
    jobs.push(fetchGeorisquesLive(t).then(v=>{data=mergeLocalData(data,{risks:v,connections:{risks:v.status}})}).catch(()=>{}));
  }
  await Promise.allSettled(jobs);

  state.territoryLocal=data;
  state.territoryLocalLoading=false;
  writeLocalCache(t.code,data);
  if(state.page==="territories"){renderTerritoryDashboard();renderSidebar()}
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
    return i.territory==="France"&&["lois","marche","credit","investir"].includes(i.category);
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
  return arr;
}
function renderMarket(){
  const m=state.market;if(!m)return;
  const s=Number(m.temperature?.score||0);
  $("#marketScore").textContent=s;$("#marketStatus").textContent=(m.temperature?.status||m.temperature?.label||"MARCHÉ").toUpperCase();$("#marketHeadline").textContent=m.temperature?.headline||m.temperature?.label||"";$("#marketComment").textContent=m.temperature?.comment||"";
  $("#marketGauge").style.background=`conic-gradient(var(--coral) 0deg ${s*3.6}deg,#deded7 ${s*3.6}deg 360deg)`;
  $("#marketPeriod").textContent=m.period_label||"DERNIÈRES DONNÉES";
  $("#marketTrendMini").innerHTML=(m.history||[45,47,49,50,48]).map((v,idx,arr)=>`<i style="height:${Math.max(6,v/2.2)}px" title="${v}/100"></i>`).join("");
  $("#balanceLabel").textContent=m.balance?.label||"";$("#balanceComment").textContent=m.balance?.comment||"";const bs=Math.max(0,Math.min(100,m.balance?.score||50));$("#balanceFill").style.width=`${bs}%`;$("#balanceDot").style.left=`${bs}%`;
  $("#financeLabel").textContent=m.financing?.label||"";$("#financeComment").textContent=m.financing?.comment||"";$("#financeBars").innerHTML=(m.financing?.bars||[35,39,41,48,45,51,47,44,40,39,36,37]).map(v=>`<i style="height:${v}px"></i>`).join("");
  $("#marketKeyFigures").innerHTML=(m.key_figures||[]).slice(0,3).map(k=>`<div class="key-figure ${k.negative?"negative":""}"><small>${esc(k.label)}</small><strong>${esc(k.value)}</strong></div>`).join("");
  $("#marketComponents").innerHTML=(m.components||[]).map(c=>`<div class="component"><small>${esc(c.label)}</small><strong>${esc(c.value)}</strong><span>${esc(c.source)} · ${esc(c.period||"")}</span><span class="trend">${esc(c.trend||"→")}</span></div>`).join("");
  $("#marketConfidence").textContent=`${m.confidence||0}/100`;
  renderProfileContext();
  $("#pulseGrid").innerHTML=(m.pulse||[]).slice(0,3).map((p,idx)=>`<article class="pulse-card"><span class="pulse-index">0${idx+1}</span><span class="label">${esc(p.label)}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>${p.url?`<a href="${esc(p.url)}" target="_blank" rel="noopener">Voir la source ↗</a>`:""}</article>`).join("");
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
  const identity=[
    ["Code INSEE",t.code||"—"],
    ["Population",formatPopulation(t.population)],
    ["Code postal",(t.codesPostaux||[]).join(" · ")||"—"],
    ["Département",t.departement?.nom||t.codeDepartement||"—"],
    ["Région",t.region?.nom||t.codeRegion||"—"]
  ];
  $("#territoryIdentityMetrics").innerHTML=identity.map(m=>`<div class="territory-identity-metric"><small>${esc(m[0])}</small><strong>${esc(m[1])}</strong></div>`).join("");
  const local=state.territoryLocal||{};
  const dpe=local.dpe||{};
  const risks=local.risks||{};
  const loading=state.territoryLocalLoading;
  const dpeStatus=loading&&!dpe.status?"Chargement…":dpe.status==="connected"?(dpe.passoires_pct!=null?`F–G : ${String(dpe.passoires_pct).replace(".",",")} %`:`${dpe.total||0} DPE`):dpe.status==="no_data"?"Aucun DPE":"En connexion";
  const dpeNote=dpe.status==="connected"?`${new Intl.NumberFormat("fr-FR").format(dpe.total||0)} DPE observés · classe dominante ${dpe.dominant_label||"—"}`:"";
  const riskStatus=loading&&!risks.status?"Chargement…":risks.status==="connected"?"Rapport connecté":"Rapport disponible";
  const riskNote=risks.status==="connected"&&Number.isFinite(Number(risks.present_count))?`${risks.present_count} signal${Number(risks.present_count)>1?"aux":""} identifié${Number(risks.present_count)>1?"s":""}`:"";
  $("#territoryMarketMetrics").innerHTML=[
    territoryMarketMetric("Prix ancien","DVF / data.gouv.fr","https://explore.data.gouv.fr/fr/immobilier","En connexion","Branchement DVF prévu en prochaine étape"),
    territoryMarketMetric("Loyer médian","Observatoires des loyers","https://www.observatoires-des-loyers.org/","En connexion","Couverture variable selon le territoire"),
    territoryMarketMetric("Transactions","DVF / data.gouv.fr","https://explore.data.gouv.fr/fr/immobilier","En connexion","Branchement DVF prévu en prochaine étape"),
    territoryMarketMetric("DPE","ADEME","https://data.ademe.fr/datasets/dpe03existant",dpeStatus,dpeNote,dpe.status==="connected"?"is-connected":""),
    territoryMarketMetric("Risques","Géorisques",risks.report_url||geoRiskUrl(t),riskStatus,riskNote,risks.status==="connected"?"is-connected":"")
  ].join("");
  $("#territoryReadingTitle").textContent=state.profile==="investisseur"?"Décider localement, sans confondre rendement et marché.":state.profile==="pro"?"Lire le territoire comme un marché d’activité.":"Situer votre projet dans son vrai marché.";
  $("#territoryReadingText").textContent=state.profile==="investisseur"?"Le Radar priorise ici les loyers, le financement, la réglementation bailleur et les informations réellement liées au territoire sélectionné.":state.profile==="pro"?"Le Radar remonte en priorité les signaux locaux, la réglementation, la construction et les données susceptibles d’affecter les volumes et la demande.":"Le Radar met en avant les prix, le crédit, le DPE, les risques et les règles qui peuvent modifier une décision d’achat, de vente ou de location.";
  const statuses=[
    ["API Découpage administratif","connected","https://geo.api.gouv.fr/decoupage-administratif/communes"],
    ["DVF",local.connections?.dvf||"pending","https://explore.data.gouv.fr/fr/immobilier"],
    ["Observatoires des loyers",local.connections?.rents||"pending","https://www.observatoires-des-loyers.org/"],
    ["ADEME DPE",loading&&!dpe.status?"loading":(dpe.status||local.connections?.dpe||"pending"),"https://data.ademe.fr/datasets/dpe03existant"],
    ["Géorisques",loading&&!risks.status?"loading":(risks.status||local.connections?.risks||"pending"),risks.report_url||geoRiskUrl(t)]
  ];
  $("#territorySourceStatus").innerHTML=`<div class="territory-source-status-head"><span class="eyebrow">Sources locales</span><p>ADEME et Géorisques sont maintenant interrogés réellement. DVF et loyers restent explicitement en attente.</p></div><div class="territory-source-status-grid">${statuses.map(s=>`<a href="${esc(s[2])}" target="_blank" rel="noopener"><span>${esc(s[0])}</span><strong class="${connectionClass(s[1])}">${esc(connectionLabel(s[1]))}</strong></a>`).join("")}</div>`;
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
  const t=territoryCurrent(),local=state.territoryLocal||{},dpe=local.dpe||{},risks=local.risks||{};
  const dpeText=dpe.status==="connected"&&dpe.passoires_pct!=null?`F–G ${String(dpe.passoires_pct).replace(".",",")} %`:connectionLabel(dpe.status||"pending");
  const riskText=risks.status==="connected"?"Connectés":connectionLabel(risks.status||"pending");
  return `<span class="overline">Radar local</span><h2>${esc(territoryLabel(t))}</h2><p>${esc([t.departement?.nom,t.region?.nom].filter(Boolean).join(" · ")||"France")}</p><div class="sidebar-metric"><span>Code INSEE</span><strong>${esc(t.code||"—")}</strong></div><div class="sidebar-metric"><span>Population</span><strong>${esc(formatPopulation(t.population))}</strong></div><div class="sidebar-metric"><span>DPE ADEME</span><strong>${esc(dpeText)}</strong></div><div class="sidebar-metric"><span>Géorisques</span><strong>${esc(riskText)}</strong></div><a class="sidebar-cta sidebar-link" href="${esc(risks.report_url||geoRiskUrl(t))}" target="_blank" rel="noopener">Ouvrir Géorisques ↗</a>`;
}

function renderSidebar(){
  const box=$("#dynamicSidebar");box.innerHTML=state.page==="laws"?legalSidebar():state.page==="market"?marketSidebar():state.page==="invest"?investSidebar():state.page==="territories"?territorySidebar():legalSidebar();
  const btn=box.querySelector("[data-sidebar-action]");if(btn)btn.onclick=()=>{const a=btn.dataset.sidebarAction;if(a==="laws")setPage("laws");if(a==="method"){$("#marketExplain").hidden=false;$("#marketExplain").scrollIntoView({behavior:"smooth"})}if(a==="sources")showSources()};
}
function story(i,idx){
  const s=score(i),fav=state.favorites.includes(i.id),fb=state.feedback[i.id],level=(i.source_level||"D").toLowerCase();
  return `<article class="story level-${level}" data-id="${esc(i.id)}"><div class="story-index">${String(idx+1).padStart(2,"0")}</div><div class="story-body">
    <div class="story-meta"><span class="kind">${esc(kind(i))}</span><span>·</span>${i.status?`<span class="status">${esc(i.status)}</span><span>·</span>`:""}<span>${esc(i.territory||"France")}</span><span>·</span><span>${esc(fmtDate(i.published_at))}</span></div>
    <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
    <p class="story-summary">${esc(i.summary)}</p>
    <div class="why-box"><strong>Pourquoi c’est important</strong><p>${esc(profileWhy(i))}</p></div>
    <div class="story-footer"><div class="source-info"><span class="source-check">✓</span><span><strong>${esc(i.source)}</strong><small>${esc(sourceReliability(i))}</small></span></div><div class="score"><span>Pertinence</span><strong>${s}</strong></div><a class="source-arrow" href="${esc(i.url)}" target="_blank" rel="noopener" aria-label="Ouvrir la source">↗</a></div>
    <div class="story-actions"><button data-action="fav" class="${fav?"active":""}">☆ Favori</button><button data-action="more" class="${fb==="more"?"active":""}">↑ Plus comme ça</button><button data-action="less" class="${fb==="less"?"active":""}">↓ Moins comme ça</button></div>
  </div></article>`;
}
function renderFeed(){
  const arr=filteredItems();$("#resultCount").textContent=`${arr.length} information${arr.length>1?"s":""} dans ce fil`;
  $("#freshnessHint").textContent=state.page==="today"?(state.freshness==="fresh"?"Priorité aux nouveautés des derniers jours":state.freshness==="week"?"Actualités de la semaine":"Contenus utiles, même plus anciens"):state.page==="territories"?`Local : ${territoryLabel()} · national : uniquement les signaux utiles`:"";
  $("#feed").innerHTML=arr.map(story).join("");$("#emptyState").hidden=arr.length>0;
  $$(".story").forEach(card=>card.addEventListener("click",e=>{const b=e.target.closest("button[data-action]");if(!b)return;const id=card.dataset.id,a=b.dataset.action;if(a==="fav")state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];else state.feedback[id]=state.feedback[id]===a?null:a;savePrefs();renderFeed()}));
}
function renderSystem(){
  const h=state.health||{},success=Number(h.sources_ok||Object.keys(state.sourceStats||{}).length),total=Number(h.sources_total||success),errors=Number(h.errors||0),retained=Number(h.retained||state.items.length),rejected=Number(h.rejected||0);
  $("#systemHealthMini").textContent=total?`${success}/${total} sources actives`:"";
  $("#systemStats").innerHTML=`<div class="system-row"><span>Sources opérationnelles</span><strong class="${errors?"warn":"ok"}">${success}/${total||success}</strong></div><div class="system-row"><span>Informations retenues</span><strong>${retained}</strong></div><div class="system-row"><span>Rejetées par les filtres</span><strong>${rejected}</strong></div><div class="system-row"><span>Erreurs de collecte</span><strong class="${errors?"warn":"ok"}">${errors}</strong></div>`;
  const entries=Object.entries(h.by_source||{});$("#sourceHealthTable").innerHTML=entries.length?entries.map(([name,v])=>`<div class="source-row-health"><strong>${esc(name)}</strong><span>${esc(v.level||"")}</span><b class="${v.ok===false?"warn":"ok"}">${v.ok===false?"Erreur":"OK"}</b><span>${Number(v.retained||0)} retenue(s)</span></div>`).join(""):`<div class="source-row-health"><strong>Sources actives</strong><span>${Object.keys(state.sourceStats||{}).length}</span><b class="ok">OK</b><span>${state.items.length} infos</span></div>`;
}
function showSources(){$("#sourcesPanel").hidden=false;$("#sourcesPanel").scrollIntoView({behavior:"smooth"})}
function setPage(p){state.page=p;state.filter=p==="laws"?"lois":p==="market"?"all":p==="invest"?"investir":"all";if(p==="territories")state.territoryFilter="overview";$$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===p));$$(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===state.filter));renderPage();if(p==="territories"&&territoryCurrent()?.code&&!state.territoryLocal&&!state.territoryLocalLoading)loadTerritoryLocalData(territoryCurrent());if(p!=="today")$("#pageIntro").scrollIntoView({behavior:"smooth",block:"start"})}
function bind(){
  $$(".profile-switch button").forEach(b=>{b.classList.toggle("active",b.dataset.profile===state.profile);b.onclick=()=>{state.profile=b.dataset.profile;localStorage.setItem("radarProfile",state.profile);$$(".profile-switch button").forEach(x=>x.classList.toggle("active",x===b));renderProfileContext();renderMarket();renderPage()}});
  $$(".nav-btn").forEach(b=>b.onclick=()=>setPage(b.dataset.page));
  $$(".filter-btn").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$$(".filter-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $$(".fresh-btn").forEach(b=>b.onclick=()=>{state.freshness=b.dataset.freshness;$$(".fresh-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $("#sortSelect").onchange=e=>{state.sort=e.target.value;renderFeed()};$("#officialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};$("#favoritesOnly").onchange=e=>{state.favoritesOnly=e.target.checked;renderFeed()};
  $("#searchOpen").onclick=()=>{$("#searchPanel").hidden=false;$("#searchInput").focus()};$("#searchClose").onclick=()=>{$("#searchPanel").hidden=true};$("#searchInput").oninput=e=>{state.query=e.target.value;renderFeed()};
  $$(".territory-filter-btn").forEach(b=>b.onclick=()=>{state.territoryFilter=b.dataset.territoryFilter;renderTerritoryFeedControls();renderFeed()});
  if($("#territoryOfficialOnly"))$("#territoryOfficialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};
  if($("#territorySearchInput"))$("#territorySearchInput").oninput=e=>{clearTimeout(state.territorySearchTimer);const q=e.target.value;state.territorySearchTimer=setTimeout(async()=>{try{const results=await searchTerritories(q);renderTerritorySearchResults(results)}catch(err){console.error(err)}},250)};
  if($("#territorySearchClear"))$("#territorySearchClear").onclick=()=>{$("#territorySearchInput").value="";$("#territorySearchResults").hidden=true};
  $$('[data-territory-code]').forEach(b=>b.onclick=async()=>{try{const t=await fetchTerritoryByCode(b.dataset.territoryCode);await selectTerritory(t)}catch(e){console.error(e)}});
  $("#marketExplainBtn").onclick=()=>{$("#marketExplain").hidden=false};$("#marketExplainClose").onclick=()=>{$("#marketExplain").hidden=true};
  $("#sourcesDetailsBtn").onclick=showSources;$("#sourcesOpen").onclick=showSources;$("#footerSources").onclick=showSources;$("#footerMethod").onclick=()=>{$("#marketExplain").hidden=false;$("#marketExplain").scrollIntoView({behavior:"smooth"})};$("#sourcesClose").onclick=()=>{$("#sourcesPanel").hidden=true};
  $("#territoryJump").onclick=()=>setPage("territories");
}
async function load(){
  bind();
  try{
    const [f,m]=await Promise.all([fetch("./data/feed.json",{cache:"no-store"}),fetch("./data/market.json",{cache:"no-store"})]);const feed=await f.json();state.items=feed.items||[];state.sourceStats=feed.source_stats||{};state.health=feed.health||{};state.market=await m.json();$("#lastUpdate").textContent=fmtUpdate(feed.generated_at);try{if(state.territoryData?.code)state.territoryData=await fetchTerritoryByCode(state.territoryData.code)}catch(e){console.warn("Territory hydrate",e)}if(state.territoryData?.code){const cached=readLocalCache(state.territoryData.code);if(cached)state.territoryLocal=cached;}renderProfileContext();renderMarket();renderSystem();renderPage();
  }catch(e){console.error(e);$("#lastUpdate").textContent="ERREUR DE CHARGEMENT";}
}
load();
