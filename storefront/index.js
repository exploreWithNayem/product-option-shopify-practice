// @ts-check
/**
 * Shine Options product-page bundle. Built into
 * extensions/product-options/assets/shine-options-product.js by scripts/build-storefront.mjs,
 * and loaded (deferred) only on product pages that have an option set.
 *
 * - Hydrates every Liquid-rendered option set ([data-shine-root]).
 * - Embed fallback: when the theme has no app block, moves the embed's
 *   <template data-shine-fallback> into the product form.
 * - Never prices anything: the Cart Transform Function does that.
 */
import { CONTROLLERS, findProductForm, initRoot, installSubmitGuards } from "./product.js";

(function boot() {
  const w = /** @type {any} */ (window);
  if (w.__shineProductBooted) return;
  w.__shineProductBooted = true;

  function mainProductForm() {
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    const usable = forms.filter(
      (f) => !/installment/i.test(f.id || "") && !!(/** @type {HTMLFormElement} */ (f).elements.namedItem("id")),
    );
    return /** @type {HTMLFormElement|null} */ (usable.find((f) => f.closest("main")) || usable[0] || null);
  }

  function mountFallback() {
    const tpl = /** @type {HTMLTemplateElement|null} */ (document.querySelector("template[data-shine-fallback]"));
    if (!tpl || tpl.dataset.mounted || document.querySelector("[data-shine-root]")) return;
    const form = mainProductForm();
    if (!form) return;
    const frag = /** @type {DocumentFragment} */ (tpl.content.cloneNode(true));
    const root = frag.querySelector("[data-shine-root]");
    if (!root) return;
    const submit = form.querySelector('[type="submit"][name="add"], button[name="add"], [type="submit"]');
    let anchor = /** @type {Element|null} */ (submit);
    while (anchor && anchor.parentElement && anchor.parentElement !== form) anchor = anchor.parentElement;
    if (anchor && anchor.parentElement === form) form.insertBefore(frag, anchor);
    else form.appendChild(frag);
    tpl.dataset.mounted = "1";
    initRoot(root);
  }

  function scan() {
    document.querySelectorAll("[data-shine-root]").forEach((root) => initRoot(root));
    mountFallback();
  }

  installSubmitGuards();
  scan();

  // Theme editor reloads, quick-add modals, infinite scroll and section re-renders add new roots.
  let queued = false;
  new MutationObserver((records) => {
    if (queued) return;
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n.nodeType !== 1) continue;
        const el = /** @type {Element} */ (n);
        if (el.matches("[data-shine-root], form") || el.querySelector("[data-shine-root]")) {
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            scan();
            CONTROLLERS.forEach((c) => c.poll());
          });
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  w.ShineOptions = { scan, findProductForm };
})();
