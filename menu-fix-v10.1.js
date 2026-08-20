/* ==========================================================
   IMMO RADAR — MENU MOBILE FIX V10.1
   À charger APRÈS app.js.
   Reprend le contrôle du bouton hamburger sur mobile.
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

  /* Capture = ce gestionnaire passe avant les anciens listeners
     du bouton et évite un double toggle. */
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

    /* Fermer après clic sur un lien du menu. */
    if (nav && event.target.closest("a")) {
      setMenu(false);
      return;
    }

    /* Fermer si clic ailleurs. */
    if (isOpen() && !nav) {
      setMenu(false);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setMenu(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760 && isOpen()) {
      setMenu(false);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const { nav, button } = getElements();
    if (!nav || !button) return;

    button.setAttribute("aria-expanded", "false");
    nav.setAttribute("aria-hidden", window.innerWidth <= 760 ? "true" : "false");
  });
})();
