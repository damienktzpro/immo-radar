
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
const TERRITORY_PRESETS={
  paris11:{
    label:"Paris 11e",
    summary:"Marché très liquide, loyers sous tension et parc ancien à arbitrer avec attention sur le DPE.",
    focus:"Profil urbain dense : lecture utile pour arbitrer achat, location et niveau de négociation.",
    metrics:[
      ["Prix ancien", "10 420 €/m²", "ordre de grandeur local"],
      ["Loyer médian", "31 €/m²", "marché locatif tendu"],
      ["DPE à surveiller", "E à G", "enjeu travaux / rénovation"],
      ["Permis récents", "Modérés", "offre neuve limitée"]
    ],
    sources:["DVF", "Observatoires des loyers", "ADEME DPE", "Géorisques", "Sit@del"]
  },
  lyon2:{
    label:"Lyon 2e",
    summary:"Centre premium, marché recherché avec vacance faible et arbitrage fin entre rendement et prix d'entrée.",
    focus:"Bon terrain pour une lecture investisseur : prix élevés mais tension locative soutenue.",
    metrics:[
      ["Prix ancien", "6 780 €/m²", "central et recherché"],
      ["Loyer médian", "19 €/m²", "pression locative solide"],
      ["DPE à surveiller", "D à F", "travaux ciblés"],
      ["Permis récents", "Limités", "offre contenue"]
    ],
    sources:["DVF", "ANIL", "ADEME DPE", "Géorisques", "INSEE"]
  },
  bordeaux:{
    label:"Bordeaux",
    summary:"Reprise plus sélective : le marché se stabilise, mais le financement et l'emplacement font encore l'écart.",
    focus:"Lecture équilibrée entre prix, loyers et capacité d’absorption du marché local.",
    metrics:[
      ["Prix ancien", "4 710 €/m²", "stabilisation récente"],
      ["Loyer médian", "15 €/m²", "niveau soutenu"],
      ["DPE à surveiller", "D à G", "parc hétérogène"],
      ["Permis récents", "En retrait", "vigilance sur l’offre"]
    ],
    sources:["DVF", "Observatoires des loyers", "ADEME DPE", "Géorisques", "Sit@del"]
  },
  nantes:{
    label:"Nantes",
    summary:"Marché plus accessible, toujours actif, avec une tension locative structurelle dans plusieurs quartiers.",
    focus:"Pertinent pour comparer rendement brut, qualité énergétique et niveau réel de concurrence locative.",
    metrics:[
      ["Prix ancien", "3 980 €/m²", "marché encore actif"],
      ["Loyer médian", "14 €/m²", "tension persistante"],
      ["DPE à surveiller", "D à F", "travaux à anticiper"],
      ["Permis récents", "En baisse", "soutien à la tension"]
    ],
    sources:["DVF", "ANIL", "ADEME DPE", "Géorisques", "INSEE"]
  }
};
state.territory=localStorage.getItem("radarTerritory")||"paris11";
function territoryCurrent(){return TERRITORY_PRESETS[state.territory]||Object.values(TERRITORY_PRESETS)[0]}

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
  if(state.page==="territories")return i.category==="territoires";
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
    territories:{eyebrow:"Territoires",title:"Comprendre un marché local",desc:"Une lecture territoriale pour comparer une commune sous plusieurs angles : prix, loyers, énergie, risques et urbanisme."}
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
  renderLegalDashboard();renderInvestDashboard();renderTerritoryDashboard();renderSidebar();renderFeed();
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

