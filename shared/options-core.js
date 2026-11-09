// @ts-check
/**
 * Shine Options core: the single source of truth for option-set logic.
 *
 * Pure functions only (no DOM, no network, no clock). The same module is used by:
 *  - the storefront script (live prices, client-side validation, cart properties)
 *  - the admin live preview
 *  - the server (metafield sync, analytics)
 *  - the Cart Transform and Validation Functions (authoritative pricing + checks)
 *
 * Money: option-set prices are stored as decimal numbers in the SHOP currency.
 * Every computed amount is returned in integer minor units of the PRESENTMENT
 * currency (the shopper's currency), so the storefront and the Functions round
 * identically.
 */

export const PROPERTY_KEY = "_shine_options";
export const METAFIELD_NAMESPACE = "$app";
export const METAFIELD_OPTIONS_KEY = "options"; // full set for the theme
export const METAFIELD_PRICING_KEY = "pricing"; // lean set for the Functions
export const METAFIELD_CONFIG_KEY = "config";

/** @typedef {"text"|"textarea"|"number"|"dropdown"|"radio"|"checkbox"|"checkbox_group"|"toggle"|"buttons"|"color_swatch"|"image_swatch"|"date"|"file"|"contact"|"heading"|"paragraph"|"divider"|"spacer"|"popup"|"font_picker"|"product_list"|"range"|"dimension"|"time"|"color_picker"|"group"|"design_layer"} FieldType */

/**
 * @typedef {string | Record<string, string>} Localized
 *
 * @typedef {{ id: string, label: Localized, price?: number, priceType?: "fixed"|"percent", color?: string, image?: string, default?: boolean }} FieldValue
 * @typedef {{ source: "field"|"variant", field?: string, op: "is"|"is_not"|"empty"|"not_empty"|"contains"|"gt"|"lt", value?: any }} ConditionRule
 * @typedef {{ action: "show"|"hide", match: "all"|"any", rules: ConditionRule[] }} Condition
 * @typedef {{ type: "fixed"|"percent"|"per_char"|"per_unit", amount: number }} PriceRule
 *
 * @typedef {{
 *   id: string,
 *   type: FieldType,
 *   label: Localized,
 *   help?: Localized,
 *   placeholder?: Localized,
 *   required?: boolean,
 *   condition?: Condition | null,
 *   price?: PriceRule | null,
 *   scope?: "item"|"line",
 *   values?: FieldValue[],
 *   settings?: Record<string, any>,
 * }} Field
 *
 * @typedef {{ id: string, v: number, name?: string, defaultLocale?: string, fields: Field[] }} OptionSet
 * @typedef {Record<string, any>} Answers
 * @typedef {{ fieldId: string, code: string, params?: Record<string, any> }} ValidationIssue
 */

export const FIELD_TYPES = /** @type {FieldType[]} */ ([
  "text",
  "textarea",
  "number",
  "dropdown",
  "radio",
  "checkbox",
  "checkbox_group",
  "toggle",
  "buttons",
  "color_swatch",
  "image_swatch",
  "date",
  "file",
  "contact",
  "font_picker",
  "product_list",
  "range",
  "dimension",
  "time",
  "color_picker",
  // Display-only elements: no answer, no price, never required.
  "heading",
  "paragraph",
  "divider",
  "spacer",
  "popup",
  "group",
  "design_layer",
]);

/** Layout and content elements shoppers read but don't fill in. */
export const DISPLAY_TYPES = new Set(["heading", "paragraph", "divider", "spacer", "popup", "group", "design_layer"]);

/** @param {string} type */
export function isDisplayType(type) {
  return DISPLAY_TYPES.has(type);
}

const CHOICE_TYPES = new Set([
  "dropdown",
  "radio",
  "checkbox_group",
  "buttons",
  "color_swatch",
  "image_swatch",
  "font_picker",
  "product_list",
]);

/** Which price rule types each non-choice field type accepts (PRD "Option types" table). */
export const PRICE_TYPES_BY_FIELD = {
  text: ["fixed", "per_char"],
  textarea: ["fixed"],
  number: ["fixed", "per_unit"],
  checkbox: ["fixed", "percent"],
  toggle: ["fixed", "percent"],
  date: ["fixed"],
  file: ["fixed"],
  contact: [],
  range: ["fixed", "per_unit"],
  dimension: ["fixed", "per_area"],
  time: ["fixed"],
  color_picker: ["fixed"],
};

/** Currencies with no minor unit. Everything else rounds to 2 decimals. */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** @param {string | undefined | null} currency */
export function currencyDecimals(currency) {
  return currency && ZERO_DECIMAL.has(String(currency).toUpperCase()) ? 0 : 2;
}

/** @param {number} major @param {string} [currency] */
export function toMinor(major, currency) {
  const d = currencyDecimals(currency);
  return Math.round((Number(major) || 0) * Math.pow(10, d) + Number.EPSILON);
}

/** @param {number} minor @param {string} [currency] */
export function fromMinor(minor, currency) {
  const d = currencyDecimals(currency);
  return (minor / Math.pow(10, d)).toFixed(d);
}

