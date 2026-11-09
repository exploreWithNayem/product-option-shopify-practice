import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeVisibility,
  decodeSelection,
  displayEntries,
  effectiveAnswers,
  encodeSelection,
  earliestDate,
  lineTotalMinor,
  lintOptionSet,
  quoteAddons,
  toFunctionSet,
  toMinor,
  unitAddonMinor,
  validateAnswers,
} from "./options-core.js";
import { TEMPLATES, templateFields } from "./templates.js";

/** The PRD's Blue Silk Tuxedo: monogram (+$10) and gift wrap (+$5). */
const tuxedo = {
  id: "set_1",
  v: 2,
  defaultLocale: "en",
  fields: [
    {
      id: "mono",
      type: "text",
      label: { en: "Monogram on cuff", fr: "Monogramme" },
      required: true,
      price: { type: "fixed", amount: 10 },
      settings: { maxLength: 3, charset: "letters" },
    },
    { id: "wrap", type: "toggle", label: { en: "Gift wrap" }, price: { type: "fixed", amount: 5 } },
  ],
};

test("PRD shopper flow: $70 + monogram $10 + wrap $5 = $85", () => {
  const answers = { mono: "AB", wrap: true };
  const q = quoteAddons(tuxedo, answers, { baseMinor: 7000, currency: "USD" });
  assert.equal(q.perItemMinor, 1500);
  assert.equal(lineTotalMinor(7000, q, 1), 8500);
  assert.deepEqual(validateAnswers(tuxedo, answers), []);
  const entries = displayEntries(tuxedo, effectiveAnswers(tuxedo, answers));
  assert.deepEqual(entries.map((e) => [e.key, e.value]), [
    ["Monogram on cuff", "AB"],
    ["Gift wrap", "Yes"],
  ]);
});

test("required and charset errors", () => {
  assert.deepEqual(validateAnswers(tuxedo, {}), [{ fieldId: "mono", code: "required", params: undefined }]);
  const issues = validateAnswers(tuxedo, { mono: "A1B2" });
  assert.deepEqual(
    issues.map((i) => i.code),
    ["max_length", "charset"],
  );
});

test("hidden fields are never required and never priced", () => {
  const set = TEMPLATES.find((t) => t.key === "engraving");
  const s = { id: "x", v: 1, fields: set.fields };
  assert.deepEqual(validateAnswers(s, {}), []); // engraving off -> text hidden
  const q = quoteAddons(s, { f_text: "ABC" }, { baseMinor: 1000, currency: "USD" });
  assert.equal(q.perItemMinor, 0);
  const on = quoteAddons(s, { f_engrave: true, f_text: "ABC" }, { baseMinor: 1000, currency: "USD" });
  assert.equal(on.perItemMinor, 1500); // 3 letters x $5
  assert.equal(validateAnswers(s, { f_engrave: true })[0].code, "required");
});

test("variant conditions", () => {
  const set = {
    id: "s",
    v: 1,
    fields: [
      {
        id: "a",
        type: "text",
        label: "Only for gold",
        required: true,
        condition: { action: "show", match: "all", rules: [{ source: "variant", op: "is", value: "gid://shopify/ProductVariant/42" }] },
      },
    ],
  };
  assert.equal(computeVisibility(set, {}, { variantId: 42 }).a, true);
  assert.equal(computeVisibility(set, {}, { variantId: "gid://shopify/ProductVariant/7" }).a, false);
  assert.deepEqual(validateAnswers(set, {}, { variantId: 7 }), []);
});

test("percent, per-line and currency conversion", () => {
  const set = { id: "w", v: 1, fields: TEMPLATES.find((t) => t.key === "warranty").fields };
  const q = quoteAddons(set, { f_warranty: "v_2y", f_install: true }, { baseMinor: 19999, currency: "USD" });
  assert.equal(q.perItemMinor, 2000); // 10% of 199.99 = 20.00 (rounded)
  assert.equal(q.perLineMinor, 4900);
  // quantity 3: $49 once per line spread as ceil(4900/3)=1634 per unit -> never undercharged
  assert.equal(unitAddonMinor(q, 3), 2000 + 1634);
  assert.ok(lineTotalMinor(19999, q, 3) >= 3 * (19999 + 2000) + 4900);

  // EUR at rate 0.92, JPY has no minor unit
  const eur = quoteAddons(tuxedo, { mono: "AB" }, { baseMinor: 6440, rate: "0.92", currency: "EUR" });
  assert.equal(eur.perItemMinor, 920);
  const jpy = quoteAddons(tuxedo, { mono: "AB" }, { baseMinor: 10000, rate: "151.37", currency: "JPY" });
  assert.equal(jpy.perItemMinor, 1514);
  assert.equal(toMinor(10.005, "USD"), 1001);
});

