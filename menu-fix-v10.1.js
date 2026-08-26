/* ==========================================================
   IMMO RADAR — MENU MOBILE V10.2
   Les ressources Location/Outils sont chargées directement
   par index.html : ce fichier ne gère plus que la navigation.
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
    if (nav && event.target.closest("a, button")) {
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

  document.addEventListener("DOMContentLoaded", () => {
    const { nav, button } = getElements();
    if (nav && button) {
      button.setAttribute("aria-expanded", "false");
      nav.setAttribute("aria-hidden", window.innerWidth <= 760 ? "true" : "false");
    }
  }, {once:true});
})();