/** @param {FieldType} type */
export function isChoiceType(type) {
  return CHOICE_TYPES.has(type);
}

/** @param {Field} field */
export function isMultiSelect(field) {
  return (
    field.type === "checkbox_group" ||
    ((field.type === "buttons" || field.type === "product_list") && !!field.settings?.multiple)
  );
}

/**
 * Pick a translation. Accepts a plain string or a locale map.
 * @param {Localized | undefined | null} value
 * @param {string} [locale]
 * @param {string} [fallbackLocale]
 */
export function t(value, locale, fallbackLocale) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (locale) {
    if (value[locale]) return value[locale];
    const short = locale.split("-")[0];
    if (value[short]) return value[short];
  }
  if (fallbackLocale && value[fallbackLocale]) return value[fallbackLocale];
  for (const k in value) if (value[k]) return value[k];
  return "";
}

/** @param {any} answer */
export function isEmpty(answer) {
  if (answer === undefined || answer === null || answer === false) return true;
  if (typeof answer === "string") return answer.trim() === "";
  if (Array.isArray(answer)) return answer.length === 0;
  if (typeof answer === "number") return Number.isNaN(answer);
  return false;
}

/** Normalize a variant id ("gid://shopify/ProductVariant/123" or 123) to "123". */
export function variantKey(id) {
  if (id === undefined || id === null) return "";
  const s = String(id);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Strings from a raw answer, empties dropped, first occurrence kept.
 * @param {any} raw
 */
function uniqueStrings(raw) {
  const src = Array.isArray(raw) ? raw : [raw];
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const s = String(src[i]);
    if (s !== "" && out.indexOf(s) < 0) out.push(s);
  }
  return out.length ? out : undefined;
}

/**
 * Coerce a raw answer into its canonical shape for the field type.
 * @param {Field} field
 * @param {any} raw
 */
