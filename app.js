const state = {
  profile: localStorage.getItem("immoRadarProfile") || "investisseur",
  category: "all", sort: "pertinence", officialOnly: false, favoritesOnly: false,
  query: "", items: [], market: null, watch: [],
  favorites: JSON.parse(localStorage.getItem("immoRadarFavorites") || "[]"),
  feedback: JSON.parse(localStorage.getItem("immoRadarFeedback") || "{}")
};
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
const esc = (v="") => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function dateFmt(iso){const d=new Date(iso);return Number.isNaN(d)?iso:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(d)}
function relative(iso){const d=new Date(iso);if(Number.isNaN(d))return"";const h=Math.round((Date.now()-d)/36e5);if(h<1)return"à l’instant";if(h<24)return`il y a ${h} h`;const j=Math.round(h/24);if(j<30)return`il y a ${j} j`;return dateFmt(iso)}
function updateStamp(iso){const d=new Date(iso);return `Mis à jour le ${new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d)}`}
function stageLabel(s){return {depot:"Déposé",discussion:"En discussion",adopte:"Adopté",promulgue:"Promulgué",jorf:"Publié / applicable",eu:"UE",clos:"Clos"}[s]||""}
function score(item){let n=Number(item.relevance||0);if((item.audiences||[]).includes(state.profile))n+=8;const fb=state.feedback[item.id];if(fb==="more")n+=7;if(fb==="less")n-=12;return Math.max(0,Math.min(100,n))}
function savePrefs(){localStorage.setItem("immoRadarFavorites",JSON.stringify(state.favorites));localStorage.setItem("immoRadarFeedback",JSON.stringify(state.feedback))}
function filtered(){
  const q=state.query.trim().toLowerCase();
  return state.items.filter(i=>{
    const profile=(i.audiences||[]).includes(state.profile)||(i.audiences||[]).includes("tous");
    const cat=state.category==="all"||i.category===state.category;
    const official=!state.officialOnly||i.source_level==="A";
    const fav=!state.favoritesOnly||state.favorites.includes(i.id);
    const text=[i.title,i.summary,i.why_it_matters,i.source,i.topic,i.territory].join(" ").toLowerCase();
    return profile&&cat&&official&&fav&&(!q||text.includes(q));
  }).sort((a,b)=>state.sort==="recent"?new Date(b.published_at)-new Date(a.published_at):state.sort==="important"?Number(b.importance||0)-Number(a.importance||0):score(b)-score(a));
}
function sourceClass(l){return ["A","B","C","D"].includes(l)?l.toLowerCase():"d"}
function renderWatch(){
  $("#watchCount").textContent=state.watch.length;
  $("#watchList").innerHTML=state.watch.slice(0,6).map(w=>`<article class="watch-card"><small>${esc(w.date_label||dateFmt(w.date))}</small><strong>${esc(w.title)}</strong><span>${esc(w.source||"")}</span></article>`).join("");
  $(".watch-section").hidden=state.watch.length===0;
}
function renderMarket(){
  const m=state.market;if(!m)return;
  $("#marketScore").textContent=`${m.temperature.score}/100`;$("#marketLabel").textContent=m.temperature.label;$("#marketBar").style.width=`${m.temperature.score}%`;$("#marketComment").textContent=m.temperature.comment;
  $("#balanceLabel").textContent=m.balance.label;$("#balanceDot").style.left=`${m.balance.score}%`;$("#balanceComment").textContent=m.balance.comment;
  $("#financeLabel").textContent=m.financing.label;$("#financeDot").style.left=`${m.financing.score}%`;$("#financeComment").textContent=m.financing.comment;
  $("#marketConfidence").textContent=`${m.confidence||0}/100`;
  $("#marketComponents").innerHTML=(m.components||[]).map(c=>`<article class="market-component"><small>${esc(c.label)}</small><strong>${esc(c.value)}</strong><span>${esc(c.source)} · ${esc(c.period||"")}</span></article>`).join("");
}
function renderLegal(){
  const box=$("#legalRadar");box.hidden=state.category!=="lois";if(box.hidden)return;
  const c={depot:0,discussion:0,adopte:0,promulgue:0,jorf:0};state.items.forEach(i=>{if(i.category==="lois"&&c[i.legal_stage]!==undefined)c[i.legal_stage]++});
  $("#legalCountDepot").textContent=c.depot;$("#legalCountDiscussion").textContent=c.discussion;$("#legalCountAdopte").textContent=c.adopte;$("#legalCountPromulgue").textContent=c.promulgue;$("#legalCountJorf").textContent=c.jorf;
}
function card(item){
  const s=score(item), fav=state.favorites.includes(item.id), fb=state.feedback[item.id], level=esc(item.source_level||"D");
  const proof=item.source_level==="A"?"Source officielle":item.source_level==="B"?"Source institutionnelle":item.source_level==="C"?"Média immobilier sélectionné":"Blog / expert sélectionné";
  const confirmation=item.confirmation|| (item.source_level==="A"?"Source primaire ou officielle.":"Information à lire avec le niveau de preuve indiqué.");
  return `<article class="feed-card" data-id="${esc(item.id)}">
    <div class="card-top"><div class="source-row"><span class="level ${sourceClass(level)}">${level}</span><span class="source-name">${esc(item.source)}</span><span class="relative-time">${esc(relative(item.published_at))}</span></div><div class="score-badge">${s}/100</div></div>
    <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
    <div class="meta">${item.topic?`<span class="tag">${esc(item.topic)}</span>`:""}${item.territory?`<span class="tag">${esc(item.territory)}</span>`:""}${item.legal_stage?`<span class="tag stage">${esc(stageLabel(item.legal_stage))}</span>`:""}${item.status?`<span class="tag status">${esc(item.status)}</span>`:""}</div>
    <div class="insight-box"><small>En bref</small><p>${esc(item.summary)}</p></div>
    <div class="insight-box why"><small>Pourquoi ça compte</small><p>${esc(item.why_it_matters||"Cette information peut avoir un impact immobilier concret.")}</p></div>
    <div class="proof-box"><div class="proof-icon">✓</div><div><strong>${esc(proof)}</strong><span>${esc(confirmation)}</span><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.source)} ↗</a></div></div>
    <div class="details-row"><details><summary>Comprendre le score</summary><p>Fiabilité, fraîcheur, impact, correspondance avec votre profil et importance du sujet.</p></details>${item.original_excerpt?`<details><summary>Voir l’extrait original</summary><p>${esc(item.original_excerpt)}</p></details>`:""}</div>
    <div class="card-actions"><div class="feedback-actions"><button class="small-action fav ${fav?"active":""}" data-action="fav">☆ Favori</button><button class="small-action ${fb==="more"?"active":""}" data-action="more">↑ Plus comme ça</button><button class="small-action ${fb==="less"?"active":""}" data-action="less">↓ Moins comme ça</button></div><a class="source-link" href="${esc(item.url)}" target="_blank" rel="noopener">Ouvrir ${esc(item.source)} <span>↗</span></a></div>
  </article>`;
}
function renderFeed(){
  const items=filtered();$("#resultCount").textContent=`${items.length} info${items.length>1?"s":""}`;$("#emptyState").hidden=items.length>0;
  const names={all:"À retenir aujourd’hui",lois:"Lois & réglementation",marche:"Marché immobilier",investir:"Investissement",territoires:"Territoires"};$("#feedTitle").textContent=names[state.category]||names.all;
  $("#feed").innerHTML=items.map(card).join("");renderLegal();
  $$(".feed-card").forEach(el=>el.addEventListener("click",e=>{const btn=e.target.closest("button[data-action]");if(!btn)return;const id=el.dataset.id,act=btn.dataset.action;if(act==="fav"){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id]}else{state.feedback[id]=state.feedback[id]===act?null:act}savePrefs();renderFeed()}));
}
function bind(){
  $$(".profile-switch button").forEach(b=>{b.classList.toggle("active",b.dataset.profile===state.profile);b.onclick=()=>{state.profile=b.dataset.profile;localStorage.setItem("immoRadarProfile",state.profile);$$(".profile-switch button").forEach(x=>x.classList.toggle("active",x===b));renderFeed()}});
  $$(".tab").forEach(b=>b.onclick=()=>{state.category=b.dataset.category;$$(".tab").forEach(x=>x.classList.toggle("active",x===b));renderFeed()});
  $("#sortSelect").onchange=e=>{state.sort=e.target.value;renderFeed()};$("#officialOnly").onchange=e=>{state.officialOnly=e.target.checked;renderFeed()};$("#favoritesOnly").onchange=e=>{state.favoritesOnly=e.target.checked;renderFeed()};
  $("#searchInput").oninput=e=>{state.query=e.target.value;renderFeed()};$("#marketDetailsBtn").onclick=()=>{$("#marketDetails").hidden=!$("#marketDetails").hidden};
}
async function load(){bind();try{const [f,m]=await Promise.all([fetch("./data/feed.json",{cache:"no-store"}),fetch("./data/market.json",{cache:"no-store"})]);const feed=await f.json();state.items=feed.items||[];state.watch=feed.watch||[];state.market=await m.json();$("#lastUpdate").textContent=updateStamp(feed.generated_at);renderWatch();renderMarket();renderFeed()}catch(e){console.error(e);$("#lastUpdate").textContent="Erreur de chargement"}}
load();
