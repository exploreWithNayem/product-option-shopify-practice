// @ts-check
/**
 * Shine Options quick-add guard. Built into extensions/product-options/assets/shine-options.js,
 * the small script the app block and app embed reference in their schema (it runs on every page).
 *
 * On collection and search pages the embed outputs a map of variant id -> product URL for
 * products whose option set has an unconditional required field. Adding one of those without
 * choices (quick add, a card's add button) opens the product page instead (PRD edge cases).
 * The checkout Validation Function is the backstop for anything this misses.
 */
import { quickAddTarget } from "./format.js";

(function guard() {
  const w = /** @type {any} */ (window);
  if (w.__shineGuardBooted) return;
  w.__shineGuardBooted = true;

  /** @type {Record<string, string>} */
  const map = {};
  let installed = false;

  function read() {
    document.querySelectorAll("[data-shine-quickadd]:not([data-shine-read])").forEach((el) => {
      el.setAttribute("data-shine-read", "");
      try {
        Object.assign(map, JSON.parse(el.getAttribute("data-shine-quickadd") || "{}"));
      } catch {
        /* ignore a malformed map */
      }
    });
    if (!installed && Object.keys(map).length) install();
  }

  function install() {
    installed = true;
    const originalFetch = window.fetch;
    window.fetch = function shineFetch(input, init) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && /** @type {Request} */ (input).url;
        const method = String((init && init.method) || (input && typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
        if (method === "POST" && url && /\/cart\/add(\.js)?(\?|$)/.test(String(url).split("#")[0])) {
          const target = quickAddTarget(init && init.body, map);
          if (target) {
            window.location.assign(target);
            return new Promise(() => {});
          }
        }
      } catch {
        /* never break the theme's own add to cart */
      }
      return originalFetch.apply(this, /** @type {any} */ (arguments));
    };

    document.addEventListener(
      "submit",
      (e) => {
        const form = /** @type {HTMLFormElement} */ (e.target);
        if (!(form instanceof HTMLFormElement) || !/\/cart\/add/.test(form.getAttribute("action") || "")) return;
        const target = quickAddTarget(new FormData(form), map);
        if (!target) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.assign(target);
      },
      true,
    );
  }

  read();
  // Infinite scroll and filtering re-render the product grid with a new map.
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of Array.from(r.addedNodes))
        if (n.nodeType === 1 && (/** @type {Element} */ (n).matches("[data-shine-quickadd]") || /** @type {Element} */ (n).querySelector("[data-shine-quickadd]")))
          return read();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
