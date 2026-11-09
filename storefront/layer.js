// @ts-check
/**
 * Design layer: overlays the shopper's text on the main product image (a live
 * personalization preview). Loaded only when the option set has a design layer
 * (see snippets/shine-scripts.liquid). Never throws when no image is found; the
 * theme simply gets no overlay.
 */

/** Main product image candidates, most specific first. */
export const IMAGE_SELECTORS = [
  "[data-media-id] img",
  ".product__media img",
  "media-gallery img",
  ".product-media img",
  'img[src*="/products/"]',
];

/**
 * Where to place the overlay inside its container, in px.
 * x / y are % of the image box (the text is centered on that point); size is the
 * font size as % of the image width.
 * @param {{ left: number, top: number, width: number, height: number }} img
 * @param {{ left: number, top: number }} container
 * @param {{ x: number, y: number, size: number }} o
 */
export function layerBox(img, container, o) {
  const pct = (/** @type {number} */ v, /** @type {number} */ d) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d);
  return {
    left: img.left - container.left + (img.width * pct(o.x, 50)) / 100,
    top: img.top - container.top + (img.height * pct(o.y, 50)) / 100,
    fontSize: Math.max(8, (img.width * Math.min(40, Math.max(1, Number(o.size) || 8))) / 100),
    maxWidth: img.width * 0.9,
  };
}

/** @param {Element} img */
const shown = (img) => {
  const r = img.getBoundingClientRect();
  return r.width > 40 && r.height > 40;
};

/** @param {Element} root  the option set root ([data-shine-root]) */
function findImage(root) {
  const scope = root.closest(".shopify-section, product-info, section, main") || document;
  for (const sel of IMAGE_SELECTORS) {
    for (const node of Array.from(scope.querySelectorAll(sel))) {
      if (shown(node)) return /** @type {HTMLImageElement} */ (node);
    }
  }
  return null;
}

/** @param {Element} root */
export function createLayer(root) {
  const overlay = document.createElement("div");
  overlay.className = "shine-layer";
  overlay.setAttribute("aria-hidden", "true");
  overlay.hidden = true;
  /** @type {HTMLImageElement|null} */
  let img = null;
  /** @type {any} */
  let last = null;
  /** @type {ResizeObserver|null} */
  let ro = null;

  const place = () => {
    if (!last || !img || !img.isConnected || overlay.hidden) return;
    const container = /** @type {HTMLElement} */ (overlay.parentElement);
    if (!container) return;
    const box = layerBox(img.getBoundingClientRect(), container.getBoundingClientRect(), last);
    overlay.style.left = `${box.left}px`;
    overlay.style.top = `${box.top}px`;
    overlay.style.fontSize = `${box.fontSize}px`;
    overlay.style.maxWidth = `${box.maxWidth}px`;
  };

  const attach = () => {
    if (img && img.isConnected && overlay.isConnected) return true;
    img = findImage(root);
    if (!img || !img.parentElement) return false;
    const container = img.parentElement;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(overlay);
    img.addEventListener("load", place);
    if (typeof ResizeObserver !== "undefined") {
      if (ro) ro.disconnect();
      ro = new ResizeObserver(place);
      ro.observe(img);
    } else {
      window.addEventListener("resize", place);
    }
    return true;
  };

  return {
    /** @param {{ text: string, visible: boolean, font: string, color: string, x: number, y: number, size: number, align: string }} o */
    render(o) {
      last = o;
      const text = String(o.text || "");
      if (!o.visible || !text.trim()) {
        overlay.hidden = true;
        return;
      }
      if (!attach()) return;
      overlay.hidden = false;
      if (overlay.textContent !== text) overlay.textContent = text;
      overlay.style.color = o.color;
      overlay.style.fontFamily = o.font || "";
      overlay.style.textAlign = o.align;
      place();
    },
  };
}
