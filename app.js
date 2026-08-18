
const state={
  profile:localStorage.getItem("radarProfile")||"particulier",
  category:"all",sort:"pertinence",officialOnly:false,favoritesOnly:false,query:"",
  items:[],market:null,sources:{},
  favorites:JSON.parse(localStorage.getItem("radarFavorites")||"[]"),
  feedback:JSON.parse(localStorage.getItem("radarFeedback")||"{}")
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const dt=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d};
function fmtDate(v){const d=dt(v);return d?new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(d).toUpperCase():"DATE NON DISPONIBLE"}
function fmtUpdate(v){const d=dt(v);return d?`VEILLE MISE À JOUR LE ${new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(d).toUpperCase()}`:"VEILLE MISE À JOUR"}
function profileScore(i){let n=Number(i.relevance||0);if((i.audiences||[]).includes(state.profile))n+=8;const f=state.feedback[i.id];if(f==="more")n+=6;if(f==="less")n-=10;return Math.max(0,Math.min(100,n))}
function savePrefs(){localStorage.setItem("radarFavorites",JSON.stringify(state.favorites));localStorage.setItem("radarFeedback",JSON.stringify(state.feedback))}
function legalLabel(i){if(i.territory==="Union européenne"){if(/directive/i.test(i.status||""))return"À TRANSPOSER · UNION EUROPÉENNE";if(/règlement|reglement/i.test(i.status||""))return"APPLICABLE · UNION EUROPÉENNE";return"UE · TEXTE OFFICIEL"}return ({depot:"DÉPOSÉ · FRANCE",discussion:"EN DISCUSSION · FRANCE",adopte:"ADOPTÉ · FRANCE",promulgue:"PROMULGUÉ · FRANCE",jorf:"PUBLIÉ AU JORF · FRANCE"}[i.legal_stage]||`${(i.status||"À SUIVRE").toUpperCase()} · FRANCE`)}
function kindLabel(i){if(i.source_level==="A"&&i.category==="marche")return"CHIFFRE OFFICIEL";if(i.category==="lois")return i.legal_stage?"NOUVELLE RÈGLE":"ACTUALITÉ JURIDIQUE";if(i.category==="credit")return"ALERTE CRÉDIT";if(i.category==="investir")return"INVESTISSEMENT";if(i.category==="territoires")return"DONNÉES LOCALES";if(i.source_level==="C")return"ANALYSE MÉDIA";if(i.source_level==="D")return"ANALYSE EXPERT";return"ACTUALITÉ IMMOBILIÈRE"}
function categoryMatch(i){
  if(state.category==="all")return true;
  if(state.category==="credit")return i.category==="credit"||/\bcrédit|taux immobilier|prêt immobilier/i.test([i.title,i.summary].join(" "));
  if(state.category==="pro")return (i.audiences||[]).includes("pro")&&(i.source_level==="C"||/agence|syndic|promoteur|proptech|professionnel/i.test([i.title,i.summary].join(" ")));
  return i.category===state.category
}
function filtered(){
  const q=state.query.trim().toLowerCase();
  let arr=state.items.filter(i=>{
    const profile=(i.audiences||[]).includes(state.profile)||(i.audiences||[]).includes("tous");
    const official=!state.officialOnly||i.source_level==="A";
    const fav=!state.favoritesOnly||state.favorites.includes(i.id);
    const text=[i.title,i.summary,i.why_it_matters,i.source,i.topic,i.territory].join(" ").toLowerCase();
    return profile&&official&&fav&&categoryMatch(i)&&(!q||text.includes(q));
  });
  arr.sort((a,b)=>state.sort==="recent"?(dt(b.published_at)?.getTime()||0)-(dt(a.published_at)?.getTime()||0):state.sort==="important"?Number(b.importance||0)-Number(a.importance||0):profileScore(b)-profileScore(a));
  return arr;
}
function renderMarket(){
  const m=state.market;if(!m)return;
  const score=Number(m.temperature?.score||0);
  $("#marketScore").textContent=score;$("#marketStatus").textContent=(m.temperature?.status||m.temperature?.label||"MARCHÉ").toUpperCase();
  $("#marketHeadline").textContent=m.temperature?.headline||m.temperature?.label||"";$("#marketComment").textContent=m.temperature?.comment||"";
  $("#scoreGauge").style.background=`conic-gradient(var(--coral) 0deg ${score*3.6}deg,#dfdfd8 ${score*3.6}deg 360deg)`;
  $("#marketPeriod").textContent=m.period_label||"DERNIÈRES DONNÉES";
  $("#balanceLabel").textContent=m.balance?.label||"";$("#balanceComment").textContent=m.balance?.comment||"";$("#balanceDot").style.left=`${Math.max(0,Math.min(100,m.balance?.score||50))}%`;
  $("#financeLabel").textContent=m.financing?.label||"";$("#financeComment").textContent=m.financing?.comment||"";
  $("#financeBars").innerHTML=(m.financing?.bars||[38,42,45,52,48,55,49,46,43,42,39,40]).map(v=>`<i style="height:${v}px"></i>`).join("");
  $("#marketConfidence").textContent=`${m.confidence||0}/100`;
  $("#marketKeyFigures").innerHTML=(m.key_figures||[]).slice(0,3).map(k=>`<div class="keyfigure ${k.negative?"negative":""}"><small>${esc(k.label)}</small><strong>${esc(k.value)}</strong></div>`).join("");
  $("#marketComponents").innerHTML=(m.components||[]).map(c=>`<div class="market-component"><small>${esc(c.label)}</small><strong>${esc(c.value)}</strong><span>${esc(c.source)} · ${esc(c.period||"")}</span></div>`).join("");
  $("#pulseGrid").innerHTML=(m.pulse||[]).slice(0,3).map((p,idx)=>`<article class="pulse-card"><span class="pulse-index">0${idx+1}</span><span class="label">${esc(p.label)}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></article>`).join("");
}
function sourceReliability(i){return i.source_level==="A"?"Officielle · Fiabilité 100/100":i.source_level==="B"?"Institutionnelle · Fiabilité 96/100":i.source_level==="C"?"Média spécialisé · Fiabilité 78/100":"Blog / expert · Fiabilité 68/100"}
function story(i,idx){
  const score=profileScore(i),fav=state.favorites.includes(i.id),fb=state.feedback[i.id],level=(i.source_level||"D").toLowerCase();
  const status=i.status?`<span class="status">${esc(i.status)}</span><span>·</span>`:"";
  return `<article class="story-card level-${level}" data-id="${esc(i.id)}">
    <div class="story-number">${String(idx+1).padStart(2,"0")}</div>
    <div class="story-body">
      <div class="story-meta"><span class="kind">${esc(kindLabel(i))}</span><span>·</span>${status}<span>${esc(i.territory||"France")}</span><span>·</span><span>${esc(fmtDate(i.published_at))}</span></div>
      <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <p>${esc(i.summary)}</p>
      <div class="why-box"><strong>Pourquoi c’est important</strong><p>${esc(i.why_it_matters||"Cette information a un impact immobilier concret à surveiller.")}</p></div>
      <div class="story-footer">
        <div class="source-info"><span class="source-check">✓</span><span><strong>${esc(i.source)}</strong><small>${esc(sourceReliability(i))}</small></span></div>
        <div class="story-score"><span>Pertinence</span><strong>${score}</strong></div>
        <a class="open-source" href="${esc(i.url)}" target="_blank" rel="noopener" title="Ouvrir la source">↗</a>
      </div>
      <div class="feedback-mini"><button data-action="fav" class="${fav?"active":""}">☆ Favori</button><button data-action="more" class="${fb==="more"?"active":""}">↑ Plus comme ça</button><button data-action="less" class="${fb==="less"?"active":""}">↓ Moins comme ça</button></div>
    </div>
  </article>`;
}
function renderLawRadar(){
  let laws=state.items.filter(i=>i.category==="lois"&&i.source_level==="A");
  laws.sort((a,b)=>(dt(b.published_at)?.getTime()||0)-(dt(a.published_at)?.getTime()||0));
  $("#lawTimeline").innerHTML=laws.slice(0,3).map((i,idx)=>`<article class="law-item ${idx===1?"orange":idx===2?"gold":""}">
    <small>${esc(legalLabel(i))}</small><h3>${esc(i.title)}</h3><p>${esc(i.summary)}</p><a href="${esc(i.url)}" target="_blank" rel="noopener">${/directive/i.test(i.status||"")?"Suivre le texte":i.legal_stage==="jorf"?"Voir le texte":"Voir la fiche"} ↗</a>
  </article>`).join("")||"<p>Aucun texte juridique récent détecté.</p>";
}
function renderSources(){
  const entries=Object.entries(state.sources||{}).sort((a,b)=>b[1]-a[1]);
  $("#activeSources").innerHTML=entries.map(([name,count])=>`<span><b>${esc(name)}</b> · ${count} info${count>1?"s":""}</span>`).join("");
}
function renderFeed(){
  const arr=filtered();$("#resultCount").textContent=`${arr.length} information${arr.length>1?"s":""} dans ce fil`;
  $("#feed").innerHTML=arr.map(story).join("");$("#emptyState").hidden=arr.length>0;
  $$(".story-card").forEach(card=>card.addEventListener("click",e=>{const btn=e.target.closest("button[data-action]");if(!btn)return;const id=card.dataset.id,a=btn.dataset.action;if(a==="fav"){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id]}else state.feedback[id]=state.feedback[id]===a?null:a;savePrefs();renderFeed()}));
}
function setCategory(c){
  state.category=c;$$(".feed-filter").forEach(b=>b.classList.toggle("active",b.dataset.category===c));$$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.nav===c||(c==="credit"&&b.dataset.nav==="marche")||(c==="pro"&&b.dataset.nav==="all")));
  renderFeed();if(c!=="all")document.querySelector("#feedSection").scrollIntoView({behavior:"smooth",block:"start"});
}
function bind(){
  $$(".profile-switch button").forEach(b=>{b.classList.toggle("active",b.dataset.profile===state.profile);b.onclick=()=>{state.profile=b.dataset.profile;localStorage.setItem("radarProfile",state.profile);$$(".profile-switch button").forEach(x=>x.classList.toggle("active",x===b));renderFeed()}});
  $$(".feed-filter").forEach(b=>b.onclick=()=>setCategory(b.dataset.category));$$(".nav-link").forEach(b=>b.onclick=()=>setCategory(b.dataset.nav));
  $("#sortSelect").onchange=e=>{state.sort=e.target.value;renderFeed()};$("#officialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};$("#favoritesOnly").onchange=e=>{state.favoritesOnly=e.target.checked;renderFeed()};
  $("#searchToggle").onclick=()=>{$("#globalSearch").hidden=false;$("#searchInput").focus()};$("#searchClose").onclick=()=>{$("#globalSearch").hidden=true};$("#searchInput").oninput=e=>{state.query=e.target.value;renderFeed()};
  $("#marketDetailsBtn").onclick=()=>{$("#marketDetails").hidden=!$("#marketDetails").hidden};$("#showAllLaws").onclick=()=>setCategory("lois");
  $$("[data-nav-target]").forEach(b=>b.onclick=()=>setCategory(b.dataset.navTarget));
}
async function load(){
  bind();
  try{
    const [f,m]=await Promise.all([fetch("./data/feed.json",{cache:"no-store"}),fetch("./data/market.json",{cache:"no-store"})]);
    const feed=await f.json();state.items=feed.items||[];state.sources=feed.source_stats||{};state.market=await m.json();
    $("#lastUpdate").textContent=fmtUpdate(feed.generated_at);renderMarket();renderLawRadar();renderSources();renderFeed();
  }catch(e){console.error(e);$("#lastUpdate").textContent="ERREUR DE CHARGEMENT";}
}
load();
