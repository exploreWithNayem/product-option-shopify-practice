// @ts-check
/**
 * One controller per rendered option set (app block, or embed fallback).
 * Reads the Liquid-rendered fields, keeps the product form's hidden line item
 * properties in sync, shows live prices and the live total, and blocks
 * add-to-cart / Buy it now until the choices are valid.
 */
import {
  PROPERTY_KEY,
  computeVisibility,
  displayEntries,
  effectiveAnswers,
  encodeSelection,
  hasPricedFields,
  isDisplayType,
  isMultiSelect,
  lineTotalMinor,
  normalizeAnswer,
  quoteAddons,
  toMinor,
  validateAnswers,
  variantKey,
} from "../shared/options-core.js";
import { DEFAULT_STRINGS, fill, issueMessage, makeMoney, parseRate, propertyKey, safeFont, safeHex } from "./format.js";

/**
 * Date and upload widgets ship as separate deferred scripts that Liquid adds only when the set
 * uses them (snippets/shine-scripts.liquid); they register on window.__shineWidgets first.
 * @typedef {typeof import("./datepicker.js").createDatePicker} CreateDatePicker
 * @typedef {typeof import("./upload.js").createUploader} CreateUploader
 * @typedef {typeof import("./layer.js").createLayer} CreateLayer
 * @returns {{ date?: CreateDatePicker, upload?: CreateUploader, layer?: CreateLayer }}
 */
const widgets = () => /** @type {any} */ (window).__shineWidgets || {};

/** Answers survive theme re-renders of the product section (Dawn swaps product-info on variant change). */
const STATE = /** @type {Record<string, any>} */ ((window.__shineState = window.__shineState || {}));
/** @type {Set<Controller>} */
export const CONTROLLERS = new Set();

const EMPTY_QUOTE = { lines: [], perItemMinor: 0, perLineMinor: 0 };
const PAYMENT_BUTTONS =
  ".shopify-payment-button, shopify-buy-it-now-button, shopify-accelerated-checkout, [data-shopify='payment-button']";

/** @param {Element} root */
export function initRoot(root) {
  const el = /** @type {any} */ (root);
  if (el.__shine) return el.__shine;
  let data;
  try {
    data = JSON.parse(root.getAttribute("data-shine") || "{}");
  } catch {
    return null;
  }
  if (!data || !data.set || !Array.isArray(data.set.fields)) return null;
  el.__shine = new Controller(/** @type {HTMLElement} */ (root), data);
  CONTROLLERS.add(el.__shine);
  return el.__shine;
}

/** Find the product form that belongs to an element. @param {Element} from */
export function findProductForm(from) {
  /** @param {Element|null} f */
  const usable = (f) =>
    !!f &&
    /\/cart\/add/.test(f.getAttribute("action") || "") &&
    !/installment/i.test(f.id || "") &&
    !!(/** @type {HTMLFormElement} */ (f).elements.namedItem("id"));
  const own = from.closest("form");
  if (usable(own)) return /** @type {HTMLFormElement} */ (own);
  let scope = from.parentElement;
  while (scope && scope !== document.documentElement) {
    for (const f of Array.from(scope.querySelectorAll('form[action*="/cart/add"]'))) if (usable(f)) return /** @type {HTMLFormElement} */ (f);
    scope = scope.parentElement;
  }
  return null;
}

