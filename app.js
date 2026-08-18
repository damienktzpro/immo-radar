const state = {
  profile: localStorage.getItem("immoRadarProfile") || "investisseur",
  category: "all",
  sort: "pertinence",
  officialOnly: false,
  items: [],
  market: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function niceDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function relativeUpdate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Données disponibles";
  return `Mis à jour le ${new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(d)}`;
}

function profileScore(item) {
  const base = Number(item.relevance || 0);
  const matches = (item.audiences || []).includes(state.profile);
  return Math.min(100, base + (matches ? 8 : -12));
}

function filteredItems() {
  const items = state.items.filter((item) => {
    const profileOk = (item.audiences || []).includes(state.profile) || (item.audiences || []).includes("tous");
    const categoryOk = state.category === "all" || item.category === state.category;
    const officialOk = !state.officialOnly || ["A", "B"].includes(item.source_level);
    return profileOk && categoryOk && officialOk;
  });

  return items.sort((a, b) => {
    if (state.sort === "recent") return new Date(b.published_at) - new Date(a.published_at);
    if (state.sort === "important") return Number(b.importance || 0) - Number(a.importance || 0);
    return profileScore(b) - profileScore(a);
  });
}

function sourceLevelClass(level) {
  return ["A","B","C","D"].includes(level) ? level.toLowerCase() : "d";
}

function renderFeed() {
  const items = filteredItems();
  $("#resultCount").textContent = `${items.length} info${items.length > 1 ? "s" : ""}`;
  $("#emptyState").hidden = items.length > 0;

  const titles = {
    all: "À retenir aujourd’hui",
    lois: "Lois & réglementation",
    marche: "Marché immobilier",
    investir: "Investissement",
    territoires: "Territoires"
  };
  $("#feedTitle").textContent = titles[state.category] || titles.all;

  $("#feed").innerHTML = items.map((item) => {
    const score = profileScore(item);
    const level = esc(item.source_level || "D");
    return `
      <article class="feed-card">
        <div>
          <a class="title" href="${esc(item.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>
          <div class="meta">
            <span class="level ${sourceLevelClass(level)}" title="Niveau de fiabilité">${level}</span>
            <span class="tag">${esc(item.source)}</span>
            <span class="tag">${niceDate(item.published_at)}</span>
            <span class="tag">${esc(item.territory || "France")}</span>
            ${item.status ? `<span class="tag status">${esc(item.status)}</span>` : ""}
          </div>
          <p>${esc(item.summary)}</p>
          ${item.why_it_matters ? `<p class="why"><strong>Pourquoi c’est important :</strong> ${esc(item.why_it_matters)}</p>` : ""}
        </div>
        <div class="score-box">
          <strong>${score}</strong>
          <small>pertinence /100</small>
        </div>
      </article>
    `;
  }).join("");
}

function renderMarket() {
  const m = state.market;
  if (!m) return;
  $("#marketScore").textContent = `${m.temperature.score}/100`;
  $("#marketLabel").textContent = m.temperature.label;
  $("#marketBar").style.width = `${Math.max(0, Math.min(100, m.temperature.score))}%`;
  $("#marketComment").textContent = m.temperature.comment;

  $("#balanceLabel").textContent = m.balance.label;
  $("#balanceDot").style.left = `${Math.max(0, Math.min(100, m.balance.score))}%`;
  $("#balanceComment").textContent = m.balance.comment;

  $("#financeLabel").textContent = m.financing.label;
  $("#financeDot").style.left = `${Math.max(0, Math.min(100, m.financing.score))}%`;
  $("#financeComment").textContent = m.financing.comment;
}

function bindUI() {
  $$(".profile-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.profile === state.profile);
    btn.addEventListener("click", () => {
      state.profile = btn.dataset.profile;
      localStorage.setItem("immoRadarProfile", state.profile);
      $$(".profile-switch button").forEach((x) => x.classList.toggle("active", x === btn));
      renderFeed();
    });
  });

  $$(".tab").forEach((btn) => btn.addEventListener("click", () => {
    state.category = btn.dataset.category;
    $$(".tab").forEach((x) => x.classList.toggle("active", x === btn));
    renderFeed();
  }));

  $("#sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderFeed();
  });

  $("#officialOnly").addEventListener("change", (e) => {
    state.officialOnly = e.target.checked;
    renderFeed();
  });
}

async function load() {
  bindUI();
  try {
    const [feedRes, marketRes] = await Promise.all([
      fetch("./data/feed.json", { cache: "no-store" }),
      fetch("./data/market.json", { cache: "no-store" })
    ]);
    const feed = await feedRes.json();
    state.items = feed.items || [];
    $("#lastUpdate").textContent = relativeUpdate(feed.generated_at);
    state.market = await marketRes.json();
    renderMarket();
    renderFeed();
  } catch (err) {
    console.error(err);
    $("#lastUpdate").textContent = "Impossible de charger les données";
    $("#emptyState").hidden = false;
    $("#emptyState").innerHTML = "<strong>Erreur de chargement.</strong><span>Relancez le site via un serveur HTTP local ou GitHub Pages.</span>";
  }
}

load();