export function normalizeAnswer(field, raw) {
  if (raw === undefined || raw === null || DISPLAY_TYPES.has(field.type)) return undefined;
  switch (field.type) {
    case "number": {
      if (raw === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
    case "toggle":
      return raw === true || raw === "true" || raw === "on" || raw === 1 ? true : undefined;
    case "checkbox_group":
    case "file":
      return uniqueStrings(raw);
    case "range": {
      if (raw === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "dimension": {
      let w;
      let h;
      if (Array.isArray(raw)) [w, h] = raw;
      else if (typeof raw === "object") {
        w = raw.w ?? raw.width;
        h = raw.h ?? raw.height;
      } else {
        const m = DIMENSION_RE.exec(String(raw));
        if (m) [, w, h] = m;
      }
      const blank = (v) => v === undefined || v === null || v === "";
      if (blank(w) && blank(h)) return undefined;
      const num = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
      return [num(w), num(h)];
    }
    case "time": {
      const m = TIME_RE.exec(String(raw).trim());
      if (!m) return String(raw).trim() || undefined;
      return `${m[1].padStart(2, "0")}:${m[2]}`;
    }
    case "color_picker": {
      let c = String(raw).trim().toLowerCase();
      if (!c) return undefined;
      if (/^#[0-9a-f]{3}$/.test(c)) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
      return c;
    }
    case "buttons":
    case "product_list": {
      if (field.settings?.multiple) return uniqueStrings(raw);
      const s = Array.isArray(raw) ? raw[0] : raw;
      return s === undefined || s === "" ? undefined : String(s);
    }
    case "textarea": {
      let s = String(raw);
      if (s.indexOf("\r") >= 0) s = s.replace(CRLF_RE, "\n");
      s = s.trim();
      return s === "" ? undefined : s;
    }
    default: {
      const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
      return s === "" ? undefined : s;
    }
  }
}

const CRLF_RE = /\r\n/g;
const DIMENSION_RE = /^\s*([\d.]+)\s*[x×*]\s*([\d.]+)/i;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

/** "HH:MM" -> minutes after midnight, or NaN. */
export function timeMinutes(s) {
  const m = TIME_RE.exec(String(s || "").trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : NaN;
}

/** Time slots a time field offers ("HH:MM"), from start to end every interval minutes. */
export function timeSlots(field) {
  const s = field.settings || {};
  const start = timeMinutes(s.start || "09:00");
  const end = timeMinutes(s.end || "17:00");
  const step = Math.max(5, Math.floor(Number(s.interval) || 30));
  /** @type {string[]} */
  const out = [];
  if (Number.isNaN(start) || Number.isNaN(end)) return out;
  for (let m = start; m <= end && out.length < 288; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * @param {any[]} list
 * @param {any} wanted
 */
function includesAsString(list, wanted) {
  const w = String(wanted);
  for (let i = 0; i < list.length; i++) if (String(list[i]) === w) return true;
  return false;
}

/**
 * @param {ConditionRule} rule
 * @param {Answers} answers
 * @param {string} variantId already passed through variantKey()
 */
function evalRule(rule, answers, variantId) {
  if (rule.source === "variant") {
    let hit = false;
    if (Array.isArray(rule.value)) {
      for (let i = 0; i < rule.value.length && !hit; i++) hit = variantKey(rule.value[i]) === variantId;
    } else {
      hit = variantKey(rule.value) === variantId;
    }
    return rule.op === "is_not" ? !hit : hit;
  }
  const a = rule.field ? answers[rule.field] : undefined;
  switch (rule.op) {
    case "empty":
      return isEmpty(a);
    case "not_empty":
      return !isEmpty(a);
    case "is":
    case "is_not": {
      let hit;
      if (Array.isArray(a)) hit = includesAsString(a, rule.value);
      else if (a === true) hit = rule.value === true || rule.value === "true";
      else hit = !isEmpty(a) && String(a) === String(rule.value);
      return rule.op === "is" ? hit : !hit;
    }
    case "contains":
      if (Array.isArray(a)) return includesAsString(a, rule.value);
      return typeof a === "string" && a.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "gt":
      return !isEmpty(a) && Number(a) > Number(rule.value);
    case "lt":
      return !isEmpty(a) && Number(a) < Number(rule.value);
    default:
      return false;
  }
}

/**
 * Does a field's condition let it show? Rules that read a field already
 * evaluated see only its visible answer; any other field is read from `all`.
 * @param {Condition | null | undefined} c
 * @param {Record<string, boolean>} visible  fields evaluated so far
 * @param {Answers} effective  answers of visible fields evaluated so far
 * @param {Answers} all
 * @param {string} variantId  keyed
 */
function conditionShows(c, visible, effective, all, variantId) {
  if (!c || !Array.isArray(c.rules) || c.rules.length === 0) return true;
  const any = c.match === "any";
  let matched = !any;
  for (let i = 0; i < c.rules.length; i++) {
    const r = c.rules[i];
    const ok = evalRule(r, r.field && r.field in visible ? effective : all, variantId);
    if (any && ok) {
      matched = true;
      break;
    }
    if (!any && !ok) {
      matched = false;
      break;
    }
  }
  return c.action === "hide" ? !matched : matched;
}

/**
 * Visibility of every field, evaluated in order. A rule that reads a hidden
 * field sees an empty answer, so chains of conditions collapse correctly.
 * @param {OptionSet} set
 * @param {Answers} answers
 * @param {{ variantId?: string|number }} [ctx]
 * @returns {Record<string, boolean>}
 */
export function computeVisibility(set, answers, ctx = {}) {
  /** @type {Record<string, boolean>} */
  const visible = {};
  /** @type {Answers} */
  const effective = {};
  const variantId = variantKey(ctx.variantId);
  // Options after an option group belong to it until the next group: a hidden group hides them all.
  let groupOn = true;
  for (const field of set.fields || []) {
    // A field the merchant switched off (eye icon) is never shown, required or priced.
    const own = !field.hidden && conditionShows(field.condition, visible, effective, answers, variantId);
    const show = field.type === "group" ? own : groupOn && own;
    if (field.type === "group") groupOn = own;
    visible[field.id] = show;
    if (show) effective[field.id] = answers[field.id];
  }
  return visible;
}

/**
 * Answers with hidden fields removed and every value normalized.
 * Hidden fields are never required and never priced (PRD F4).
 * @param {OptionSet} set
 * @param {Answers} answers
 * @param {{ variantId?: string|number }} [ctx]
 */
export function effectiveAnswers(set, answers, ctx = {}) {
  return evaluateSelection(set, answers, { variantId: ctx.variantId, noQuote: true }).answers;
}

/** Is this UTF-16 code unit whitespace, exactly as the regex class \s defines it? @param {number} c */
function isSpaceCode(c) {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 160) return false;
  return (
    c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 ||
    c === 8239 || c === 8287 || c === 12288 || c === 65279
  );
}

/**
 * Number of code points (what Array.from(str).length returns), optionally
 * skipping whitespace. A plain loop: string iterators are slow in Functions.
 * @param {string} s
 * @param {boolean} [skipSpace]
 */
function codePointCount(s, skipSpace) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    } else if (skipSpace && isSpaceCode(c)) {
      continue;
    }
    n++;
  }
  return n;
}

/** Count characters that are charged for per-character pricing (whitespace is free). */
export function chargeableChars(text) {
  return codePointCount(String(text || ""), true);
}

/**
 * @typedef {{ fieldId: string, valueId?: string, amountMinor: number, scope: "item"|"line", variantId?: string }} PriceLine
 *   variantId: set for product-list picks; checkout adds that real product (own inventory) at this price.
 * @typedef {{ lines: PriceLine[], perItemMinor: number, perLineMinor: number }} AddonQuote
 * @typedef {{ rate: number, mult: number, base: number }} Pricer
 */

/**
 * @param {{ baseMinor?: number, rate?: number|string, currency?: string }} ctx
 * @returns {Pricer}
 */
function makePricer(ctx) {
  return {
    rate: Number(ctx.rate ?? 1) || 1,
    mult: Math.pow(10, currencyDecimals(ctx.currency)),
    base: Math.max(0, Math.round(ctx.baseMinor || 0)),
  };
}

/** Shop-currency amount -> presentment minor units (same rounding as toMinor). @param {Pricer} p @param {any} amount */
function fixedMinor(p, amount) {
  return Math.round((Number(amount) || 0) * p.rate * p.mult + Number.EPSILON);
}

/** @param {Pricer} p @param {any} pct */
function percentMinor(p, pct) {
  return Math.round((p.base * (Number(pct) || 0)) / 100);
}

/**
 * @param {AddonQuote} quote
 * @param {string} fieldId
 * @param {string | undefined} valueId
 * @param {number} amountMinor
 * @param {"item"|"line"} scope
 */
function addPriceLine(quote, fieldId, valueId, amountMinor, scope, variantId) {
  if (!(amountMinor > 0)) return;
  quote.lines.push(variantId ? { fieldId, valueId, amountMinor, scope, variantId } : { fieldId, valueId, amountMinor, scope });
  if (scope === "line") quote.perLineMinor += amountMinor;
  else quote.perItemMinor += amountMinor;
}

/**
 * Price one visible, non-empty, normalized answer into the quote.
 * @param {AddonQuote} quote
 * @param {Field} field
 * @param {any} a
 * @param {Pricer} p
 */
function priceField(quote, field, a, p) {
  const scope = field.scope === "line" ? "line" : "item";
  if (CHOICE_TYPES.has(field.type)) {
    const values = field.values;
    if (!values || values.length === 0) return;
    const many = Array.isArray(a);
    const count = many ? a.length : 1;
    for (let i = 0; i < count; i++) {
      const id = many ? a[i] : a;
      let value;
      for (let j = 0; j < values.length; j++) {
        if (values[j].id === id) {
          value = values[j];
          break;
        }
      }
      if (!value || !value.price) continue;
      if (field.type === "product_list") {
        // A real product added per unit of the line, at its own price.
        addPriceLine(quote, field.id, value.id, fixedMinor(p, value.price), "item", value.variantId || undefined);
        continue;
      }
      addPriceLine(
        quote,
        field.id,
        value.id,
        value.priceType === "percent" ? percentMinor(p, value.price) : fixedMinor(p, value.price),
        scope,
      );
    }
    return;
  }

  const rule = field.price;
  if (!rule || !rule.amount) return;
  const allowed = /** @type {Record<string, string[]>} */ (PRICE_TYPES_BY_FIELD)[field.type];
  if (!allowed || allowed.indexOf(rule.type) < 0) return;
  switch (rule.type) {
    case "fixed":
      addPriceLine(quote, field.id, undefined, fixedMinor(p, rule.amount), scope);
      break;
    case "percent":
      addPriceLine(quote, field.id, undefined, percentMinor(p, rule.amount), scope);
      break;
    case "per_char":
      addPriceLine(quote, field.id, undefined, fixedMinor(p, rule.amount) * chargeableChars(a), scope);
      break;
    case "per_unit":
      if (field.type === "range") {
        addPriceLine(quote, field.id, undefined, Math.round((Number(rule.amount) || 0) * p.rate * Math.max(0, Number(a) || 0) * p.mult + Number.EPSILON), scope);
      } else {
        addPriceLine(quote, field.id, undefined, fixedMinor(p, rule.amount) * Math.max(0, Math.floor(Number(a) || 0)), scope);
      }
      break;
    case "per_area": {
      // Width x height x rate (rate per square unit of the field's unit).
      const w = Array.isArray(a) ? Number(a[0]) : NaN;
      const h = Array.isArray(a) ? Number(a[1]) : NaN;
      if (!(w > 0) || !(h > 0)) break;
      addPriceLine(quote, field.id, undefined, Math.round((Number(rule.amount) || 0) * p.rate * w * h * p.mult + Number.EPSILON), scope);
      break;
    }
  }
}

/**
 * Compute add-on prices for a selection.
 * @param {OptionSet} set
 * @param {Answers} answers  raw answers, or effective answers when ctx.effective is true
 * @param {{ variantId?: string|number, baseMinor: number, rate?: number|string, currency?: string, sellingPlan?: boolean, effective?: boolean }} ctx
 *   baseMinor: the variant price the shopper sees, in presentment minor units.
 *   rate: presentment currency rate (shop currency -> presentment). Default 1.
 *   effective: the answers already came from effectiveAnswers()/evaluateSelection(); skip that step.
 * @returns {AddonQuote}
 */
export function quoteAddons(set, answers, ctx) {
  /** @type {AddonQuote} */
  const quote = { lines: [], perItemMinor: 0, perLineMinor: 0 };
  if (ctx.sellingPlan) return quote; // priced add-ons are unavailable on subscriptions
  if (!ctx.effective) return evaluateSelection(set, answers, ctx).quote;
  const p = makePricer(ctx);
  const eff = answers || {};
  for (const field of set.fields || []) {
    const a = eff[field.id];
    if (isEmpty(a)) continue;
    priceField(quote, field, a, p);
  }
  return quote;
}

/**
 * @typedef {{
 *   answers: Answers,
 *   visible: Record<string, boolean>,
 *   quote: AddonQuote,
 *   fieldsById: Record<string, Field>,
 * }} Evaluation
 */

/**
 * One pass over a selection: normalize every answer, decide visibility, and
 * (unless ctx.noQuote or ctx.sellingPlan) price it. Returns exactly what
 * effectiveAnswers() + computeVisibility() + quoteAddons() would, at a fraction
 * of the cost. The Functions use this path.
 * @param {OptionSet} set
 * @param {Answers | null | undefined} rawAnswers
 * @param {{ variantId?: string|number, baseMinor?: number, rate?: number|string, currency?: string, sellingPlan?: boolean, noQuote?: boolean }} [ctx]
 * @returns {Evaluation}
 */
export function evaluateSelection(set, rawAnswers, ctx = {}) {
  const fields = set.fields || [];
  const raw = rawAnswers || {};
  const n = fields.length;
  /** @type {Answers} */
  const all = {};
  /** @type {Record<string, Field>} */
  const fieldsById = {};
  for (let i = 0; i < n; i++) {
    const f = fields[i];
    fieldsById[f.id] = f;
    const v = normalizeAnswer(f, raw[f.id]);
    if (v !== undefined) all[f.id] = v;
  }

  /** @type {Record<string, boolean>} */
  const visible = {};
  /** @type {Answers} */
  const answers = {};
  /** @type {AddonQuote} */
  const quote = { lines: [], perItemMinor: 0, perLineMinor: 0 };
  const pricer = ctx.noQuote || ctx.sellingPlan ? null : makePricer(ctx);
  const variantId = variantKey(ctx.variantId);
  let groupOn = true;
  for (let i = 0; i < n; i++) {
    const f = fields[i];
    const own = !f.hidden && conditionShows(f.condition, visible, answers, all, variantId);
    const show = f.type === "group" ? own : groupOn && own;
    if (f.type === "group") groupOn = own;
    visible[f.id] = show;
    if (!show) continue;
    const a = all[f.id];
    if (a === undefined) continue;
    answers[f.id] = a;
    if (pricer) priceField(quote, f, a, pricer);
  }
  return { answers, visible, quote, fieldsById };
}

/**
 * Add-on amount charged per unit of the cart line. Once-per-line add-ons are
 * spread across the quantity and rounded UP, so the shopper is never undercharged.
 * @param {AddonQuote} quote
 * @param {number} quantity
 */
export function unitAddonMinor(quote, quantity) {
  const q = Math.max(1, Math.floor(quantity || 1));
  return quote.perItemMinor + Math.ceil(quote.perLineMinor / q);
}

/**
 * Total for the whole cart line, exactly as the Cart Transform will charge it.
 * @param {number} baseMinor
 * @param {AddonQuote} quote
 * @param {number} quantity
 */
export function lineTotalMinor(baseMinor, quote, quantity) {
  const q = Math.max(1, Math.floor(quantity || 1));
  return q * (baseMinor + unitAddonMinor(quote, q));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ().-]{6,20}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LETTERS_RE = /^[\p{L}\s'-]*$/u;
const NUMBERS_RE = /^[0-9\s]*$/;
const ALNUM_RE = /^[\p{L}\p{N}\s'-]*$/u;

/** "YYYY-MM-DD" -> day number (UTC days since epoch), or NaN. */
export function dayNumber(iso) {
  const m = DATE_RE.exec(String(iso || ""));
  if (!m) return NaN;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return Math.floor(ms / 86400000);
}

/** day number -> "YYYY-MM-DD" */
export function isoFromDay(day) {
  const dt = new Date(day * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * Date rules for a date field, given "today" in the store's time zone.
 * @param {Field} field
 * @param {string} today YYYY-MM-DD
 */
export function dateBounds(field, today) {
  const s = field.settings || {};
  const t0 = dayNumber(today);
  const lead = Math.max(0, Math.floor(Number(s.leadDays) || 0));
  const earliest = Number.isNaN(t0) ? NaN : t0 + lead;
  const ahead = Number(s.maxDaysAhead);
  const latest = Number.isNaN(t0) || !(ahead > 0) ? NaN : t0 + Math.floor(ahead);
  const weekdays = Array.isArray(s.weekdays) && s.weekdays.length ? s.weekdays.map(Number) : null;
  const blocked = new Set((s.blockedDates || []).map(String));
  return { earliest, latest, weekdays, blocked };
}

/**
 * Is a given date selectable?
 * @param {Field} field
 * @param {string} iso
 * @param {string} today
 * @returns {null | "date_invalid" | "date_too_early" | "date_too_late" | "date_blocked" | "date_weekday"}
 */
export function dateIssue(field, iso, today) {
  const d = dayNumber(iso);
  if (Number.isNaN(d)) return "date_invalid";
  const b = dateBounds(field, today);
  if (!Number.isNaN(b.earliest) && d < b.earliest) return "date_too_early";
  if (!Number.isNaN(b.latest) && d > b.latest) return "date_too_late";
  if (b.blocked.has(iso)) return "date_blocked";
  if (b.weekdays && !b.weekdays.includes(new Date(d * 86400000).getUTCDay())) return "date_weekday";
  return null;
}

/** First selectable date on/after the lead time, within 400 days. */
export function earliestDate(field, today) {
  const b = dateBounds(field, today);
  if (Number.isNaN(b.earliest)) return "";
  for (let d = b.earliest; d < b.earliest + 400; d++) {
    const iso = isoFromDay(d);
    if (!dateIssue(field, iso, today)) return iso;
  }
  return "";
}

/**
 * Validate a selection against the set. Hidden fields are skipped.
 * @param {OptionSet} set
 * @param {Answers} answers
 * @param {{ variantId?: string|number, today?: string, maxFiles?: number, sellingPlan?: boolean }} [ctx]
 * @returns {ValidationIssue[]}
 */
export function validateAnswers(set, answers, ctx = {}) {
  return validateEvaluated(set, evaluateSelection(set, answers, { variantId: ctx.variantId, noQuote: true }), ctx);
}

/**
 * validateAnswers() for a selection already run through evaluateSelection(),
 * so callers that also price it don't normalize twice.
 * @param {OptionSet} set
 * @param {Evaluation} evaluation
 * @param {{ today?: string, maxFiles?: number, sellingPlan?: boolean }} [ctx]
 * @returns {ValidationIssue[]}
 */
export function validateEvaluated(set, evaluation, ctx = {}) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const visible = evaluation.visible;
  const answers = evaluation.answers;

  for (const field of set.fields || []) {
    if (!visible[field.id] || DISPLAY_TYPES.has(field.type)) continue;
    const s = field.settings || {};
    const a = answers[field.id];
    /** @param {string} code @param {Record<string, any>} [params] */
    const add = (code, params) => issues.push({ fieldId: field.id, code, params });

    if (isEmpty(a)) {
      if (field.required) add("required");
      continue;
    }

    if (CHOICE_TYPES.has(field.type)) {
      const ids = Array.isArray(a) ? a : [a];
      const values = field.values || [];
      let bad;
      for (let i = 0; i < ids.length && bad === undefined; i++) {
        let known = false;
        for (let j = 0; j < values.length; j++) {
          if (values[j].id === ids[i]) {
            known = true;
            break;
          }
        }
        if (!known) bad = ids[i];
      }
      if (bad !== undefined) {
        add("invalid_value", { value: bad });
        continue;
      }
      if (isMultiSelect(field)) {
        if (s.minSelect && ids.length < Number(s.minSelect)) add("min_select", { min: Number(s.minSelect) });
        if (s.maxSelect && ids.length > Number(s.maxSelect)) add("max_select", { max: Number(s.maxSelect) });
      }
      continue;
    }

    switch (field.type) {
      case "text":
      case "textarea": {
        const len = codePointCount(String(a));
        if (s.minLength && len < Number(s.minLength)) add("min_length", { min: Number(s.minLength) });
        if (s.maxLength && len > Number(s.maxLength)) add("max_length", { max: Number(s.maxLength) });
        if (field.type === "textarea" && s.maxLines && String(a).split("\n").length > Number(s.maxLines))
          add("max_lines", { max: Number(s.maxLines) });
        if (field.type === "text" && s.charset && s.charset !== "any") {
          const re = s.charset === "letters" ? LETTERS_RE : s.charset === "numbers" ? NUMBERS_RE : ALNUM_RE;
          if (!re.test(String(a))) add("charset", { charset: s.charset });
        }
        break;
      }
      case "number":
      case "range": {
        const n = Number(a);
        if (s.min !== undefined && s.min !== null && s.min !== "" && n < Number(s.min)) add("min_value", { min: Number(s.min) });
        if (s.max !== undefined && s.max !== null && s.max !== "" && n > Number(s.max)) add("max_value", { max: Number(s.max) });
        if (s.step && Number(s.step) > 0) {
          const from = Number(s.min) || 0;
          const k = (n - from) / Number(s.step);
          if (Math.abs(k - Math.round(k)) > 1e-9) add("step", { step: Number(s.step) });
        }
        break;
      }
      case "date": {
        if (!ctx.today) {
          if (Number.isNaN(dayNumber(a))) add("date_invalid");
          break;
        }
        const issue = dateIssue(field, String(a), ctx.today);
        if (issue) add(issue);
        break;
      }
      case "file": {
        // The stricter of the field's own limit and the plan's limit applies.
        const fieldMax = Number(s.maxFiles) > 0 ? Number(s.maxFiles) : 1;
        const planMax = Number(ctx.maxFiles) > 0 ? Number(ctx.maxFiles) : Infinity;
        const max = Math.min(fieldMax, planMax);
        if (Array.isArray(a) && a.length > max) add("max_files", { max });
        break;
      }
      case "dimension": {
        const w = Array.isArray(a) ? a[0] : null;
        const h = Array.isArray(a) ? a[1] : null;
        if (!(Number(w) > 0) || !(Number(h) > 0) || w === null || h === null) {
          add("dimension_invalid");
          break;
        }
        const lim = (v, min, max, side) => {
          if (min !== undefined && min !== null && min !== "" && v < Number(min)) add("min_value", { min: Number(min), side });
          if (max !== undefined && max !== null && max !== "" && v > Number(max)) add("max_value", { max: Number(max), side });
        };
        lim(Number(w), s.minWidth, s.maxWidth, "width");
        lim(Number(h), s.minHeight, s.maxHeight, "height");
        break;
      }
      case "time": {
        const m = timeMinutes(a);
        if (Number.isNaN(m)) add("time_invalid");
        else if (!timeSlots(field).includes(String(a))) add("time_unavailable");
        break;
      }
      case "color_picker":
        if (!HEX_RE.test(String(a))) add("color_invalid");
        break;
      case "contact": {
        const format = s.format === "phone" ? "phone" : "email";
        const re = format === "phone" ? PHONE_RE : EMAIL_RE;
        if (!re.test(String(a))) add(format === "phone" ? "format_phone" : "format_email");
        break;
      }
    }
  }
  return issues;
}

/**
 * Serialize a selection into the hidden `_shine_options` line item property.
 * @param {OptionSet} set
 * @param {Answers} answers  already filtered with effectiveAnswers()
 */
export function encodeSelection(set, answers) {
  return JSON.stringify({ s: set.id, v: set.v, a: answers });
}

/**
 * @param {string | null | undefined} value
 * @returns {{ s: string, v: number, a: Answers } | null}
 */
export function decodeSelection(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const d = JSON.parse(value);
    if (!d || typeof d !== "object" || typeof d.s !== "string" || typeof d.a !== "object" || d.a === null || Array.isArray(d.a))
      return null;
    return { s: d.s, v: Number(d.v) || 0, a: d.a };
  } catch {
    return null;
  }
}

/**
 * Human-readable line item properties for a selection (what the cart, order
 * and packing slip show).
 * @param {OptionSet} set
 * @param {Answers} answers  effective answers
 * @param {{ locale?: string, yes?: string }} [ctx]
 * @returns {{ key: string, value: string, fieldId: string }[]}
 */
export function displayEntries(set, answers, ctx = {}) {
  const locale = ctx.locale;
  const fallback = set.defaultLocale;
  /** @type {{ key: string, value: string, fieldId: string }[]} */
  const out = [];
  /** @type {Record<string, number>} */
  const seen = {};
  for (const field of set.fields || []) {
    const a = answers[field.id];
    if (isEmpty(a)) continue;
    let value;
    if (CHOICE_TYPES.has(field.type)) {
      const ids = Array.isArray(a) ? a : [a];
      const values = field.values || [];
      /** @type {string[]} */
      const labels = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < values.length; j++) {
          if (values[j].id === ids[i]) {
            labels.push(t(values[j].label, locale, fallback));
            break;
          }
        }
      }
      value = labels.join(", ");
    } else if (field.type === "checkbox" || field.type === "toggle") {
      value = ctx.yes || "Yes";
    } else if (field.type === "dimension") {
      const unit = field.settings?.unit ? ` ${field.settings.unit}` : "";
      value = Array.isArray(a) && a[0] !== null && a[1] !== null ? `${a[0]} × ${a[1]}${unit}` : "";
    } else if (field.type === "range") {
      value = `${a}${field.settings?.unit ? ` ${field.settings.unit}` : ""}`;
    } else if (Array.isArray(a)) {
      value = a.join(", ");
    } else {
      value = String(a);
    }
    if (!value) continue;
    let key = t(field.label, locale, fallback) || field.id;
    if (key.startsWith("_")) key = key.replace(/^_+/, "");
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key = `${key} (${seen[key]})`;
    out.push({ key, value, fieldId: field.id });
  }
  return out;
}

/**
 * Strip a full option set down to what the Functions need: one label language,
 * no help text, placeholders, images or colors. Keeps Function input small for
 * 100-line carts.
 * @param {OptionSet} set
 * @param {string} [locale]
 * @returns {OptionSet}
 */
export function toFunctionSet(set, locale) {
  const loc = locale || set.defaultLocale;
  const keep = [
    "minLength", "maxLength", "maxLines", "charset", "min", "max", "step",
    "minSelect", "maxSelect", "multiple", "leadDays", "blockedDates",
    "weekdays", "maxDaysAhead", "maxFiles", "format",
    "minWidth", "maxWidth", "minHeight", "maxHeight", "unit", "start", "end", "interval",
  ];
  return {
    id: set.id,
    v: set.v,
    defaultLocale: loc,
    // Display-only elements never affect price or validation. Option groups stay:
    // a hidden group hides (and un-requires, un-prices) the options inside it.
    fields: (set.fields || []).filter((f) => f.type === "group" || !DISPLAY_TYPES.has(f.type)).map((f) => {
      /** @type {Field} */
      const lean = { id: f.id, type: f.type, label: t(f.label, loc, set.defaultLocale) };
      if (f.required) lean.required = true;
      if (f.condition && f.condition.rules?.length) lean.condition = f.condition;
      if (f.price && f.price.amount) lean.price = f.price;
      if (f.scope === "line") lean.scope = "line";
      if (f.values) {
        lean.values = f.values.map((v) => {
          /** @type {FieldValue} */
          const lv = { id: v.id, label: t(v.label, loc, set.defaultLocale) };
          if (v.price) {
            lv.price = v.price;
            if (v.priceType === "percent") lv.priceType = "percent";
          }
          if (v.variantId) lv.variantId = v.variantId;
          return lv;
        });
      }
      if (f.settings) {
        /** @type {Record<string, any>} */
        const s = {};
        for (const k of keep) if (f.settings[k] !== undefined && f.settings[k] !== "" && f.settings[k] !== null) s[k] = f.settings[k];
        if (Object.keys(s).length) lean.settings = s;
      }
      return lean;
    }),
  };
}

/** True when the set has at least one field with a price. */
export function hasPricedFields(set) {
  return (set.fields || []).some(
    (f) => (f.price && f.price.amount > 0) || (f.values || []).some((v) => v.price && v.price > 0),
  );
}

/** True when a shopper must fill something before adding to cart (no answers given). */
export function hasRequiredFields(set, variantId) {
  const visible = computeVisibility(set, {}, { variantId });
  return (set.fields || []).some((f) => f.required && visible[f.id]);
}

/**
 * Structural checks for a set the merchant is about to publish.
 * @param {OptionSet} set
 * @returns {string[]} problems (empty = OK)
 */
export function lintOptionSet(set) {
  /** @type {string[]} */
  const problems = [];
  const ids = new Set();
  (set.fields || []).forEach((f, i) => {
    const name = t(f.label, set.defaultLocale) || `Field ${i + 1}`;
    if (!f.id) problems.push(`${name}: missing id`);
    if (ids.has(f.id)) problems.push(`${name}: duplicate id ${f.id}`);
    ids.add(f.id);
    if (!FIELD_TYPES.includes(f.type)) problems.push(`${name}: unknown type ${f.type}`);
    if (!t(f.label, set.defaultLocale) && f.type !== "divider" && f.type !== "spacer")
      problems.push(`Field ${i + 1}: ${f.type === "popup" ? "link text" : f.type === "heading" ? "heading text" : "label"} is required`);
    if (f.type === "product_list") {
      for (const v of f.values || []) if (!v.variantId) problems.push(`${name}: pick a product for every value`);
    }
    if (f.type === "time") {
      const st = f.settings || {};
      const a = timeMinutes(st.start || "09:00");
      const b = timeMinutes(st.end || "17:00");
      if (Number.isNaN(a) || Number.isNaN(b) || a > b) problems.push(`${name}: the first time slot must be before the last`);
    }
    if (f.type === "design_layer") {
      const src = (set.fields || []).find((x) => x.id === f.settings?.sourceField);
      if (!src || (src.type !== "text" && src.type !== "textarea")) problems.push(`${name}: choose the text option it shows`);
    }
    if (DISPLAY_TYPES.has(f.type)) {
      if ((f.type === "paragraph" || f.type === "popup") && !t(f.text, set.defaultLocale)) problems.push(`${name}: add some text`);
      if (f.required) problems.push(`${name}: layout and content elements can't be required`);
    }
    if (isChoiceType(f.type)) {
      if (!f.values || f.values.length === 0) problems.push(`${name}: add at least one value`);
      const vids = new Set();
      for (const v of f.values || []) {
        if (!t(v.label, set.defaultLocale)) problems.push(`${name}: every value needs a label`);
        if (vids.has(v.id)) problems.push(`${name}: duplicate value id ${v.id}`);
        vids.add(v.id);
        if (v.price !== undefined && (Number.isNaN(Number(v.price)) || Number(v.price) < 0))
          problems.push(`${name}: prices can't be negative`);
      }
    }
    if (f.price && (Number.isNaN(Number(f.price.amount)) || Number(f.price.amount) < 0))
      problems.push(`${name}: prices can't be negative`);
    for (const r of f.condition?.rules || []) {
      if (r.source === "field") {
        const idx = (set.fields || []).findIndex((x) => x.id === r.field);
        if (idx < 0) problems.push(`${name}: condition refers to a deleted field`);
        else if (idx >= i) problems.push(`${name}: conditions can only use fields above it`);
        else if (!f.hidden && set.fields[idx].hidden) problems.push(`${name}: its condition uses a hidden field`);
        else if (DISPLAY_TYPES.has(set.fields[idx].type)) problems.push(`${name}: conditions can't use a layout or content element`);
      }
    }
  });
  return problems;
}