test("subscriptions never get priced add-ons", () => {
  const q = quoteAddons(tuxedo, { mono: "AB", wrap: true }, { baseMinor: 7000, sellingPlan: true });
  assert.equal(q.perItemMinor + q.perLineMinor, 0);
});

test("date rules", () => {
  const set = { id: "b", v: 1, fields: TEMPLATES.find((t) => t.key === "bakery").fields };
  const date = set.fields[0];
  // 2026-11-06 is a Friday. Lead 2 days -> Sunday 8th, but Sundays (0) and Mondays (1) are closed -> Tue 10th
  assert.equal(earliestDate(date, "2026-11-06"), "2026-11-10");
  const issues = (d) => validateAnswers(set, { f_date: d, f_flavor: "v_vanilla", f_size: "v_6in" }, { today: "2026-11-06" });
  assert.deepEqual(issues("2026-11-07").map((i) => i.code), ["date_too_early"]);
  assert.deepEqual(issues("2026-11-09").map((i) => i.code), ["date_weekday"]);
  assert.deepEqual(issues("2026-11-10"), []);
  assert.deepEqual(issues("2027-02-01").map((i) => i.code), ["date_too_late"]);
  assert.deepEqual(issues("2026-02-30").map((i) => i.code), ["date_invalid"]);
});

test("invalid values and multi-select limits", () => {
  const set = {
    id: "c",
    v: 1,
    fields: [
      {
        id: "g",
        type: "checkbox_group",
        label: "Extras",
        settings: { maxSelect: 2 },
        values: [
          { id: "box", label: "Box", price: 2 },
          { id: "card", label: "Card", price: 1 },
          { id: "ribbon", label: "Ribbon" },
        ],
      },
    ],
  };
  assert.equal(validateAnswers(set, { g: ["box", "nope"] })[0].code, "invalid_value");
  assert.equal(validateAnswers(set, { g: ["box", "card", "ribbon"] })[0].code, "max_select");
  assert.equal(quoteAddons(set, { g: ["box", "card"] }, { baseMinor: 0 }).perItemMinor, 300);
  // a tampered price-less value id is simply not priced
  assert.equal(quoteAddons(set, { g: ["nope"] }, { baseMinor: 0 }).perItemMinor, 0);
});

test("selection round trip and tamper safety", () => {
  const enc = encodeSelection(tuxedo, { mono: "AB" });
  assert.deepEqual(decodeSelection(enc), { s: "set_1", v: 2, a: { mono: "AB" } });
  assert.equal(decodeSelection("{not json"), null);
  assert.equal(decodeSelection(JSON.stringify({ s: 1, a: {} })), null);
  assert.equal(decodeSelection(JSON.stringify({ s: "x", a: [] })), null);
});

test("function set keeps pricing, drops presentation", () => {
  const lean = toFunctionSet({ ...tuxedo, fields: [...tuxedo.fields, { id: "h", type: "text", label: "x", help: "long help" }] }, "fr");
  assert.equal(lean.fields[0].label, "Monogramme");
  assert.equal(lean.fields[2].help, undefined);
  const q = quoteAddons(lean, { mono: "AB", wrap: true }, { baseMinor: 7000 });
  assert.equal(q.perItemMinor, 1500);
});

test("every template lints clean and localizes", () => {
  for (const tpl of TEMPLATES) {
    assert.deepEqual(lintOptionSet({ id: tpl.key, v: 1, defaultLocale: "en", fields: tpl.fields }), [], tpl.key);
  }
  assert.equal(templateFields("gift_wrap", "fr")[0].label.fr, "Gift wrap");
});