export class Controller {
  /** @param {HTMLElement} root @param {any} data */
  constructor(root, data) {
    this.root = root;
    this.data = data;
    this.set = data.set;
    this.config = data.config || {};
    this.locale = data.locale || document.documentElement.lang || "en";
    this.fallback = this.set.defaultLocale;
    const cur = /** @type {any} */ (window).Shopify?.currency || {};
    this.currency = cur.active || data.currency || "USD";
    // Shopify.currency.rate converts shop currency -> presentment currency.
    this.rate = this.currency === data.shopCurrency ? 1 : parseRate(cur.rate);
    const overrides = this.config.strings || {};
    this.strings = {
      ...DEFAULT_STRINGS,
      ...(data.strings || {}),
      ...(overrides[this.locale.split("-")[0]] || {}),
      ...(overrides[this.locale] || {}),
    };
    this.money = makeMoney(this.currency, this.locale);
    this.showTotal = data.showTotal !== false;
    this.priced = hasPricedFields(this.set);
    this.key = `${data.productId}:${this.set.id}`;
    /** @type {Record<string, HTMLElement>} */
    this.els = {};
    root.querySelectorAll("[data-shine-field]").forEach((el) => {
      this.els[/** @type {string} */ (el.getAttribute("data-shine-field"))] = /** @type {HTMLElement} */ (el);
    });
    /** @type {Record<string, ReturnType<CreateDatePicker>>} */
    this.dates = {};
    /** @type {Record<string, ReturnType<CreateUploader>>} */
    this.uploads = {};
    this.touched = new Set();
    // Range sliders always hold a value; they count as answered only once moved (or when a default is set).
    this.moved = new Set();
    /** @type {Record<string, ReturnType<CreateLayer>>} */
    this.layers = {};
    this.submitted = false;
    this.sig = "";
    this.propSig = "";
    /** @type {HTMLFormElement|null} */
    this.form = null;
    this.props = document.createElement("div");
    this.props.hidden = true;
    this.props.setAttribute("data-shine-props", "");
    this.live = root.querySelector("[data-shine-live]");

    const onChange = () => this.schedule();
    const maxFilesPlan = Number(this.config.maxFiles) || 0;
    const { date: createDatePicker, upload: createUploader, layer: createLayer } = widgets();
    for (const f of this.set.fields) {
      const el = this.els[f.id];
      if (!el) continue;
      if (f.type === "date" && createDatePicker && el.querySelector("[data-shine-date-toggle]")) {
        this.dates[f.id] = createDatePicker(el, f, { today: data.today, locale: this.locale, strings: this.strings, onChange: () => this.touch(f.id) });
      }
      if (f.type === "design_layer" && createLayer) this.layers[f.id] = createLayer(root);
      if (f.type === "file" && createUploader && el.querySelector("input[type=file]")) {
        const fieldMax = Number(f.settings?.maxFiles) || 1;
        this.uploads[f.id] = createUploader(el, f, {
          uploadUrl: this.config.uploadUrl || "/apps/shine-options/uploads",
          maxMb: Number(this.config.maxUploadMb) || 5,
          maxFiles: maxFilesPlan ? Math.min(fieldMax, maxFilesPlan) : fieldMax,
          productId: data.productId,
          strings: this.strings,
          onChange: () => this.touch(f.id),
        });
      }
    }

    const saved = STATE[this.key];
    if (saved) for (const f of this.set.fields) if (f.id in saved) this.write(f, saved[f.id]);

    // Popup elements (e.g. a size guide): open/close a native <dialog>.
    root.addEventListener("click", (e) => {
      const t = /** @type {Element} */ (e.target);
      const opener = t.closest && t.closest("[data-shine-popup-open]");
      if (opener) {
        const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById(opener.getAttribute("data-shine-popup-open") || ""));
        if (dlg && typeof dlg.showModal === "function") dlg.showModal();
        return;
      }
      const dlg = /** @type {HTMLDialogElement|null} */ (t.closest && t.closest("dialog.shine-popup"));
      if (dlg && (t.closest("[data-shine-popup-close]") || t === dlg)) dlg.close();
    });

