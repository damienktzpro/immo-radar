/* ==========================================================
   IMMO RADAR — V8 · MARCHÉ LOCATIF + SIMULATEURS
   - Page Marché locatif reliée à geo.api.gouv.fr + data.gouv.fr
   - Capacité d'emprunt (règle HCSF 35 %)
   - Simulateur de prêt
   - Rentabilité locative
   ========================================================== */

(() => {
  "use strict";

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const euro = (n, digits=0) => Number.isFinite(Number(n))
    ? new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:digits}).format(Number(n))
    : "—";
  const num = v => {
    if(v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/\s/g,"").replace(",","."));
    return Number.isFinite(n) ? n : 0;
  };
  const pct = (n, digits=2) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(digits).replace(".",",")} %` : "—";
  const esc = (v="") => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  const TABULAR_BASE = "https://tabular-api.data.gouv.fr/api/resources";
  const DVF_STATS_RESOURCE = "851d342f-9c96-41c1-924a-11a7a7aae8a6";
  const RENT_RESOURCES = {
    apartment:"55b34088-0964-415f-9df7-d87dd98a09be",
    small:"14a1fe11-b2d1-49b3-9f6b-83d12df9482c",
    large:"5e3b28a4-cf56-43a3-ae79-43cceeb27f8c",
    house:"129f764d-b613-44e4-952c-5ff50a8c9b73"
  };
  const BDF_RATE = 3.27;
  const HCSF_MAX = 35;

  const rentalState = {
    territory:null,
    rent:null,
    dvf:null,
    timer:null,
    requestId:0
  };

  function ensureNavLinks(){
    const nav = $(".main-nav");
    if(!nav || $(".v8-nav-link",nav)) return;

    const market = $('.nav-btn[data-page="market"]',nav);
    const territories = $('.nav-btn[data-page="territories"]',nav);

    const rental = document.createElement("a");
    rental.href = "#v8Rental";
    rental.className = "v8-nav-link";
    rental.dataset.v8page = "rental";
    rental.textContent = "Location";

    const tools = document.createElement("a");
    tools.href = "#v8Tools";
    tools.className = "v8-nav-link";
    tools.dataset.v8page = "tools";
    tools.textContent = "Outils";

    if(market) market.insertAdjacentElement("afterend",rental);
    else nav.appendChild(rental);
    if(territories) territories.insertAdjacentElement("afterend",tools);
    else nav.appendChild(tools);
  }

  function pageMarkup(){
    return `
      <section id="v8Rental" class="v8-page shell" hidden>
        <div class="v8-hero">
          <span class="v8-kicker">Marché locatif · France</span>
          <h2>Lire les loyers avant de décider.</h2>
          <p>Comparez les loyers d’annonce par typologie, croisez-les avec les prix DVF et obtenez un ordre de grandeur de rendement brut local sans masquer la période ni les limites des données.</p>
          <div class="v8-source-row">
            <a href="https://www.data.gouv.fr/fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/" target="_blank" rel="noopener">Carte des loyers 2025 ↗</a>
            <a href="https://explore.data.gouv.fr/fr/immobilier" target="_blank" rel="noopener">DVF · ventes réelles ↗</a>
            <span class="v8-source-chip">Loyers : charges comprises · annonces non meublées</span>
          </div>
          <div class="v8-freshness-banner"><strong>Dernières données locatives disponibles : T3 2025</strong><span>Estimations ANIL publiées en décembre 2025 · période et prudence affichées pour chaque commune.</span></div>
        </div>

        <div class="v8-panel">
          <div class="v8-panel-head">
            <div>
              <span class="v8-card-kicker">Radar locatif territorial</span>
              <h3 id="v8RentalTitle">Choisissez une commune</h3>
              <p id="v8RentalMeta">Le Radar utilise le code INSEE pour interroger les ressources publiques.</p>
            </div>
          </div>

          <div class="v8-search-wrap">
            <div class="v8-search">
              <label class="sr-only" for="v8RentalSearch">Rechercher une commune ou un code postal</label>
              <input id="v8RentalSearch" type="search" autocomplete="off" placeholder="Paris 11e, Bordeaux, Nantes, 92100…">
              <button id="v8RentalSearchBtn" class="v8-primary" type="button">Rechercher</button>
            </div>
            <div id="v8RentalResults" class="v8-results" hidden></div>
          </div>

          <div class="v8-quick">
            <button data-v8-code="75111">Paris 11e</button>
            <button data-v8-code="69382">Lyon 2e</button>
            <button data-v8-code="33063">Bordeaux</button>
            <button data-v8-code="44109">Nantes</button>
          </div>

          <div id="v8RentalStatus" class="v8-status">Sélectionnez une commune pour charger les données locatives.</div>
          <div id="v8RentalMetrics" class="v8-metrics"></div>

          <div id="v8LocalAnalysis" class="v8-local-analysis" hidden>
            <article class="v8-analysis-card">
              <span class="v8-card-kicker">Ordre de grandeur</span>
              <h4>Budget & loyer théoriques</h4>
              <p>Calcul basé sur la typologie choisie, le loyer communal modélisé et la médiane DVF disponible. Ce n’est pas une estimation d’un bien précis.</p>
              <div class="v81-local-controls">
                <div class="v8-field">
                  <label for="v8LocalType">Typologie</label>
                  <select id="v8LocalType">
                    <option value="apartment">Appartement · toutes typologies</option>
                    <option value="small" selected>Appartement · T1–T2</option>
                    <option value="large">Appartement · T3 et +</option>
                    <option value="house">Maison</option>
                  </select>
                </div>
                <div class="v8-field">
                  <label for="v8LocalSurface">Surface</label>
                  <input id="v8LocalSurface" type="number" min="10" max="300" step="1" value="40">
                </div>
                <button id="v8LocalRecalc" class="v8-secondary" type="button">Recalculer</button>
              </div>
              <div id="v8LocalBudgetMetrics" class="v8-metrics" style="grid-template-columns:repeat(2,minmax(0,1fr));"></div>
            </article>

            <article class="v8-analysis-card dark">
              <span class="v8-card-kicker">Investissement locatif</span>
              <h4>Rendement brut local théorique</h4>
              <div id="v8LocalYield" class="v8-big-number">—</div>
              <p id="v8LocalYieldText">Sélectionnez un territoire disposant à la fois d’un indicateur de loyer et d’un prix DVF exploitable.</p>
              <div class="v8-note">Le rendement affiché ne déduit ni fiscalité, ni charges, ni travaux, ni vacance. Utilisez ensuite le simulateur de rentabilité pour une analyse plus complète.</div>
              <button id="v8UseInSimulator" class="v8-primary v8-simulator-cta" type="button" disabled>Simuler cet investissement →</button>
            </article>
          </div>

          <div class="v8-method">
            <article><strong>Source loyers</strong>Estimations ANIL à partir d’annonces Groupe SeLoger et leboncoin, biens non meublés, charges comprises, T3 2025.</article>
            <article><strong>Source prix</strong>Statistiques DVF issues des mutations enregistrées. La médiane locale est un repère de marché, pas une expertise.</article>
            <article><strong>Prudence</strong>Un indicateur de loyer calculé sur une maille ou un faible échantillon doit être interprété avec davantage de précaution.</article>
          </div>
        </div>
      </section>

      <section id="v8Tools" class="v8-page shell" hidden>
        <div class="v8-hero">
          <span class="v8-kicker">Outils de décision</span>
          <h2>Financer. Simuler. Mesurer.</h2>
          <p>Trois outils pour passer d’une information de marché à une décision chiffrée : capacité d’emprunt, coût du crédit et rentabilité locative.</p>
          <div class="v8-source-row">
            <a href="https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers" target="_blank" rel="noopener">Règle HCSF ↗</a>
            <a href="https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers-2026-06" target="_blank" rel="noopener">Banque de France · juin 2026 ↗</a>
            <span class="v8-source-chip">Taux prérempli : ${String(BDF_RATE).replace(".",",")} % · modifiable</span>
          </div>
          <div class="v8-privacy-note">Calculs effectués uniquement dans votre navigateur · aucune donnée financière n’est envoyée ni conservée.</div>
        </div>

        <div class="v8-panel">
          <div class="v8-tool-tabs" role="tablist" aria-label="Simulateurs immobiliers">
            <button class="v8-tab active" data-v8-tool="capacity" type="button" role="tab" aria-selected="true">Capacité d’emprunt</button>
            <button class="v8-tab" data-v8-tool="loan" type="button" role="tab" aria-selected="false">Prêt immobilier</button>
            <button class="v8-tab" data-v8-tool="yield" type="button" role="tab" aria-selected="false">Rentabilité locative</button>
          </div>

          <div id="v8ToolCapacity" class="v8-tool active">
            <div class="v8-tool-grid">
              <div class="v8-form-card">
                <span class="v8-card-kicker">Capacité d’emprunt</span>
                <div class="v8-form-grid">
                  <div class="v8-field"><label for="capIncome1">Revenus nets mensuels avant impôt</label><input id="capIncome1" type="number" min="0" step="50" value="3000"></div>
                  <div class="v8-field"><label for="capIncome2">Revenus co-emprunteur</label><input id="capIncome2" type="number" min="0" step="50" value="0"></div>
                  <div class="v8-field"><label for="capRentIncome">Revenus locatifs mensuels</label><input id="capRentIncome" type="number" min="0" step="25" value="0"><small>Ils peuvent être retenus différemment selon la banque.</small></div>
                  <div class="v8-field"><label for="capRentShare">Part des loyers retenue</label><input id="capRentShare" type="number" min="0" max="100" step="5" value="70"><small>Hypothèse bancaire modifiable, pas une règle HCSF.</small></div>
                  <div class="v8-field"><label for="capExisting">Crédits en cours / mois</label><input id="capExisting" type="number" min="0" step="25" value="0"></div>
                  <div class="v8-field"><label for="capOther">Autres mensualités de crédits</label><input id="capOther" type="number" min="0" step="25" value="0"><small>Autres dettes ou emprunts restant à payer après l’opération.</small></div>
                  <div class="v8-field"><label for="capDeposit">Apport personnel</label><input id="capDeposit" type="number" min="0" step="1000" value="30000"></div>
                  <div class="v8-field"><label for="capYears">Durée</label><select id="capYears"><option>15</option><option>20</option><option selected>25</option></select></div>
                  <div class="v8-field"><label for="capRate">Taux nominal annuel</label><input id="capRate" type="number" min="0" max="15" step=".01" value="${BDF_RATE}"><small>Référence BDF juin 2026, hors frais et assurance.</small></div>
                  <div class="v8-field"><label for="capInsurance">Assurance annuelle / capital initial</label><input id="capInsurance" type="number" min="0" max="5" step=".01" value="0.25"></div>
                </div>
              </div>
              <div class="v8-result-card">
                <span class="v8-card-kicker">Estimation indicative</span>
                <div id="capBorrowing" class="v8-result-main">—</div>
                <p class="v8-result-sub">Capacité d’emprunt théorique selon les hypothèses saisies.</p>
                <div id="capResults" class="v8-result-list"></div>
                <div class="v8-note">Le HCSF fixe en principe un taux d’effort maximal de 35 % et une maturité maximale de 25 ans. Une banque reste libre d’accepter ou non le dossier et dispose d’une marge de flexibilité réglementaire.</div>
              </div>
            </div>
          </div>

          <div id="v8ToolLoan" class="v8-tool">
            <div class="v8-tool-grid">
              <div class="v8-form-card">
                <span class="v8-card-kicker">Prêt immobilier</span>
                <div class="v8-form-grid">
                  <div class="v8-field"><label for="loanCapital">Capital emprunté</label><input id="loanCapital" type="number" min="0" step="1000" value="250000"></div>
                  <div class="v8-field"><label for="loanYears">Durée</label><select id="loanYears"><option>10</option><option>15</option><option>20</option><option selected>25</option></select></div>
                  <div class="v8-field"><label for="loanRate">Taux nominal annuel</label><input id="loanRate" type="number" min="0" max="15" step=".01" value="${BDF_RATE}"></div>
                  <div class="v8-field"><label for="loanInsurance">Assurance annuelle / capital initial</label><input id="loanInsurance" type="number" min="0" max="5" step=".01" value="0.25"></div>
                </div>
              </div>
              <div class="v8-result-card">
                <span class="v8-card-kicker">Mensualité estimée</span>
                <div id="loanMonthly" class="v8-result-main">—</div>
                <p class="v8-result-sub">Mensualité crédit + assurance selon les hypothèses saisies.</p>
                <div id="loanResults" class="v8-result-list"></div>
                <div id="loanChart" class="v8-chart"></div>
                <div class="v8-note">Simulation hors frais de dossier, garantie, courtage et autres coûts entrant éventuellement dans le TAEG.</div>
              </div>
            </div>
          </div>

          <div id="v8ToolYield" class="v8-tool">
            <div class="v8-tool-grid">
              <div class="v8-form-card">
                <span class="v8-card-kicker">Rentabilité locative</span>
                <div class="v8-form-grid">
                  <div class="v8-field"><label for="yPrice">Prix du bien</label><input id="yPrice" type="number" min="0" step="1000" value="180000"></div>
                  <div class="v8-field"><label for="yFeesPreset">Estimation des frais d’acquisition</label><select id="yFeesPreset"><option value="7.5" selected>Ancien · 7,5 %</option><option value="2.5">Neuf · 2,5 %</option><option value="manual">Saisie manuelle</option></select></div>
                  <div class="v8-field"><label for="yFees">Frais d’acquisition</label><input id="yFees" type="number" min="0" step="500" value="13500"><small>Estimation modifiable, à confirmer avec un notaire.</small></div>
                  <div class="v8-field"><label for="yWorks">Travaux</label><input id="yWorks" type="number" min="0" step="500" value="10000"></div>
                  <div class="v8-field"><label for="yFurniture">Mobilier</label><input id="yFurniture" type="number" min="0" step="250" value="3000"></div>
                  <div class="v8-field"><label for="yRent">Loyer mensuel hors charges</label><input id="yRent" type="number" min="0" step="10" value="950"></div>
                  <div class="v8-field"><label for="yTargetGross">Objectif de rendement brut</label><input id="yTargetGross" type="number" min=".1" max="30" step=".1" value="5"><small>Utilisé pour calculer le prix maximal indicatif.</small></div>
                  <div class="v8-field"><label for="yVacancy">Vacance locative</label><input id="yVacancy" type="number" min="0" max="100" step=".5" value="5"><small>Part du loyer annuel non encaissée.</small></div>
                  <div class="v8-field"><label for="yTax">Taxe foncière / an</label><input id="yTax" type="number" min="0" step="50" value="1100"></div>
                  <div class="v8-field"><label for="yCharges">Charges non récupérables / an</label><input id="yCharges" type="number" min="0" step="50" value="900"></div>
                  <div class="v8-field"><label for="yPno">PNO + autres assurances / an</label><input id="yPno" type="number" min="0" step="25" value="180"></div>
                  <div class="v8-field"><label for="yManagement">Gestion locative</label><input id="yManagement" type="number" min="0" max="30" step=".5" value="0"><small>% des loyers encaissés.</small></div>
                  <div class="v8-field"><label for="yLoan">Montant emprunté</label><input id="yLoan" type="number" min="0" step="1000" value="160000"></div>
                  <div class="v8-field"><label for="yYears">Durée du prêt</label><select id="yYears"><option>15</option><option>20</option><option selected>25</option></select></div>
                  <div class="v8-field"><label for="yRate">Taux nominal</label><input id="yRate" type="number" min="0" max="15" step=".01" value="${BDF_RATE}"></div>
                  <div class="v8-field"><label for="yInsurance">Assurance annuelle</label><input id="yInsurance" type="number" min="0" max="5" step=".01" value="0.25"></div>
                </div>
              </div>
              <div class="v8-result-card">
                <span class="v8-card-kicker">Performance avant fiscalité</span>
                <div id="yPrefillNotice" class="v8-prefill-notice" hidden></div>
                <div id="yieldNet" class="v8-result-main">—</div>
                <p class="v8-result-sub">Rentabilité nette de charges avant impôt sur les revenus locatifs.</p>
                <div id="yieldResults" class="v8-result-list"></div>
                <div class="v8-score-row">
                  <div class="v8-score"><span>Brute</span><strong id="yieldGross">—</strong></div>
                  <div class="v8-score"><span>Nette</span><strong id="yieldNetMini">—</strong></div>
                  <div class="v8-score"><span>Cash-flow</span><strong id="yieldCash">—</strong></div>
                </div>
                <div class="v8-note">La fiscalité (location nue, LMNP, régime réel/micro, situation du foyer) n’est volontairement pas déduite ici. Le cash-flow est donc affiché avant impôt.</div>
              </div>
            </div>
          </div>

          <div class="v8-method">
            <article><strong>35 % HCSF</strong>Le taux d’effort rapporte les charges d’emprunt aux revenus. L’assurance emprunteur est incluse dans les charges.</article>
            <article><strong>Taux de référence</strong>Le 3,27 % correspond au taux moyen des nouveaux crédits à l’habitat hors renégociations en juin 2026, hors frais et assurance.</article>
            <article><strong>Simulation ≠ offre</strong>Les résultats servent à comparer des scénarios. Ils ne constituent ni une offre de crédit, ni un conseil fiscal ou patrimonial personnalisé.</article>
          </div>
        </div>
      </section>
    `;
  }

  function insertPages(){
    if($("#v8Rental")) return;
    const hero = $(".hero.shell");
    if(!hero) return;
    hero.insertAdjacentHTML("afterend",pageMarkup());
  }

  function standardTargets(){
    return [
      "#todayOverview","#pulseSection","#pageIntro","#legalDashboard",
      "#investDashboard","#territoryDashboard","#feedSection","#sourcesPanel",
      ".local-cta"
    ].map(s=>$(s)).filter(Boolean);
  }

  function restoreStandard(){
    $$(".v8-page").forEach(x=>x.hidden=true);
    standardTargets().forEach(x=>x.classList.remove("v8-suppressed"));
    $$(".v8-nav-link").forEach(x=>x.classList.remove("active"));
  }

  function openV8Page(which){
    standardTargets().forEach(x=>x.classList.add("v8-suppressed"));
    $$(".v8-page").forEach(x=>x.hidden=true);
    const page = which==="rental" ? $("#v8Rental") : $("#v8Tools");
    if(page) page.hidden=false;
    $$(".nav-btn").forEach(x=>x.classList.remove("active"));
    $$(".v8-nav-link").forEach(x=>x.classList.toggle("active",x.dataset.v8page===which));
    $(".main-nav")?.classList.remove("mobile-open","open","active","is-open");
    $("#mobileMenuBtn")?.setAttribute("aria-expanded","false");
    page?.scrollIntoView({behavior:"smooth",block:"start"});
    if(which==="rental" && !rentalState.territory) hydrateRentalDefault();
  }

  function bindNavigation(){
    document.addEventListener("click",e=>{
      const v8 = e.target.closest(".v8-nav-link");
      if(v8){
        e.preventDefault();
        openV8Page(v8.dataset.v8page);
        return;
      }
      if(e.target.closest(".nav-btn")){
        restoreStandard();
      }
    },true);
  }

  async function fetchCommuneByCode(code){
    const fields="nom,code,codesPostaux,population,departement,region";
    const r=await fetch(`https://geo.api.gouv.fr/communes/${encodeURIComponent(code)}?fields=${encodeURIComponent(fields)}`);
    if(!r.ok) throw new Error("Commune introuvable");
    return await r.json();
  }

  async function searchCommunes(q){
    q=String(q||"").trim();
    if(q.length<2) return [];
    const fields="nom,code,codesPostaux,population,departement,region";
    const param=/^\d{5}$/.test(q) ? `codePostal=${encodeURIComponent(q)}` : `nom=${encodeURIComponent(q)}&boost=population`;
    const r=await fetch(`https://geo.api.gouv.fr/communes?${param}&fields=${encodeURIComponent(fields)}`);
    if(!r.ok) throw new Error("Recherche indisponible");
    const data=await r.json();
    return (Array.isArray(data)?data:[]).slice(0,8);
  }

  async function fetchTabular(resource,params){
    const u=new URL(`${TABULAR_BASE}/${resource}/data/`);
    Object.entries({...params,page_size:20}).forEach(([k,v])=>u.searchParams.set(k,v));
    const r=await fetch(u,{cache:"no-store"});
    if(!r.ok) throw new Error(`data.gouv ${r.status}`);
    const data=await r.json();
    for(const key of ["data","results","records","items"]){
      if(Array.isArray(data?.[key])) return data[key];
    }
    return Array.isArray(data)?data:[];
  }

  function nnum(v){
    if(v===null||v===undefined||v==="")return null;
    const n=Number(String(v).replace(/\s/g,"").replace(",","."));
    return Number.isFinite(n)?n:null;
  }

  async function fetchRentOne(resource,code){
    const rows=await fetchTabular(resource,{INSEE_C__exact:code});
    const row=rows.find(r=>String(r.INSEE_C||"")===String(code))||rows[0];
    if(!row) return null;
    return {
      rent_m2:nnum(row.loypredm2),
      low_m2:nnum(row["lwr.IPm2"]),
      high_m2:nnum(row["upr.IPm2"]),
      prediction_type:row.TYPPRED||null,
      observations_commune:nnum(row.nbobs_com),
      observations_mesh:nnum(row.nbobs_mail),
      r2:nnum(row.R2_adj)
    };
  }

  async function fetchRents(code){
    const settled=await Promise.allSettled(
      Object.entries(RENT_RESOURCES).map(async([k,r])=>[k,await fetchRentOne(r,code)])
    );
    const out={};
    settled.forEach(x=>{if(x.status==="fulfilled")out[x.value[0]]=x.value[1]});
    return out;
  }

  async function fetchDvf(code){
    const rows=await fetchTabular(DVF_STATS_RESOURCE,{code_geo__exact:code});
    const row=rows.find(r=>String(r.code_geo||"")===String(code))||rows[0];
    if(!row) return null;
    return {
      apartment:{
        median_price_m2:nnum(row.med_prix_m2_whole_appartement),
        sales:nnum(row.nb_ventes_whole_appartement)
      },
      house:{
        median_price_m2:nnum(row.med_prix_m2_whole_maison),
        sales:nnum(row.nb_ventes_whole_maison)
      }
    };
  }

  function rentMetric(title,v){
    if(!v?.rent_m2) return `<article class="v8-metric"><small>${esc(title)}</small><strong>—</strong><em>Donnée indisponible</em></article>`;
    const range=(v.low_m2&&v.high_m2)
      ? `${v.low_m2.toFixed(1).replace(".",",")}–${v.high_m2.toFixed(1).replace(".",",")} €/m²`
      : "Intervalle non disponible";
    const obs=v.observations_commune
      ? `${Math.round(v.observations_commune)} observations commune`
      : v.observations_mesh
        ? `${Math.round(v.observations_mesh)} observations maille`
        : "Échantillon non affiché";
    const method=String(v.prediction_type||"").toLowerCase().includes("mail")
      ? "modèle par maille"
      : "modèle communal";
    return `<article class="v8-metric">
      <small>${esc(title)}</small>
      <strong>${v.rent_m2.toFixed(1).replace(".",",")} €/m²</strong>
      <em>${esc(range)} · ${esc(obs)}</em>
      <div class="v81-data-line"><span class="v81-data-pill">T3 2025</span><span class="v81-data-pill">${esc(method)}</span></div>
    </article>`;
  }

  function renderRental(){
    const t=rentalState.territory, rent=rentalState.rent||{}, dvf=rentalState.dvf;
    if(!t) return;
    $("#v8RentalTitle").textContent=t.nom||"Commune";
    $("#v8RentalMeta").textContent=[t.departement?.nom,t.region?.nom,`Code INSEE ${t.code}`].filter(Boolean).join(" · ");
    $("#v8RentalMetrics").innerHTML=[
      rentMetric("Appartement · toutes typologies",rent.apartment),
      rentMetric("Appartement · T1–T2",rent.small),
      rentMetric("Appartement · T3 et +",rent.large),
      rentMetric("Maison",rent.house)
    ].join("");
    $("#v8LocalAnalysis").hidden=false;
    renderLocalYield();
  }

  function renderLocalYield(){
    const surface=Math.max(1,num($("#v8LocalSurface")?.value)||40);
    const type=$("#v8LocalType")?.value||"small";
    const rentData=rentalState.rent?.[type];
    const priceFamily=type==="house"?"house":"apartment";
    const priceData=rentalState.dvf?.[priceFamily];
    const rentM2=rentData?.rent_m2;
    const priceM2=priceData?.median_price_m2;
    const rentMonthly=rentM2?rentM2*surface:null;
    const purchase=priceM2?priceM2*surface:null;

    const typeLabels={
      apartment:"Appartement · toutes typologies",
      small:"Appartement · T1–T2",
      large:"Appartement · T3 et +",
      house:"Maison"
    };

    $("#v8LocalBudgetMetrics").innerHTML=`
      <article class="v8-metric">
        <small>Loyer mensuel indicatif</small>
        <strong>${rentMonthly?euro(rentMonthly):"—"}</strong>
        <em>${esc(typeLabels[type])} · charges comprises · T3 2025</em>
      </article>
      <article class="v8-metric">
        <small>Valeur DVF indicative</small>
        <strong>${purchase?euro(purchase):"—"}</strong>
        <em>${priceM2?`${Math.round(priceM2).toLocaleString("fr-FR")} €/m² médian DVF · ${priceFamily==="house"?"maisons":"appartements"}`:"Prix DVF indisponible"}</em>
      </article>
    `;
    if(rentMonthly&&purchase){
      const y=(rentMonthly*12/purchase)*100;
      $("#v8LocalYield").textContent=pct(y,2);
      $("#v8LocalYieldText").textContent=`${typeLabels[type]} · ${surface} m² : loyer indicatif ${euro(rentMonthly)}/mois pour une valeur DVF d’environ ${euro(purchase)}.`;
    }else{
      $("#v8LocalYield").textContent="—";
      $("#v8LocalYieldText").textContent="Le rendement nécessite un indicateur de loyer et une médiane DVF disponible pour la catégorie choisie.";
    }
    const cta=$("#v8UseInSimulator");
    if(cta)cta.disabled=!(rentMonthly&&purchase);
  }

  function openTool(id){
    $$(".v8-tab").forEach(b=>{
      const active=b.dataset.v8Tool===id;
      b.classList.toggle("active",active);
      b.setAttribute("aria-selected",String(active));
    });
    $$(".v8-tool").forEach(x=>x.classList.remove("active"));
    const panel=$(`#v8Tool${id[0].toUpperCase()+id.slice(1)}`);
    panel?.classList.add("active");
    return panel;
  }

  function updateAcquisitionFees(){
    const preset=$("#yFeesPreset")?.value;
    if(!preset||preset==="manual")return;
    const fees=Math.round(num($("#yPrice")?.value)*num(preset)/100);
    if($("#yFees"))$("#yFees").value=fees;
  }

  function prefillYieldFromLocal(){
    const surface=Math.max(1,num($("#v8LocalSurface")?.value)||40);
    const type=$("#v8LocalType")?.value||"small";
    const rentM2=rentalState.rent?.[type]?.rent_m2;
    const priceFamily=type==="house"?"house":"apartment";
    const priceM2=rentalState.dvf?.[priceFamily]?.median_price_m2;
    if(!rentM2||!priceM2)return;
    const price=Math.round(priceM2*surface);
    const rent=Math.round(rentM2*surface);

    $("#yPrice").value=price;
    $("#yRent").value=rent;
    $("#yLoan").value=price;
    $("#yWorks").value=0;
    $("#yFurniture").value=0;
    $("#yFeesPreset").value="7.5";
    updateAcquisitionFees();

    const notice=$("#yPrefillNotice");
    if(notice){
      notice.hidden=false;
      notice.innerHTML=`<strong>Prérempli depuis ${esc(rentalState.territory?.nom||"la commune")}</strong><span>${surface} m² · prix médian DVF ${Math.round(priceM2).toLocaleString("fr-FR")} €/m² · loyer ANIL T3 2025 ${rentM2.toFixed(1).replace(".",",")} €/m².</span><em>Attention : le loyer ANIL est charges comprises. Il est transféré comme hypothèse provisoire ; remplacez-le par le loyer hors charges du bien étudié.</em>`;
    }

    openV8Page("tools");
    const panel=openTool("yield");
    calcYield();
    setTimeout(()=>panel?.scrollIntoView({behavior:"smooth",block:"start"}),80);
  }

  async function selectRentalTerritory(t){
    rentalState.requestId+=1;
    const rid=rentalState.requestId;
    rentalState.territory=t;
    rentalState.rent=null;
    rentalState.dvf=null;
    $("#v8RentalStatus").className="v8-status";
    $("#v8RentalStatus").textContent=`Chargement des loyers et des ventes pour ${t.nom}…`;
    $("#v8RentalMetrics").innerHTML="";
    $("#v8LocalAnalysis").hidden=true;
    try{
      const [rents,dvf]=await Promise.all([fetchRents(t.code),fetchDvf(t.code).catch(()=>null)]);
      if(rid!==rentalState.requestId)return;
      rentalState.rent=rents;
      rentalState.dvf=dvf;
      const available=Object.values(rents).filter(x=>x?.rent_m2).length;
      $("#v8RentalStatus").className=available?"v8-status is-good":"v8-status";
      $("#v8RentalStatus").textContent=available
        ? `${available} typologie${available>1?"s":""} locative${available>1?"s":""} disponible${available>1?"s":""}. Les données sont des loyers d’annonce modélisés au T3 2025.`
        : "Aucun indicateur locatif exploitable n’a été trouvé pour ce territoire.";
      renderRental();
      try{localStorage.setItem("radarV8RentalTerritory",JSON.stringify(t))}catch{}
    }catch(err){
      console.error(err);
      $("#v8RentalStatus").className="v8-status is-error";
      $("#v8RentalStatus").textContent="Impossible de charger les données publiques pour le moment. Réessayez ultérieurement.";
    }
  }

  function renderCommuneResults(items){
    const box=$("#v8RentalResults");
    if(!items.length){box.hidden=true;box.innerHTML="";return}
    box.innerHTML=items.map((t,i)=>`
      <button type="button" data-v8-result="${i}">
        <strong>${esc(t.nom)}</strong>
        <span>${esc([t.codesPostaux?.[0],t.departement?.nom].filter(Boolean).join(" · "))}</span>
      </button>
    `).join("");
    box.hidden=false;
    $$("[data-v8-result]",box).forEach(b=>b.onclick=()=>{
      const t=items[Number(b.dataset.v8Result)];
      box.hidden=true;
      $("#v8RentalSearch").value=t.nom;
      selectRentalTerritory(t);
    });
  }

  async function doRentalSearch(){
    const q=$("#v8RentalSearch").value.trim();
    if(q.length<2)return;
    $("#v8RentalStatus").className="v8-status";
    $("#v8RentalStatus").textContent="Recherche de la commune…";
    try{
      const items=await searchCommunes(q);
      renderCommuneResults(items);
      if(items.length===1){
        $("#v8RentalResults").hidden=true;
        selectRentalTerritory(items[0]);
      }else{
        $("#v8RentalStatus").textContent=items.length?"Choisissez la commune exacte dans la liste.":"Aucune commune trouvée.";
      }
    }catch{
      $("#v8RentalStatus").className="v8-status is-error";
      $("#v8RentalStatus").textContent="Recherche territoriale indisponible.";
    }
  }

  async function hydrateRentalDefault(){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem("radarV8RentalTerritory")||localStorage.getItem("radarTerritoryData")||"null")}catch{}
    const code=saved?.code||"75111";
    try{
      const t=await fetchCommuneByCode(code);
      $("#v8RentalSearch").value=t.nom;
      selectRentalTerritory(t);
    }catch{}
  }

  function paymentDetails(capital,annualRate,years,insuranceAnnual){
    capital=Math.max(0,num(capital));
    years=Math.max(1,num(years));
    const n=years*12;
    const r=Math.max(0,num(annualRate))/100/12;
    const base=capital===0?0:(r===0?capital/n:capital*r/(1-Math.pow(1+r,-n)));
    const insurance=capital*Math.max(0,num(insuranceAnnual))/100/12;
    return {
      base,
      insurance,
      total:base+insurance,
      totalInterest:base*n-capital,
      totalInsurance:insurance*n,
      totalCost:base*n-capital+insurance*n,
      n,r
    };
  }

  function principalFromPayment(monthlyTotal,annualRate,years,insuranceAnnual){
    const n=Math.max(1,num(years))*12;
    const r=Math.max(0,num(annualRate))/100/12;
    const creditFactor=r===0?1/n:r/(1-Math.pow(1+r,-n));
    const insuranceFactor=Math.max(0,num(insuranceAnnual))/100/12;
    const factor=creditFactor+insuranceFactor;
    return factor>0?Math.max(0,num(monthlyTotal))/factor:0;
  }

  function calcCapacity(){
    const income1=num($("#capIncome1").value),income2=num($("#capIncome2").value);
    const rentIncome=num($("#capRentIncome").value);
    const rentShare=Math.min(100,Math.max(0,num($("#capRentShare").value)))/100;
    const existing=num($("#capExisting").value),other=num($("#capOther").value);
    const deposit=num($("#capDeposit").value);
    const years=num($("#capYears").value),rate=num($("#capRate").value),insurance=num($("#capInsurance").value);
    const effectiveIncome=income1+income2+rentIncome*rentShare;
    const maxCharges=effectiveIncome*(HCSF_MAX/100);
    const available=Math.max(0,maxCharges-existing-other);
    const borrowing=principalFromPayment(available,rate,years,insurance);
    const p=paymentDetails(borrowing,rate,years,insurance);
    const effort=effectiveIncome>0?((existing+other+p.total)/effectiveIncome*100):0;
    $("#capBorrowing").textContent=euro(borrowing);
    $("#capResults").innerHTML=`
      <div class="v8-result-line"><span>Mensualité nouvelle disponible</span><strong>${euro(available)}</strong></div>
      <div class="v8-result-line"><span>Enveloppe avant frais d’acquisition</span><strong>${euro(borrowing+deposit)}</strong></div>
      <div class="v8-result-line"><span>Revenus retenus dans la simulation</span><strong>${euro(effectiveIncome)}</strong></div>
      <div class="v8-result-line"><span>Taux d’effort simulé</span><strong>${pct(effort,1)}</strong></div>
      <div class="v8-result-line"><span>Durée / taux</span><strong>${years} ans · ${pct(rate,2)}</strong></div>
    `;
  }

  function remainingBalance(capital,annualRate,n,k){
    const r=Math.max(0,num(annualRate))/100/12;
    if(r===0)return Math.max(0,capital*(1-k/n));
    const p=capital*r/(1-Math.pow(1+r,-n));
    return Math.max(0,capital*Math.pow(1+r,k)-p*((Math.pow(1+r,k)-1)/r));
  }

  function loanSvg(capital,rate,years){
    const w=520,h=120,pad=12,n=years*12;
    const pts=[];
    for(let y=0;y<=years;y++){
      const bal=remainingBalance(capital,rate,n,y*12);
      const x=pad+(w-pad*2)*(y/years);
      const yy=h-pad-(h-pad*2)*(capital?bal/capital:0);
      pts.push(`${x.toFixed(1)},${yy.toFixed(1)}`);
    }
    return `<svg viewBox="0 0 ${w} ${h}" aria-label="Capital restant dû">
      <line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"></line>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"></line>
      <polyline points="${pts.join(" ")}"></polyline>
      <text x="${pad}" y="${h-1}">0</text>
      <text x="${w-48}" y="${h-1}">${years} ans</text>
      <text x="${pad+4}" y="${pad+9}">${euro(capital)}</text>
    </svg>`;
  }

  function calcLoan(){
    const capital=num($("#loanCapital").value),years=num($("#loanYears").value);
    const rate=num($("#loanRate").value),insurance=num($("#loanInsurance").value);
    const p=paymentDetails(capital,rate,years,insurance);
    $("#loanMonthly").textContent=euro(p.total);
    $("#loanResults").innerHTML=`
      <div class="v8-result-line"><span>Mensualité hors assurance</span><strong>${euro(p.base)}</strong></div>
      <div class="v8-result-line"><span>Assurance mensuelle</span><strong>${euro(p.insurance)}</strong></div>
      <div class="v8-result-line"><span>Intérêts sur la durée</span><strong>${euro(p.totalInterest)}</strong></div>
      <div class="v8-result-line"><span>Assurance sur la durée</span><strong>${euro(p.totalInsurance)}</strong></div>
      <div class="v8-result-line"><span>Coût intérêts + assurance</span><strong>${euro(p.totalCost)}</strong></div>
    `;
    $("#loanChart").innerHTML=loanSvg(capital,rate,years);
  }

  function calcYield(){
    const price=num($("#yPrice").value),fees=num($("#yFees").value),works=num($("#yWorks").value),furniture=num($("#yFurniture").value);
    const rent=num($("#yRent").value),targetGross=Math.max(.1,num($("#yTargetGross").value)||5),vacancy=Math.min(100,Math.max(0,num($("#yVacancy").value)))/100;
    const tax=num($("#yTax").value),charges=num($("#yCharges").value),pno=num($("#yPno").value);
    const management=Math.min(100,Math.max(0,num($("#yManagement").value)))/100;
    const loan=num($("#yLoan").value),years=num($("#yYears").value),rate=num($("#yRate").value),insurance=num($("#yInsurance").value);

    const project=price+fees+works+furniture;
    const annualGross=rent*12;
    const annualCollected=annualGross*(1-vacancy);
    const managementCost=annualCollected*management;
    const annualNetBeforeDebt=annualCollected-tax-charges-pno-managementCost;
    const grossYield=project>0?annualGross/project*100:0;
    const netYield=project>0?annualNetBeforeDebt/project*100:0;
    const debt=paymentDetails(loan,rate,years,insurance);
    const cashflow=(annualNetBeforeDebt-debt.total*12)/12;
    const preset=$("#yFeesPreset")?.value||"manual";
    const feeRate=preset==="manual"?null:num(preset)/100;
    const maxProject=annualGross/(targetGross/100);
    const maxPrice=Math.max(0,feeRate===null?maxProject-fees-works-furniture:(maxProject-works-furniture)/(1+feeRate));

    $("#yieldNet").textContent=pct(netYield,2);
    $("#yieldGross").textContent=pct(grossYield,2);
    $("#yieldNetMini").textContent=pct(netYield,2);
    $("#yieldCash").textContent=`${cashflow>=0?"+":""}${euro(cashflow)}/mois`;
    $("#yieldResults").innerHTML=`
      <div class="v8-result-line"><span>Coût total du projet</span><strong>${euro(project)}</strong></div>
      <div class="v8-result-line"><span>Loyers annuels théoriques</span><strong>${euro(annualGross)}</strong></div>
      <div class="v8-result-line"><span>Loyers après vacance</span><strong>${euro(annualCollected)}</strong></div>
      <div class="v8-result-line"><span>Charges annuelles propriétaire</span><strong>${euro(tax+charges+pno+managementCost)}</strong></div>
      <div class="v8-result-line"><span>Mensualité crédit + assurance</span><strong>${euro(debt.total)}</strong></div>
      <div class="v8-result-line"><span>Cash-flow avant fiscalité</span><strong>${cashflow>=0?"+":""}${euro(cashflow)}/mois</strong></div>
      <div class="v8-result-line is-target"><span>Prix maximal du bien pour ${pct(targetGross,1)} brut</span><strong>${euro(maxPrice)}</strong></div>
    `;
  }

  function bindTools(){
    $$(".v8-tab").forEach(b=>b.onclick=()=>openTool(b.dataset.v8Tool));

    [
      "#capIncome1","#capIncome2","#capRentIncome","#capRentShare","#capExisting","#capOther","#capDeposit","#capYears","#capRate","#capInsurance"
    ].forEach(s=>$(s)?.addEventListener("input",calcCapacity));
    ["#loanCapital","#loanYears","#loanRate","#loanInsurance"].forEach(s=>$(s)?.addEventListener("input",calcLoan));
    ["#yWorks","#yFurniture","#yRent","#yTargetGross","#yVacancy","#yTax","#yCharges","#yPno","#yManagement","#yLoan","#yYears","#yRate","#yInsurance"]
      .forEach(s=>$(s)?.addEventListener("input",calcYield));
    $("#yPrice")?.addEventListener("input",()=>{updateAcquisitionFees();calcYield()});
    $("#yFeesPreset")?.addEventListener("change",()=>{updateAcquisitionFees();calcYield()});
    $("#yFees")?.addEventListener("input",()=>{$("#yFeesPreset").value="manual";calcYield()});

    calcCapacity();calcLoan();calcYield();
  }

  function bindRental(){
    $("#v8RentalSearchBtn").onclick=doRentalSearch;
    $("#v8RentalSearch").addEventListener("keydown",e=>{if(e.key==="Enter")doRentalSearch()});
    $("#v8RentalSearch").addEventListener("input",()=>{
      clearTimeout(rentalState.timer);
      const q=$("#v8RentalSearch").value.trim();
      if(q.length<2){$("#v8RentalResults").hidden=true;return}
      rentalState.timer=setTimeout(async()=>{
        try{renderCommuneResults(await searchCommunes(q))}catch{}
      },250);
    });
    $$(".v8-quick [data-v8-code]").forEach(b=>b.onclick=async()=>{
      try{
        const t=await fetchCommuneByCode(b.dataset.v8Code);
        $("#v8RentalSearch").value=t.nom;
        selectRentalTerritory(t);
      }catch{}
    });
    $("#v8LocalRecalc").onclick=renderLocalYield;
    $("#v8LocalSurface").addEventListener("input",renderLocalYield);
    $("#v8LocalType").addEventListener("change",renderLocalYield);
    $("#v8UseInSimulator").onclick=prefillYieldFromLocal;
  }

  function init(){
    ensureNavLinks();
    insertPages();
    bindNavigation();
    bindRental();
    bindTools();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
