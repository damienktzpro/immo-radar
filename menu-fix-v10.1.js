/* ==========================================================
   IMMO RADAR — MENU MOBILE FIX V10.1 + CHARGEUR V8
   Remplace le fichier menu-fix-v10.1.js existant.
   ========================================================== */
(() => {
  "use strict";

  const NAV_SELECTOR = ".main-nav";
  const BUTTON_SELECTOR = ".mobile-menu-btn";

  function getElements() {
    return {
      nav: document.querySelector(NAV_SELECTOR),
      button: document.querySelector(BUTTON_SELECTOR),
    };
  }

  function setMenu(open) {
    const { nav, button } = getElements();
    if (!nav || !button) return;
    nav.classList.toggle("open", open);
    nav.classList.toggle("active", open);
    nav.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    nav.setAttribute("aria-hidden", open ? "false" : "true");
    document.documentElement.classList.toggle("mobile-nav-open", open);
  }

  function isOpen() {
    const { nav } = getElements();
    return !!nav && (
      nav.classList.contains("open") ||
      nav.classList.contains("active") ||
      nav.classList.contains("is-open")
    );
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest(BUTTON_SELECTOR);

    if (button) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setMenu(!isOpen());
      return;
    }

    const nav = event.target.closest(NAV_SELECTOR);
    if (nav && event.target.closest("a")) {
      setMenu(false);
      return;
    }

    if (isOpen() && !nav) setMenu(false);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) setMenu(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760 && isOpen()) setMenu(false);
  });

  function loadV8Assets(){
    if(!document.querySelector('link[data-immo-v8]')){
      const css=document.createElement("link");
      css.rel="stylesheet";
      css.href="./v8-tools.css?v=8.0";
      css.dataset.immoV8="css";
      document.head.appendChild(css);
    }
    if(!document.querySelector('script[data-immo-v8]')){
      const js=document.createElement("script");
      js.src="./v8-tools.js?v=8.0";
      js.dataset.immoV8="js";
      document.body.appendChild(js);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const { nav, button } = getElements();
    if (nav && button) {
      button.setAttribute("aria-expanded", "false");
      nav.setAttribute("aria-hidden", window.innerWidth <= 760 ? "true" : "false");
    }
    loadV8Assets();
  }, {once:true});

  if(document.readyState!=="loading") loadV8Assets();
})();