test("lint catches conditions on later fields", () => {
  const problems = lintOptionSet({
    id: "x",
    v: 1,
    fields: [
      { id: "a", type: "text", label: "A", condition: { action: "show", match: "all", rules: [{ source: "field", field: "b", op: "not_empty" }] } },
      { id: "b", type: "text", label: "B" },
    ],
  });
  assert.equal(problems.length, 1);
});

test("file count: the stricter of field and plan limits applies", () => {
  const set = { id: "u", v: 1, fields: [{ id: "f", type: "file", label: "Photo", settings: { maxFiles: 1 } }] };
  const two = { f: ["https://a/files/1", "https://a/files/2"] };
  assert.equal(validateAnswers(set, two, { maxFiles: 5 })[0].code, "max_files");
  const loose = { id: "u", v: 1, fields: [{ id: "f", type: "file", label: "Photo", settings: { maxFiles: 10 } }] };
  assert.equal(validateAnswers(loose, two, { maxFiles: 1 })[0].code, "max_files");
  assert.deepEqual(validateAnswers(loose, two, { maxFiles: 5 }), []);
});

test("hidden fields (eye toggle) are never shown, required or priced", () => {
  const set = { id: "h", v: 1, fields: [{ ...tuxedo.fields[0], hidden: true }, tuxedo.fields[1]] };
  assert.deepEqual(validateAnswers(set, {}), []);
  assert.equal(quoteAddons(set, { mono: "AB", wrap: true }, { baseMinor: 7000 }).perItemMinor, 500);
  assert.equal(computeVisibility(set, {}).mono, false);
  const lint = lintOptionSet({ id: "x", v: 1, fields: [
    { id: "a", type: "toggle", label: "A", hidden: true },
    { id: "b", type: "text", label: "B", condition: { action: "show", match: "all", rules: [{ source: "field", field: "a", op: "not_empty" }] } },
  ] });
  assert.deepEqual(lint, ["B: its condition uses a hidden field"]);
});

test("display elements: no answers, prices or validation; dropped from the Function set", () => {
  const set = {
    id: "d", v: 1, defaultLocale: "en",
    fields: [
      { id: "h", type: "heading", label: "Personalize it", settings: { size: "large" } },
      { id: "p", type: "paragraph", label: "Note", text: { en: "Made to order in 3 days." } },
      { id: "dv", type: "divider", label: "Divider-1" },
      { id: "sp", type: "spacer", label: "Spacer-1", settings: { height: 24 } },
      { id: "pop", type: "popup", label: "Size guide", text: "S, M, L", settings: { image: "https://cdn.example/x.png" } },
      tuxedo.fields[0],
    ],
  };
  assert.deepEqual(lintOptionSet(set), []);
  assert.deepEqual(effectiveAnswers(set, { h: "x", p: "y", mono: "AB" }), { mono: "AB" });
  assert.deepEqual(validateAnswers(set, { mono: "AB" }), []);
  assert.equal(quoteAddons(set, { mono: "AB" }, { baseMinor: 0 }).perItemMinor, 1000);
  assert.deepEqual(toFunctionSet(set).fields.map((f) => f.id), ["mono"]);
  assert.deepEqual(displayEntries(set, effectiveAnswers(set, { mono: "AB" })).map((e) => e.key), ["Monogram on cuff"]);
  const bad = lintOptionSet({ id: "x", v: 1, fields: [{ id: "p", type: "paragraph", label: "P", required: true }] });
  assert.deepEqual(bad, ["P: add some text", "P: layout and content elements can't be required"]);
});