    root.addEventListener("input", (e) => {
      this.onInput(e.target);
      onChange();
    });
    root.addEventListener("change", (e) => {
      this.touchFrom(e.target);
      this.onSwatch(e.target);
      onChange();
    });
    root.addEventListener("focusout", (e) => {
      this.touchFrom(e.target);
      onChange();
    });
    this.timer = window.setInterval(() => this.poll(), 400);
    this.update();
  }

  /** Range "moved" tracking and color picker <-> hex sync. @param {EventTarget|null} target */
  onInput(target) {
    const el = /** @type {HTMLInputElement} */ (target);
    if (!el || !el.closest) return;
    const fieldEl = el.closest("[data-shine-field]");
    const id = fieldEl && fieldEl.getAttribute("data-shine-field");
    if (!id) return;
    if (el.type === "range") this.moved.add(id);
    if (el.hasAttribute("data-shine-color")) {
      const hex = /** @type {HTMLInputElement|null} */ (fieldEl.querySelector(".shine-color__hex"));
      if (hex) hex.value = el.value;
    } else if (el.classList.contains("shine-color__hex")) {
      const c = safeHex(el.value);
      const sw = /** @type {HTMLInputElement|null} */ (fieldEl.querySelector("[data-shine-color]"));
      if (c && sw) sw.value = c;
    }
  }

  /** @param {string} id */
  touch(id) {
    this.touched.add(id);
    this.schedule();
  }

  /** @param {EventTarget|null} target */
  touchFrom(target) {
    const el = target && /** @type {Element} */ (target).closest ? /** @type {Element} */ (target).closest("[data-shine-field]") : null;
    if (el) this.touched.add(/** @type {string} */ (el.getAttribute("data-shine-field")));
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.update();
    });
  }

  /** Theme-controlled inputs (variant, selling plan, quantity) change without events we can rely on. */
  poll() {
    if (!this.root.isConnected) {
      window.clearInterval(this.timer);
      CONTROLLERS.delete(this);
      return;
    }
    const ctx = this.context();
    const sig = `${ctx.variantId}|${ctx.sellingPlan}|${ctx.qty}|${this.form ? this.form.isConnected : ""}`;
    if (sig !== this.sig || (this.form && !this.form.contains(this.props))) this.update();
  }

  attach() {
    if (this.form && this.form.isConnected) {
      if (!this.form.contains(this.props)) this.form.appendChild(this.props);
      return;
    }
    this.form = findProductForm(this.root);
    if (this.form) {
      this.form.appendChild(this.props);
      this.propSig = "";
    }
  }

  context() {
    const form = this.form && this.form.isConnected ? this.form : null;
    let variantId = "";
    let sellingPlan = "";
    let qty = 1;
    if (form) {
      const fd = new FormData(form);
      variantId = String(fd.get("id") || "");
      sellingPlan = String(fd.get("selling_plan") || "");
      qty = Math.max(1, parseInt(String(fd.get("quantity") || "1"), 10) || 1);
    }
    if (!variantId) variantId = new URLSearchParams(location.search).get("variant") || String(this.data.variantId || "");
    return { variantId: variantKey(variantId), sellingPlan, qty };
  }

  /** @param {any} f */
  read(f) {
    const el = this.els[f.id];
    if (!el || isDisplayType(f.type)) return undefined;
    switch (f.type) {
      case "range": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        return input && (this.moved.has(f.id) || hasDefault(f)) ? input.value : undefined;
      }
      case "dimension": {
        const w = /** @type {HTMLInputElement|null} */ (el.querySelector('[data-shine-dim="w"]'));
        const h = /** @type {HTMLInputElement|null} */ (el.querySelector('[data-shine-dim="h"]'));
        const wv = w ? w.value.trim() : "";
        const hv = h ? h.value.trim() : "";
        return wv === "" && hv === "" ? undefined : [wv, hv];
      }
      case "text":
      case "textarea":
      case "number":
      case "contact":
      case "time":
      case "color_picker":
      case "dropdown": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        return input ? input.value : undefined;
      }
      case "checkbox":
      case "toggle": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        return input && input.checked ? true : undefined;
      }
      case "date":
        return this.dates[f.id] ? this.dates[f.id].value : undefined;
      case "file":
        return this.uploads[f.id] ? this.uploads[f.id].urls() : undefined;
      default: {
        const checked = Array.from(el.querySelectorAll("input[data-shine-value]:checked")).map((i) => /** @type {HTMLInputElement} */ (i).value);
        return isMultiSelect(f) ? checked : checked[0];
      }
    }
  }

  /** @param {any} f @param {any} value */
  write(f, value) {
    const el = this.els[f.id];
    if (!el || isDisplayType(f.type)) return;
    switch (f.type) {
      case "range": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        if (!input) break;
        if (value === undefined || value === null || value === "") {
          this.moved.delete(f.id);
          input.value = String(hasDefault(f) ? f.settings.default : f.settings?.min ?? 0);
        } else {
          this.moved.add(f.id);
          input.value = String(value);
        }
        break;
      }
      case "dimension": {
        const pair = Array.isArray(value) ? value : [];
        el.querySelectorAll("[data-shine-dim]").forEach((node, i) => {
          const v = pair[i];
          /** @type {HTMLInputElement} */ (node).value = v === undefined || v === null ? "" : String(v);
        });
        break;
      }
      case "color_picker": {
        const hex = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        const sw = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-color]"));
        const c = safeHex(value);
        if (hex) hex.value = value === undefined || value === null ? "" : String(value);
        if (sw) sw.value = c || "#000000";
        break;
      }
      case "time":
      case "text":
      case "textarea":
      case "number":
      case "contact":
      case "dropdown": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        if (input) input.value = value === undefined || value === null ? "" : String(value);
        break;
      }
      case "checkbox":
      case "toggle": {
        const input = /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
        if (input) input.checked = value === true;
        break;
      }
      case "date":
        if (this.dates[f.id]) this.dates[f.id].set(typeof value === "string" ? value : "");
        break;
      case "file":
        if (this.uploads[f.id]) Array.isArray(value) && value.length ? this.uploads[f.id].setUrls(value) : this.uploads[f.id].reset();
        break;
      default: {
        const wanted = new Set((Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String));
        el.querySelectorAll("input[data-shine-value]").forEach((i) => {
          /** @type {HTMLInputElement} */ (i).checked = wanted.has(/** @type {HTMLInputElement} */ (i).value);
        });
      }
    }
  }

  /** Default state of a field (what Liquid rendered before the shopper touched it). @param {any} f */
  defaultAnswer(f) {
    if (f.type === "checkbox" || f.type === "toggle") return f.settings?.defaultOn ? true : undefined;
    if (f.type === "range") return hasDefault(f) ? f.settings.default : undefined;
    if (f.type === "color_picker") return safeHex(f.settings?.default) || undefined;
    const defs = (f.values || []).filter((/** @type {any} */ v) => v.default).map((/** @type {any} */ v) => v.id);
    if (!defs.length) return undefined;
    return isMultiSelect(f) ? defs : defs[0];
  }

  readAll() {
    /** @type {Record<string, any>} */
    const answers = {};
    for (const f of this.set.fields) {
      const v = this.read(f);
      if (v !== undefined) answers[f.id] = v;
    }
    return answers;
  }

  /** @param {number} variantId */
  basePrice(variantId) {
    const prices = this.data.variants || {};
    const p = prices[String(variantId)];
    if (p !== undefined) return Number(p) || 0;
    const first = Object.keys(prices)[0];
    return first ? Number(prices[first]) || 0 : 0;
  }

  update() {
    this.attach();
    const ctx = this.context();
    this.sig = `${ctx.variantId}|${ctx.sellingPlan}|${ctx.qty}|${this.form ? this.form.isConnected : ""}`;
    let answers = this.readAll();

    // Conditions (incl. the selected variant). Fields that become hidden go back to their defaults.
    /** @type {Record<string, any>} */
    const norm = {};
    for (const f of this.set.fields) {
      const v = normalizeAnswer(f, answers[f.id]);
      if (v !== undefined) norm[f.id] = v;
    }
    const visible = computeVisibility(this.set, norm, { variantId: ctx.variantId });
    let reset = false;
    for (const f of this.set.fields) {
      const el = this.els[f.id];
      if (!el) continue;
      const show = !!visible[f.id];
      if (el.hidden === show) {
        el.hidden = !show;
        if (!show) {
          this.write(f, this.defaultAnswer(f));
          this.touched.delete(f.id);
          if (f.type === "image_swatch" && f.settings?.changeImage) this.swapImage(null);
          reset = true;
        }
      }
    }
    if (reset) answers = this.readAll();
    STATE[this.key] = answers;
    const eff = effectiveAnswers(this.set, answers, { variantId: ctx.variantId });

    const subscription = !!ctx.sellingPlan;
    const showPrices = this.priced && !this.config.pricingPaused && !subscription;
    const base = this.basePrice(Number(ctx.variantId));
    const quote = showPrices
      ? quoteAddons(this.set, eff, { variantId: ctx.variantId, baseMinor: base, rate: this.rate, currency: this.currency })
      : EMPTY_QUOTE;

    this.renderPrices(showPrices, base, eff);
    this.renderCounters(answers);
    this.renderRanges();
    this.renderSelected();
    this.renderLayers(eff, visible);
    const notice = /** @type {HTMLElement|null} */ (this.root.querySelector("[data-shine-subscription]"));
    if (notice) notice.hidden = !(subscription && this.priced && !this.config.pricingPaused);
    this.writeProperties(eff);
    this.renderButton(quote, base, ctx.qty);
    this.renderErrors(answers, ctx);
  }

  /** @param {boolean} show @param {number} base @param {Record<string, any>} [eff] */
  renderPrices(show, base, eff = {}) {
    /** @param {string} kind @param {number} amount @param {string} [unit] */
    const text = (kind, amount, unit) => {
      const minor = kind === "percent" ? Math.round((base * amount) / 100) : toMinor(amount * this.rate, this.currency);
      const key = kind === "per_char" ? "per_char" : kind === "per_unit" ? "per_unit" : kind === "per_area" ? "per_area" : "price";
      return fill(this.strings[key], { price: this.money(minor), unit: unit || "" });
    };
    this.root.querySelectorAll("[data-shine-price]").forEach((node) => {
      const el = /** @type {HTMLElement} */ (node);
      el.hidden = !show;
      if (!show) return;
      const kind = el.dataset.kind || "fixed";
      const amount = Number(el.dataset.amount) || 0;
      let s = text(kind, amount, el.dataset.unit);
      if (kind === "per_area") {
        // Once both sides are in, show what this size adds: "+$96.00".
        const fieldEl = el.closest("[data-shine-field]");
        const a = fieldEl ? eff[/** @type {string} */ (fieldEl.getAttribute("data-shine-field"))] : undefined;
        if (Array.isArray(a) && Number(a[0]) > 0 && Number(a[1]) > 0) {
          const minor = Math.round(amount * this.rate * Number(a[0]) * Number(a[1]) * Math.pow(10, decimals(this.currency)));
          s = fill(this.strings.price, { price: this.money(minor) });
        }
      }
      if (el.textContent !== s) el.textContent = s;
    });
    this.root.querySelectorAll("option[data-amount]").forEach((node) => {
      const o = /** @type {HTMLOptionElement} */ (node);
      const label = o.dataset.label || "";
      const s = show ? `${label} (${text(o.dataset.kind || "fixed", Number(o.dataset.amount) || 0)})` : label;
      if (o.textContent !== s) o.textContent = s;
    });
  }

  /** @param {Record<string, any>} answers */
  renderCounters(answers) {
    for (const f of this.set.fields) {
      const max = Number(f.settings?.maxLength);
      if (!max || (f.type !== "text" && f.type !== "textarea")) continue;
      const el = this.els[f.id] && this.els[f.id].querySelector("[data-shine-count]");
      if (!el) continue;
      const used = Array.from(String(answers[f.id] || "")).length;
      const s = fill(this.strings.counter, { used, max });
      if (el.textContent !== s) el.textContent = s;
      el.classList.toggle("is-full", used >= max);
    }
  }

  /** Live value beside each range slider. */
  renderRanges() {
    for (const f of this.set.fields) {
      if (f.type !== "range") continue;
      const el = this.els[f.id];
      const input = el && /** @type {HTMLInputElement|null} */ (el.querySelector("[data-shine-input]"));
      const out = el && el.querySelector("[data-shine-range-value]");
      if (!input || !out) continue;
      const s = f.settings?.unit ? `${input.value} ${f.settings.unit}` : input.value;
      if (out.textContent !== s) out.textContent = s;
      input.setAttribute("aria-valuetext", s);
    }
  }

  /** Design layers: the shopper's text over the product image. @param {Record<string, any>} eff @param {Record<string, boolean>} visible */
  renderLayers(eff, visible) {
    for (const id of Object.keys(this.layers)) {
      const f = this.set.fields.find((/** @type {any} */ x) => x.id === id);
      if (!f) continue;
      const st = f.settings || {};
      const text = eff[st.sourceField];
      const fontField = st.fontField ? this.set.fields.find((/** @type {any} */ x) => x.id === st.fontField) : null;
      const fontValue = fontField && (fontField.values || []).find((/** @type {any} */ v) => v.id === eff[st.fontField]);
      const colorField = st.colorField ? this.set.fields.find((/** @type {any} */ x) => x.id === st.colorField) : null;
      let color = "";
      if (colorField && colorField.type === "color_picker") color = safeHex(eff[st.colorField]);
      else if (colorField && colorField.type === "color_swatch") {
        const v = (colorField.values || []).find((/** @type {any} */ x) => x.id === eff[st.colorField]);
        color = safeHex(v && v.color);
      }
      try {
        this.layers[id].render({
          text: typeof text === "string" ? text : "",
          visible: !!visible[id],
          font: safeFont(fontValue && fontValue.font) || safeFont(st.font),
          color: color || safeHex(st.color) || "#000000",
          x: Number(st.x ?? 50),
          y: Number(st.y ?? 50),
          size: Number(st.size ?? 8),
          align: st.align === "left" || st.align === "right" ? st.align : "center",
        });
      } catch {
        /* a theme without a findable image just gets no overlay */
      }
    }
  }

  /** Swatch legends show the chosen name, so a choice is never color-only. */
  renderSelected() {
    for (const f of this.set.fields) {
      if (f.type !== "color_swatch" && f.type !== "image_swatch") continue;
      const el = this.els[f.id];
      const out = el && el.querySelector("[data-shine-selected]");
      if (!out) continue;
      const names = Array.from(el.querySelectorAll("input[data-shine-value]:checked")).map((i) => /** @type {HTMLElement} */ (i).dataset.label || "");
      out.textContent = names.length ? `: ${names.join(", ")}` : "";
    }
  }

  /** @param {Record<string, any>} eff */
  writeProperties(eff) {
    if (!this.form) return;
    /** @type {[string, string][]} */
    const pairs = [];
    if (Object.keys(eff).length) {
      pairs.push([PROPERTY_KEY, encodeSelection(this.set, eff)]);
      for (const e of displayEntries(this.set, eff, { locale: this.locale, yes: this.strings.yes })) pairs.push([propertyKey(e.key), e.value]);
    }
    const sig = JSON.stringify(pairs);
    if (sig === this.propSig && this.form.contains(this.props) && this.props.childElementCount === pairs.length) return;
    this.propSig = sig;
    this.props.textContent = "";
    for (const [k, v] of pairs) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = `properties[${k}]`;
      input.value = v;
      this.props.appendChild(input);
    }
  }

  addButton() {
    if (!this.form) return null;
    return /** @type {HTMLButtonElement|null} */ (
      this.form.querySelector('[type="submit"][name="add"], button[name="add"], [type="submit"]:not([name="checkout"])') ||
        (this.form.id ? document.querySelector(`[form="${CSS.escape(this.form.id)}"][type="submit"]`) : null)
    );
  }

  /** @param {any} quote @param {number} base @param {number} qty */
  renderButton(quote, base, qty) {
    const btn = this.addButton();
    if (!btn || !this.showTotal) return;
    const node = firstText(btn);
    if (!node) return;
    const current = node.nodeValue || "";
    const ds = btn.dataset;
    // The theme changes the text too (Sold out, Unavailable): take its latest text as the original.
    if (ds.shineLast === undefined || current !== ds.shineLast) ds.shineOrig = current;
    const orig = ds.shineOrig || current;
    const unavailable = btn.disabled || btn.getAttribute("aria-disabled") === "true";
    const addon = quote.perItemMinor + quote.perLineMinor;
    let next = orig;
    if (addon > 0 && !unavailable) {
      const lead = (orig.match(/^\s*/) || [""])[0];
      const trail = (orig.match(/\s*$/) || [""])[0];
      next = lead + fill(this.strings.add_to_cart, { total: this.money(lineTotalMinor(base, quote, qty)) }) + trail;
    }
    if (current !== next) node.nodeValue = next;
    ds.shineLast = next;
  }

  /** @param {Record<string, any>} answers @param {{variantId:string}} ctx */
  issues(answers, ctx) {
    const planMax = Number(this.config.maxFiles) || undefined;
    return validateAnswers(this.set, answers, { variantId: ctx.variantId, today: this.data.today, maxFiles: planMax });
  }

  /** @param {Record<string, any>} answers @param {{variantId:string}} ctx */
  renderErrors(answers, ctx) {
    /** @type {Record<string, string>} */
    const byField = {};
    for (const issue of this.issues(answers, ctx)) {
      if (byField[issue.fieldId]) continue;
      if (issue.code === "required" && !this.submitted) continue;
      if (!this.submitted && !this.touched.has(issue.fieldId)) continue;
      const f = this.set.fields.find((/** @type {any} */ x) => x.id === issue.fieldId);
      byField[issue.fieldId] = issueMessage(issue, f, this.strings, this.locale, this.fallback);
    }
    for (const f of this.set.fields) {
      const el = this.els[f.id];
      if (!el || isDisplayType(f.type)) continue;
      const uploading = !!this.uploads[f.id] && this.uploads[f.id].pending();
      let msg = uploading ? (this.submitted ? this.strings.upload_wait : "") : byField[f.id] || "";
      const slot = el.querySelector("[data-shine-error]");
      if (slot && slot.textContent !== msg) slot.textContent = msg;
      el.classList.toggle("shine-field--invalid", !!msg);
      el.querySelectorAll("input:not([type=hidden]), select, textarea, [data-shine-date-toggle]").forEach((i) => {
        if (msg) i.setAttribute("aria-invalid", "true");
        else i.removeAttribute("aria-invalid");
      });
    }
  }

  /**
   * Called before add to cart / Buy it now. Returns false (and shows why) when the choices aren't ready.
   */
  check() {
    this.submitted = true;
    this.update();
    const ctx = this.context();
    const answers = this.readAll();
    const pending = Object.keys(this.uploads).find((id) => this.uploads[id].pending() && !this.els[id].hidden);
    const issues = this.issues(answers, ctx);
    const firstId = pending || (issues[0] && issues[0].fieldId);
    if (!firstId) return true;
    if (this.live) this.live.textContent = pending ? this.strings.upload_wait : this.strings.errors;
    const el = this.els[firstId];
    if (el) {
      const group = /** @type {HTMLDetailsElement|null} */ (el.closest("details.shine-group"));
      if (group && !group.open) group.open = true;
      const target = /** @type {HTMLElement|null} */ (
        el.querySelector("input:not([type=hidden]):not([disabled]), select, textarea, [data-shine-date-toggle]")
      );
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (target) target.focus({ preventScroll: true });
    }
    return false;
  }

  /** Image swatch: optionally show the chosen image as the main product image. @param {EventTarget|null} target */
  onSwatch(target) {
    const input = /** @type {HTMLInputElement} */ (target);
    if (!input || !input.dataset || input.dataset.image === undefined) return;
    const fieldEl = input.closest("[data-shine-field]");
    const f = fieldEl && this.set.fields.find((/** @type {any} */ x) => x.id === fieldEl.getAttribute("data-shine-field"));
    if (!f || !f.settings?.changeImage) return;
    this.swapImage(input.checked ? input.dataset.image || null : null);
  }

  /** @param {string|null} url */
  swapImage(url) {
    const scope = this.root.closest(".shopify-section, product-info, section") || document;
    const img = /** @type {HTMLImageElement|null} */ (
      scope.querySelector(
        ".product__media-item.is-active img, .product__media img, media-gallery img, .product-media img, slideshow-slide img, .product-gallery img, [data-media-id] img",
      )
    );
    if (!img) return;
    const ds = img.dataset;
    if (ds.shineSrc === undefined) {
      ds.shineSrc = img.getAttribute("src") || "";
      ds.shineSrcset = img.getAttribute("srcset") || "";
    }
    if (url && /^(https:)?\/\//.test(url)) {
      img.removeAttribute("srcset");
      img.src = url;
    } else {
      img.src = ds.shineSrc || img.src;
      if (ds.shineSrcset) img.setAttribute("srcset", ds.shineSrcset);
    }
  }
}