function renderTerritoryDashboard(){
  if(state.page!=="territories")return;
  const entries=Object.entries(TERRITORY_PRESETS);
  const current=territoryCurrent();
  $("#territorySwitches").innerHTML=entries.map(([key,t])=>`<button class="territory-chip ${key===state.territory?"active":""}" data-territory="${key}">${esc(t.label)}</button>`).join("");
  $("#territoryName").textContent=current.label;
  $("#territorySummary").textContent=current.summary;
  $("#territoryMetrics").innerHTML=current.metrics.map(m=>`<article class="territory-metric"><small>${esc(m[0])}</small><strong>${esc(m[1])}</strong><span>${esc(m[2])}</span></article>`).join("");
  $("#territorySources").innerHTML=`<p class="territory-focus-copy">${esc(current.focus)}</p><div class="territory-source-chips">${current.sources.map(s=>`<span>${esc(s)}</span>`).join("")}</div>`;
  $$(".territory-chip").forEach(b=>b.onclick=()=>{state.territory=b.dataset.territory;localStorage.setItem("radarTerritory",state.territory);renderTerritoryDashboard();renderSidebar()});
  $("#territoryFocusBtn").onclick=()=>window.alert(`La vue locale détaillée de ${current.label} sera la prochaine grande brique du Radar.`);
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
  const t=territoryCurrent();
  return `<span class="overline">Radar local</span><h2>${esc(t.label)}</h2><p>${esc(t.focus)}</p><div class="sidebar-metric"><span>Transactions</span><strong>${esc(t.metrics[0][1])}</strong></div><div class="sidebar-metric"><span>Loyer</span><strong>${esc(t.metrics[1][1])}</strong></div><div class="sidebar-metric"><span>DPE</span><strong>${esc(t.metrics[2][1])}</strong></div><div class="sidebar-metric"><span>Sources</span><strong>${t.sources.length}</strong></div><button class="sidebar-cta" data-sidebar-action="sources">Voir les sources locales →</button>`;
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
  $("#freshnessHint").textContent=state.page==="today"?(state.freshness==="fresh"?"Priorité aux nouveautés des derniers jours":state.freshness==="week"?"Actualités de la semaine":"Contenus utiles, même plus anciens"):"";
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
function setPage(p){state.page=p;state.filter=p==="laws"?"lois":p==="market"?"all":p==="invest"?"investir":p==="territories"?"all":"all";$$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===p));$$(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===state.filter));renderPage();if(p!=="today")$("#pageIntro").scrollIntoView({behavior:"smooth",block:"start"})}
function bind(){
  $$(".profile-switch button").forEach(b=>{b.classList.toggle("active",b.dataset.profile===state.profile);b.onclick=()=>{state.profile=b.dataset.profile;localStorage.setItem("radarProfile",state.profile);$$(".profile-switch button").forEach(x=>x.classList.toggle("active",x===b));renderProfileContext();renderMarket();renderPage()}});
  $$(".nav-btn").forEach(b=>b.onclick=()=>setPage(b.dataset.page));
  $$(".filter-btn").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$$(".filter-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $$(".fresh-btn").forEach(b=>b.onclick=()=>{state.freshness=b.dataset.freshness;$$(".fresh-btn").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $("#sortSelect").onchange=e=>{state.sort=e.target.value;renderFeed()};$("#officialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};$("#favoritesOnly").onchange=e=>{state.favoritesOnly=e.target.checked;renderFeed()};
  $("#searchOpen").onclick=()=>{$("#searchPanel").hidden=false;$("#searchInput").focus()};$("#searchClose").onclick=()=>{$("#searchPanel").hidden=true};$("#searchInput").oninput=e=>{state.query=e.target.value;renderFeed()};
  $("#marketExplainBtn").onclick=()=>{$("#marketExplain").hidden=false};$("#marketExplainClose").onclick=()=>{$("#marketExplain").hidden=true};
  $("#sourcesDetailsBtn").onclick=showSources;$("#sourcesOpen").onclick=showSources;$("#footerSources").onclick=showSources;$("#footerMethod").onclick=()=>{$("#marketExplain").hidden=false;$("#marketExplain").scrollIntoView({behavior:"smooth"})};$("#sourcesClose").onclick=()=>{$("#sourcesPanel").hidden=true};
  $("#territoryJump").onclick=()=>setPage("territories");
}
async function load(){
  bind();
  try{
    const [f,m]=await Promise.all([fetch("./data/feed.json",{cache:"no-store"}),fetch("./data/market.json",{cache:"no-store"})]);const feed=await f.json();state.items=feed.items||[];state.sourceStats=feed.source_stats||{};state.health=feed.health||{};state.market=await m.json();$("#lastUpdate").textContent=fmtUpdate(feed.generated_at);renderProfileContext();renderMarket();renderSystem();renderPage();
  }catch(e){console.error(e);$("#lastUpdate").textContent="ERREUR DE CHARGEMENT";}
}
load();