test("new types: range, dimension, time, color picker, font picker", () => {
  const set = {
    id: "n", v: 1, defaultLocale: "en",
    fields: [
      { id: "r", type: "range", label: "Length", settings: { min: 10, max: 100, step: 5, unit: "cm" }, price: { type: "per_unit", amount: 0.5 } },
      { id: "d", type: "dimension", label: "Size", settings: { unit: "cm", minWidth: 20, maxWidth: 200, minHeight: 20, maxHeight: 200 }, price: { type: "per_area", amount: 0.01 } },
      { id: "t", type: "time", label: "Pickup", settings: { start: "09:00", end: "12:00", interval: 30 }, price: { type: "fixed", amount: 2 } },
      { id: "c", type: "color_picker", label: "Thread color" },
      { id: "f", type: "font_picker", label: "Font", values: [{ id: "v1", label: "Script", font: "Brush Script MT, cursive", price: 3 }, { id: "v2", label: "Block", font: "Arial, sans-serif" }] },
    ],
  };
  assert.deepEqual(lintOptionSet(set), []);
  const answers = { r: "45", d: "120 x 80", t: "9:30", c: "#ABC", f: "v1" };
  const eff = effectiveAnswers(set, answers);
  assert.deepEqual(eff, { r: 45, d: [120, 80], t: "09:30", c: "#aabbcc", f: "v1" });
  assert.deepEqual(validateAnswers(set, answers), []);
  const q = quoteAddons(set, answers, { baseMinor: 0, currency: "USD" });
  // 45 x $0.50 = 22.50; 120 x 80 x $0.01 = 96.00; time $2; font $3
  assert.equal(q.perItemMinor, 2250 + 9600 + 200 + 300);
  assert.deepEqual(displayEntries(set, eff).map((e) => e.value), ["45 cm", "120 × 80 cm", "09:30", "#aabbcc", "Script"]);
  const bad = validateAnswers(set, { r: 47, d: [10, null], t: "09:15", c: "blue" }).map((i) => i.code);
  assert.deepEqual(bad, ["step", "dimension_invalid", "time_unavailable", "color_invalid"]);
  assert.deepEqual(validateAnswers(set, { d: [10, 300] }).map((i) => [i.code, i.params.side]), [["min_value", "width"], ["max_value", "height"]]);
});

test("option groups hide (and un-require, un-price) everything inside", () => {
  const set = {
    id: "g", v: 1, defaultLocale: "en",
    fields: [
      { id: "wrap", type: "toggle", label: "Gift wrap" },
      { id: "grp", type: "group", label: "Wrapping", condition: { action: "show", match: "all", rules: [{ source: "field", field: "wrap", op: "not_empty" }] } },
      { id: "msg", type: "text", label: "Message", required: true, price: { type: "fixed", amount: 4 } },
      { id: "grp2", type: "group", label: "Delivery" },
      { id: "when", type: "text", label: "Note" },
    ],
  };
  assert.deepEqual(lintOptionSet(set), []);
  assert.deepEqual(validateAnswers(set, {}), []);
  assert.equal(quoteAddons(set, { msg: "Hi" }, { baseMinor: 0 }).perItemMinor, 0);
  assert.equal(computeVisibility(set, {}).when, true);
  assert.equal(validateAnswers(set, { wrap: true })[0].code, "required");
  assert.equal(quoteAddons(set, { wrap: true, msg: "Hi" }, { baseMinor: 0 }).perItemMinor, 400);
  // the Function set keeps groups so checkout applies the same rule
  assert.deepEqual(toFunctionSet(set).fields.map((f) => f.id), ["wrap", "grp", "msg", "grp2", "when"]);
});

test("product list: real products priced per unit with their variant id", () => {
  const set = {
    id: "p", v: 1, defaultLocale: "en",
    fields: [
      { id: "pl", type: "product_list", label: "Add a gift box", settings: { multiple: true }, scope: "line",
        values: [
          { id: "box", label: "Gift box", variantId: "gid://shopify/ProductVariant/11", price: 6 },
          { id: "card", label: "Card", variantId: "gid://shopify/ProductVariant/12", price: 2.5 },
        ] },
      { id: "dl", type: "design_layer", label: "Preview", settings: { sourceField: "nope" } },
    ],
  };
  assert.deepEqual(lintOptionSet(set), ["Preview: choose the text option it shows"]);
  const q = quoteAddons(set, { pl: ["box", "card"] }, { baseMinor: 0, currency: "USD" });
  assert.deepEqual(q.lines.map((l) => [l.variantId, l.amountMinor, l.scope]), [["gid://shopify/ProductVariant/11", 600, "item"], ["gid://shopify/ProductVariant/12", 250, "item"]]);
  assert.equal(toFunctionSet(set).fields[0].values[0].variantId, "gid://shopify/ProductVariant/11");
  assert.deepEqual(toFunctionSet(set).fields.map((f) => f.id), ["pl"]);
});
