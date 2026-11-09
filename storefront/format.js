// @ts-check
/** Pure helpers for the storefront script: copy, money, messages. No DOM. */
import { currencyDecimals, t } from "../shared/options-core.js";

/** PRD "Copy → Product page". Merchants override any key per locale. */
export const DEFAULT_STRINGS = {
  price: "+{price}",
  per_char: "+{price} per character",
  per_unit: "+{price} each",
  add_to_cart: "Add to cart · {total}",
  counter: "{used}/{max} characters",
  required: "Please add {field} to continue.",
  charset_letters: "{field} can only use letters.",
  charset_numbers: "{field} can only use numbers.",
  charset_alphanumeric: "{field} can only use letters and numbers.",
  min_length: "{field} needs at least {min} characters.",
  max_length: "{field} can have up to {max} characters.",
  max_lines: "{field} can have up to {max} lines.",
  min_value: "{field} must be at least {min}.",
  max_value: "{field} can be at most {max}.",
  step: "{field} must go up in steps of {step}.",
  min_select: "Choose at least {min}.",
  max_select: "Choose up to {max}.",
  invalid_value: "Choose an available option for {field}.",
  format_email: "Enter a valid email address for {field}.",
  format_phone: "Enter a valid phone number for {field}.",
  date_unavailable: "That date isn't available. Choose another one.",
  date_note: "Earliest available date: {date}",
  date_choose: "Choose a date",
  date_prev: "Previous month",
  date_next: "Next month",
  max_files: "You can upload up to {max} files.",
  upload_drop: "Drag a file here or tap to upload",
  upload_too_large: "This file is over {size}. Try a smaller one.",
  upload_wrong_type: "This file type isn't supported. Use {types}.",
  upload_failed: "Upload didn't finish. Try again.",
  upload_progress: "Uploading {name}: {percent}%",
  upload_done: "{name} uploaded.",
  upload_wait: "Wait for your upload to finish.",
  upload_remove: "Remove",
  upload_retry: "Try again",
  subscription: "Paid add-ons aren't available with a subscription.",
  errors: "Please check the highlighted options.",
  yes: "Yes",
  or: "or",
  per_area: "+{price} per {unit}²",
  dimension_invalid: "Enter both width and height for {field}.",
  min_width: "{field} width must be at least {min}.",
  max_width: "{field} width can be at most {max}.",
  min_height: "{field} height must be at least {min}.",
  max_height: "{field} height can be at most {max}.",
  time_unavailable: "Choose an available time for {field}.",
  color_invalid: "Choose a color for {field}.",
  width: "Width",
  height: "Height",
  time_choose: "Choose a time",
  color_hex: "hex code",
};

/** Replace {name} placeholders. Unknown placeholders are left as they are. */
export function fill(template, params = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (m, k) =>
    params[k] !== undefined && params[k] !== null ? String(params[k]) : m,
  );
}

/**
 * Money formatter for the shopper's currency, working in minor units.
 * @param {string} currency
 * @param {string} locale
 */
export function makeMoney(currency, locale) {
  const d = currencyDecimals(currency);
  /** @type {Intl.NumberFormat | null} */
  let nf = null;
  try {
    nf = new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    nf = null;
  }
  return (/** @type {number} */ minor) => {
    const major = minor / Math.pow(10, d);
    return nf ? nf.format(major) : `${major.toFixed(d)} ${currency}`;
  };
}

/** Shopify.currency.rate as a number; 1 when missing or invalid. */
export function parseRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Message for a validation issue from the shared core.
 * @param {{ code: string, params?: Record<string, any> }} issue
 * @param {any} field
 * @param {Record<string, string>} strings
 * @param {string} [locale]
 * @param {string} [fallback]
 */
export function issueMessage(issue, field, strings, locale, fallback) {
  const label = t(field.label, locale, fallback);
  let key = issue.code;
  if (key === "charset") key = `charset_${issue.params?.charset || "letters"}`;
  if (key.startsWith("date_")) key = "date_unavailable";
  if (key.startsWith("time_")) key = "time_unavailable";
  // Dimension limits say which side: "Size width must be at least 20."
  const side = issue.params?.side;
  if ((key === "min_value" || key === "max_value") && (side === "width" || side === "height")) key = `${key.slice(0, 3)}_${side}`;
  const template = strings[key] || strings.invalid_value;
  return fill(template, { field: label, ...(issue.params || {}) });
}

/** Line item property keys can't contain brackets (they'd break properties[...] parsing). */
export function propertyKey(key) {
  return String(key).replace(/\[/g, "(").replace(/\]/g, ")").trim() || "Option";
}

const KINDS = {
  jpg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  png: ["image/png"],
  pdf: ["application/pdf"],
};

/**
 * Upload kind from a File-like object ({ name, type }), or null when unsupported.
 * @param {{ name?: string, type?: string }} file
 * @param {string[]} [allowed]
 */
export function fileKind(file, allowed = ["jpg", "png", "pdf"]) {
  const ext = String(file.name || "").toLowerCase().split(".").pop() || "";
  const type = String(file.type || "").toLowerCase();
  for (const kind of allowed) {
    const k = kind === "jpeg" ? "jpg" : kind;
    const exts = k === "jpg" ? ["jpg", "jpeg"] : [k];
    if (exts.includes(ext) || (KINDS[k] || []).includes(type)) return k;
  }
  return null;
}

/** "JPG, PNG or PDF" */
export function typesText(allowed, or = "or") {
  const list = (allowed && allowed.length ? allowed : ["jpg", "png", "pdf"]).map((x) => String(x).toUpperCase());
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} ${or} ${list[list.length - 1]}`;
}

/**
 * For the quick-add guard: the product URL to send the shopper to when a
 * /cart/add request adds a product that needs options without any, else null.
 * @param {any} body  FormData | URLSearchParams | JSON string | urlencoded string
 * @param {Record<string, string>} map variant id -> product URL
 */
export function quickAddTarget(body, map) {
  const need = (id) => (id !== undefined && id !== null ? map[String(id)] || null : null);
  /** @param {{ get(name: string): any }} fd */
  const fromForm = (fd) => (fd.get("properties[_shine_options]") ? null : need(fd.get("id")));
  if (!body) return null;
  if (typeof FormData !== "undefined" && body instanceof FormData) return fromForm(body);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return fromForm(body);
  if (typeof body === "string") {
    const s = body.trim();
    if (s.startsWith("{")) {
      try {
        const j = JSON.parse(s);
        const items = Array.isArray(j.items) ? j.items : [j];
        for (const it of items) {
          if (it && !(it.properties && it.properties._shine_options)) {
            const url = need(it.id);
            if (url) return url;
          }
        }
      } catch {
        return null;
      }
      return null;
    }
    return fromForm(new URLSearchParams(s));
  }
  return null;
}

/** Font stacks are applied only when they're plain names: letters, digits, spaces, commas, hyphens, quotes. */
const FONT_RE = /^[A-Za-z0-9 ,'"-]+$/;
/** @param {any} font */
export function safeFont(font) {
  const f = String(font || "").trim();
  return f && FONT_RE.test(f) ? f : "";
}

/** "#rgb" / "#rrggbb" (any case) as "#rrggbb", or "" when not a hex color. @param {any} c */
export function safeHex(c) {
  let s = String(c || "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return /^#[0-9a-f]{6}$/.test(s) ? s : "";
}
