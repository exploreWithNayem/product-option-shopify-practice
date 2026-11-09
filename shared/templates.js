// @ts-check
/**
 * Ready-made option sets for the setup wizard (PRD F11).
 * Prices are in the shop currency. Ids are stable so templates are predictable;
 * the admin re-keys them when a template is applied twice in one set.
 */

/** @typedef {import("./options-core.js").Field} Field */

/** Short random id for fields and values. */
export function newId(prefix = "f") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${s}`;
}

/**
 * @type {{ key: string, name: string, description: string, sells: string, fields: Field[] }[]}
 */
export const TEMPLATES = [
  {
    key: "engraving",
    name: "Engraving",
    sells: "Jewelry, watches and gifts",
    description: "Monogram text priced per letter, with a font choice.",
    fields: [
      {
        id: "f_engrave",
        type: "toggle",
        label: { en: "Add engraving" },
        settings: { defaultOn: false },
      },
      {
        id: "f_text",
        type: "text",
        label: { en: "Engraving text" },
        help: { en: "Up to 3 letters." },
        placeholder: { en: "e.g. ABC" },
        required: true,
        price: { type: "per_char", amount: 5 },
        settings: { minLength: 1, maxLength: 3, charset: "letters" },
        condition: { action: "show", match: "all", rules: [{ source: "field", field: "f_engrave", op: "not_empty" }] },
      },
      {
        id: "f_font",
        type: "buttons",
        label: { en: "Font" },
        values: [
          { id: "v_script", label: { en: "Script" }, default: true },
          { id: "v_block", label: { en: "Block" } },
          { id: "v_serif", label: { en: "Serif" } },
        ],
        condition: { action: "show", match: "all", rules: [{ source: "field", field: "f_engrave", op: "not_empty" }] },
      },
    ],
  },
  {
    key: "gift_wrap",
    name: "Gift wrap",
    sells: "Gifts, books, beauty and home",
    description: "Gift wrap toggle with a paper choice and a gift message.",
    fields: [
      {
        id: "f_wrap",
        type: "toggle",
        label: { en: "Gift wrap" },
        price: { type: "fixed", amount: 5 },
      },
      {
        id: "f_paper",
        type: "color_swatch",
        label: { en: "Wrapping paper" },
        required: true,
        values: [
          { id: "v_red", label: { en: "Red" }, color: "#c0392b", default: true },
          { id: "v_gold", label: { en: "Gold" }, color: "#d4a017" },
          { id: "v_navy", label: { en: "Navy" }, color: "#1f2a44" },
        ],
        condition: { action: "show", match: "all", rules: [{ source: "field", field: "f_wrap", op: "not_empty" }] },
      },
      {
        id: "f_message",
        type: "textarea",
        label: { en: "Gift message" },
        placeholder: { en: "Write a short note" },
        settings: { maxLength: 200, maxLines: 4 },
        condition: { action: "show", match: "all", rules: [{ source: "field", field: "f_wrap", op: "not_empty" }] },
      },
    ],
  },
  {
    key: "bakery",
    name: "Bakery",
    sells: "Cakes, bakery and food",
    description: "Delivery date with lead time, flavor, size and a cake message.",
    fields: [
      {
        id: "f_date",
        type: "date",
        label: { en: "Delivery date" },
        required: true,
        settings: { leadDays: 2, maxDaysAhead: 60, weekdays: [2, 3, 4, 5, 6], blockedDates: [] },
      },
      {
        id: "f_flavor",
        type: "dropdown",
        label: { en: "Flavor" },
        required: true,
        values: [
          { id: "v_vanilla", label: { en: "Vanilla" }, default: true },
          { id: "v_choc", label: { en: "Chocolate" } },
          { id: "v_redvelvet", label: { en: "Red velvet" }, price: 4 },
        ],
      },
      {
        id: "f_size",
        type: "radio",
        label: { en: "Size" },
        required: true,
        values: [
          { id: "v_6in", label: { en: '6" (serves 8)' }, default: true },
          { id: "v_8in", label: { en: '8" (serves 14)' }, price: 12 },
          { id: "v_10in", label: { en: '10" (serves 24)' }, price: 25 },
        ],
      },
      {
        id: "f_msg",
        type: "text",
        label: { en: "Message on cake" },
        settings: { maxLength: 30 },
        price: { type: "fixed", amount: 3 },
      },
    ],
  },
  {
    key: "custom_size",
    name: "Custom size",
    sells: "Furniture, apparel and print",
    description: "Width and height inputs, a fit choice and an upload for reference.",
    fields: [
      {
        id: "f_width",
        type: "number",
        label: { en: "Width (cm)" },
        required: true,
        settings: { min: 20, max: 300, step: 1 },
      },
      {
        id: "f_height",
        type: "number",
        label: { en: "Height (cm)" },
        required: true,
        settings: { min: 20, max: 300, step: 1 },
      },
      {
        id: "f_fit",
        type: "buttons",
        label: { en: "Fit" },
        values: [
          { id: "v_slim", label: { en: "Slim" } },
          { id: "v_regular", label: { en: "Regular" }, default: true },
          { id: "v_relaxed", label: { en: "Relaxed" } },
        ],
      },
      {
        id: "f_upload",
        type: "file",
        label: { en: "Reference photo" },
        help: { en: "Optional. Helps us get the size right." },
        settings: { maxFiles: 1, fileTypes: ["jpg", "png", "pdf"] },
      },
    ],
  },
  {
    key: "warranty",
    name: "Warranty",
    sells: "Electronics, furniture and appliances",
    description: "Extended warranty priced as a percent of the product.",
    fields: [
      {
        id: "f_warranty",
        type: "radio",
        label: { en: "Warranty" },
        required: true,
        values: [
          { id: "v_1y", label: { en: "1 year (included)" }, default: true },
          { id: "v_2y", label: { en: "2 years" }, price: 10, priceType: "percent" },
          { id: "v_3y", label: { en: "3 years" }, price: 15, priceType: "percent" },
        ],
      },
      {
        id: "f_install",
        type: "checkbox",
        label: { en: "Professional installation" },
        price: { type: "fixed", amount: 49 },
        scope: "line",
      },
    ],
  },
];

/**
 * A deep copy of a template's fields, labels moved to the shop's primary locale.
 * @param {string} key
 * @param {string} [locale]
 */
export function templateFields(key, locale = "en") {
  const tpl = TEMPLATES.find((x) => x.key === key);
  if (!tpl) return [];
  const fields = JSON.parse(JSON.stringify(tpl.fields));
  if (locale !== "en") {
    /** @param {any} m */
    const relabel = (m) => (m && typeof m === "object" && m.en !== undefined ? { [locale]: m.en } : m);
    for (const f of fields) {
      f.label = relabel(f.label);
      if (f.help) f.help = relabel(f.help);
      if (f.placeholder) f.placeholder = relabel(f.placeholder);
      for (const v of f.values || []) v.label = relabel(v.label);
    }
  }
  return fields;
}