/** First non-empty text node inside an element (the visible label of an add-to-cart button). @param {Element} el */
function firstText(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest("[hidden], .hidden, .visually-hidden, .loading__spinner, svg, template")) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  return walker.nextNode();
}

/** Controller that owns a form (for submit / Buy it now interception). @param {Element|null} form */
export function controllerForForm(form) {
  if (!form) return null;
  for (const c of CONTROLLERS) if (c.form === form && c.root.isConnected) return c;
  return null;
}

/** Install the capture-phase guards once. */
export function installSubmitGuards() {
  /** @param {Event} e @param {Controller|null} c */
  const block = (e, c) => {
    if (!c || c.check()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  document.addEventListener(
    "submit",
    (e) => {
      const form = /** @type {HTMLFormElement} */ (e.target);
      block(e, controllerForForm(form));
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      const target = /** @type {Element} */ (e.target);
      if (!target || !target.closest) return;
      const pay = target.closest(PAYMENT_BUTTONS);
      const submit = target.closest('[type="submit"], button[name="add"]');
      if (!pay && !submit) return;
      const holder = /** @type {HTMLButtonElement} */ (pay || submit);
      let form = holder.closest("form");
      if (!form && submit && /** @type {HTMLButtonElement} */ (submit).form) form = /** @type {HTMLButtonElement} */ (submit).form;
      const c = controllerForForm(form);
      if (!c && pay) {
        // Buy it now rendered outside the form: match the controller in the same section.
        for (const x of CONTROLLERS) {
          const section = x.root.closest(".shopify-section");
          if (section && section.contains(pay)) return block(e, x);
        }
        return;
      }
      block(e, c);
    },
    true,
  );
}


/** A range slider with a merchant default counts as answered from the start. @param {any} f */
function hasDefault(f) {
  const d = f.settings && f.settings.default;
  return d !== undefined && d !== null && d !== "";
}

/** @param {string} currency */
function decimals(currency) {
  return toMinor(1, currency) === 1 ? 0 : 2;
}
