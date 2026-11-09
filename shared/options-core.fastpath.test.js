// Guards the single-pass fast path (evaluateSelection / validateEvaluated /
// quoteAddons({effective})) against the original multi-pass implementation,
// kept below verbatim as an oracle. Randomized sets + answers, fixed seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeVisibility,
  displayEntries,
  effectiveAnswers,
  evaluateSelection,
  isChoiceType,
  isEmpty,
  isMultiSelect,
  normalizeAnswer,
  PRICE_TYPES_BY_FIELD,
  quoteAddons,
  t,
  toMinor,
  validateAnswers,
  validateEvaluated,
  variantKey,
  chargeableChars,
  dayNumber,
  dateIssue,
} from "./options-core.js";
import { TEMPLATES } from "./templates.js";

// ---------- oracle: the original implementation ----------
function oEvalRule(rule, answers, variantId) {
  if (rule.source === "variant") {
    const wanted = Array.isArray(rule.value) ? rule.value.map(variantKey) : [variantKey(rule.value)];
    const hit = wanted.includes(variantKey(variantId));
    return rule.op === "is_not" ? !hit : hit;
  }
  const a = rule.field ? answers[rule.field] : undefined;
  switch (rule.op) {
    case "empty": return isEmpty(a);
    case "not_empty": return !isEmpty(a);
    case "is":
    case "is_not": {
      let hit;
      if (Array.isArray(a)) hit = a.map(String).includes(String(rule.value));
      else if (a === true) hit = rule.value === true || rule.value === "true";
      else hit = !isEmpty(a) && String(a) === String(rule.value);
      return rule.op === "is" ? hit : !hit;
    }
    case "contains":
      if (Array.isArray(a)) return a.map(String).includes(String(rule.value));
      return typeof a === "string" && a.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "gt": return !isEmpty(a) && Number(a) > Number(rule.value);
    case "lt": return !isEmpty(a) && Number(a) < Number(rule.value);
    default: return false;
  }
}
function oVisibility(set, answers, ctx = {}) {
  const visible = {};
  const effective = {};
  const variantId = variantKey(ctx.variantId);
  for (const field of set.fields || []) {
    const c = field.condition;
    let show = true;
    if (c && Array.isArray(c.rules) && c.rules.length) {
      const results = c.rules.map((r) => oEvalRule(r, r.field && r.field in visible ? effective : answers, variantId));
      const matched = c.match === "any" ? results.some(Boolean) : results.every(Boolean);
      show = c.action === "hide" ? !matched : matched;
    }
    visible[field.id] = show;
    if (show) effective[field.id] = answers[field.id];
  }
  return visible;
}
function oEffective(set, answers, ctx = {}) {
  const normalized = {};
  for (const field of set.fields || []) {
    const v = normalizeAnswer(field, answers ? answers[field.id] : undefined);
    if (v !== undefined) normalized[field.id] = v;
  }
  const visible = oVisibility(set, normalized, ctx);
  const out = {};
  for (const id in normalized) if (visible[id]) out[id] = normalized[id];
  return out;
}
function oQuote(set, answers, ctx) {
  const quote = { lines: [], perItemMinor: 0, perLineMinor: 0 };
  if (ctx.sellingPlan) return quote;
  const rate = Number(ctx.rate ?? 1) || 1;
  const currency = ctx.currency;
  const base = Math.max(0, Math.round(ctx.baseMinor || 0));
  const eff = oEffective(set, answers, ctx);
  const fixed = (amount) => toMinor((Number(amount) || 0) * rate, currency);
  const percent = (pct) => Math.round((base * (Number(pct) || 0)) / 100);
  for (const field of set.fields || []) {
    const a = eff[field.id];
    if (isEmpty(a)) continue;
    const scope = field.scope === "line" ? "line" : "item";
    const push = (amountMinor, valueId) => {
      if (!(amountMinor > 0)) return;
      quote.lines.push({ fieldId: field.id, valueId, amountMinor, scope });
      if (scope === "line") quote.perLineMinor += amountMinor;
      else quote.perItemMinor += amountMinor;
    };
    if (isChoiceType(field.type)) {
      const ids = Array.isArray(a) ? a : [a];
      for (const id of ids) {
        const value = (field.values || []).find((v) => v.id === id);
        if (!value || !value.price) continue;
        push(value.priceType === "percent" ? percent(value.price) : fixed(value.price), value.id);
      }
      continue;
    }
    const rule = field.price;
    if (!rule || !rule.amount) continue;
    const allowed = PRICE_TYPES_BY_FIELD[field.type] || [];
    if (!allowed.includes(rule.type)) continue;
    switch (rule.type) {
      case "fixed": push(fixed(rule.amount)); break;
      case "percent": push(percent(rule.amount)); break;
      case "per_char": push(fixed(rule.amount) * chargeableChars(a)); break;
      case "per_unit": push(fixed(rule.amount) * Math.max(0, Math.floor(Number(a) || 0))); break;
    }
  }
  return quote;
}
function oValidate(set, answers, ctx = {}) {
  const issues = [];
  const raw = answers || {};
  const norm = {};
  for (const field of set.fields || []) {
    const v = normalizeAnswer(field, raw[field.id]);
    if (v !== undefined) norm[field.id] = v;
  }
  const visible = oVisibility(set, norm, ctx);
  for (const field of set.fields || []) {
    if (!visible[field.id]) continue;
    const s = field.settings || {};
    const a = normalizeAnswer(field, raw[field.id]);
    const add = (code, params) => issues.push({ fieldId: field.id, code, params });
    if (isEmpty(a)) { if (field.required) add("required"); continue; }
    if (isChoiceType(field.type)) {
      const ids = Array.isArray(a) ? a : [a];
      const known = new Set((field.values || []).map((v) => v.id));
      const bad = ids.find((id) => !known.has(id));
      if (bad !== undefined) { add("invalid_value", { value: bad }); continue; }
      if (isMultiSelect(field)) {
        if (s.minSelect && ids.length < Number(s.minSelect)) add("min_select", { min: Number(s.minSelect) });
        if (s.maxSelect && ids.length > Number(s.maxSelect)) add("max_select", { max: Number(s.maxSelect) });
      }
      continue;
    }
    switch (field.type) {
      case "text":
      case "textarea": {
        const len = Array.from(String(a)).length;
        if (s.minLength && len < Number(s.minLength)) add("min_length", { min: Number(s.minLength) });
        if (s.maxLength && len > Number(s.maxLength)) add("max_length", { max: Number(s.maxLength) });
        if (field.type === "textarea" && s.maxLines && String(a).split("\n").length > Number(s.maxLines)) add("max_lines", { max: Number(s.maxLines) });
        if (field.type === "text" && s.charset && s.charset !== "any") {
          const re = s.charset === "letters" ? /^[\p{L}\s'-]*$/u : s.charset === "numbers" ? /^[0-9\s]*$/ : /^[\p{L}\p{N}\s'-]*$/u;
          if (!re.test(String(a))) add("charset", { charset: s.charset });
        }
        break;
      }
      case "number": {
        const n = Number(a);
        if (s.min !== undefined && s.min !== null && s.min !== "" && n < Number(s.min)) add("min_value", { min: Number(s.min) });
        if (s.max !== undefined && s.max !== null && s.max !== "" && n > Number(s.max)) add("max_value", { max: Number(s.max) });
        if (s.step && Number(s.step) > 0) {
          const k = (n - (Number(s.min) || 0)) / Number(s.step);
          if (Math.abs(k - Math.round(k)) > 1e-9) add("step", { step: Number(s.step) });
        }
        break;
      }
      case "date": {
        if (!ctx.today) { if (Number.isNaN(dayNumber(a))) add("date_invalid"); break; }
        const issue = dateIssue(field, String(a), ctx.today);
        if (issue) add(issue);
        break;
      }
      case "file": {
        const max = Number(ctx.maxFiles ?? s.maxFiles ?? 1) || 1;
        if (Array.isArray(a) && a.length > max) add("max_files", { max });
        break;
      }
      case "contact": {
        const phone = s.format === "phone";
        const re = phone ? /^\+?[0-9 ().-]{6,20}$/ : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!re.test(String(a))) add(phone ? "format_phone" : "format_email");
        break;
      }
    }
  }
  return issues;
}
function oDisplay(set, answers, ctx = {}) {
  const locale = ctx.locale;
  const fallback = set.defaultLocale;
  const out = [];
  const seen = {};
  for (const field of set.fields || []) {
    const a = answers[field.id];
    if (isEmpty(a)) continue;
    let value;
    if (isChoiceType(field.type)) {
      const ids = Array.isArray(a) ? a : [a];
      value = ids.map((id) => (field.values || []).find((v) => v.id === id)).filter(Boolean).map((v) => t(v.label, locale, fallback)).join(", ");
    } else if (field.type === "checkbox" || field.type === "toggle") value = ctx.yes || "Yes";
    else if (Array.isArray(a)) value = a.join(", ");
    else value = String(a);
    if (!value) continue;
    let key = t(field.label, locale, fallback) || field.id;
    if (key.startsWith("_")) key = key.replace(/^_+/, "");
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key = `${key} (${seen[key]})`;
    out.push({ key, value, fieldId: field.id });
  }
  return out;
}

// ---------- random generator ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const TYPES = ["text", "textarea", "number", "dropdown", "radio", "checkbox", "checkbox_group", "toggle", "buttons", "color_swatch", "image_swatch", "date", "file", "contact"];
const OPS = ["is", "is_not", "empty", "not_empty", "contains", "gt", "lt"];

function randomSet(r, idx) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const n = 1 + Math.floor(r() * 8);
  const fields = [];
  for (let i = 0; i < n; i++) {
    const type = pick(TYPES);
    const f = { id: `f${i}`, type, label: r() < 0.5 ? `Label ${i % 3}` : { en: `L${i}`, fr: `FR${i}` } };
    if (r() < 0.4) f.required = true;
    if (r() < 0.3) f.scope = "line";
    if (isChoiceType(type)) {
      f.values = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, j) => {
        const v = { id: `v${j}`, label: `Val ${j}` };
        if (r() < 0.6) v.price = Math.round(r() * 2000) / 100;
        if (r() < 0.3) v.priceType = "percent";
        return v;
      });
      if (type === "buttons" && r() < 0.5) f.settings = { multiple: true };
      if (type === "checkbox_group") f.settings = { minSelect: r() < 0.3 ? 2 : undefined, maxSelect: r() < 0.5 ? 2 : undefined };
    } else if (r() < 0.7) {
      f.price = { type: pick(["fixed", "percent", "per_char", "per_unit"]), amount: Math.round(r() * 1500) / 100 };
    }
    if (type === "text") f.settings = { maxLength: r() < 0.5 ? 4 : undefined, minLength: r() < 0.3 ? 2 : undefined, charset: pick(["any", "letters", "numbers", "alphanumeric", undefined]) };
    if (type === "textarea") f.settings = { maxLines: 2, maxLength: 20 };
    if (type === "number") f.settings = { min: 1, max: 10, step: r() < 0.5 ? 2 : undefined };
    if (type === "date") f.settings = { leadDays: 2, maxDaysAhead: 30, weekdays: [1, 2, 3, 4, 5], blockedDates: ["2026-11-12"] };
    if (type === "file") f.settings = { maxFiles: 2 };
    if (type === "contact") f.settings = { format: r() < 0.5 ? "phone" : "email" };
    if (i > 0 && r() < 0.5) {
      const rules = Array.from({ length: 1 + Math.floor(r() * 2) }, () =>
        r() < 0.2
          ? { source: "variant", op: pick(["is", "is_not"]), value: r() < 0.5 ? "gid://shopify/ProductVariant/1" : ["2", "gid://shopify/ProductVariant/3"] }
          : { source: "field", field: `f${Math.floor(r() * i)}`, op: pick(OPS), value: pick(["v0", "v1", "true", true, "3", 5, "ab"]) },
      );
      f.condition = { action: r() < 0.7 ? "show" : "hide", match: r() < 0.5 ? "all" : "any", rules };
    }
    fields.push(f);
  }
  return { id: `s${idx}`, v: 1, defaultLocale: r() < 0.5 ? "en" : "fr", fields };
}

function randomAnswers(r, set) {
  const a = {};
  for (const f of set.fields) {
    if (r() < 0.25) continue;
    const roll = r();
    switch (f.type) {
      case "text": a[f.id] = ["AB", " abc ", "A1", "", "Élan d'or", "1234567"][Math.floor(roll * 6)]; break;
      case "textarea": a[f.id] = ["hi\r\nthere\nyou", "  ", "short"][Math.floor(roll * 3)]; break;
      case "number": a[f.id] = ["3", 4, "", "x", 11, "2.5"][Math.floor(roll * 6)]; break;
      case "checkbox": case "toggle": a[f.id] = [true, false, "on", "true", 1, "no"][Math.floor(roll * 6)]; break;
      case "date": a[f.id] = ["2026-11-10", "2026-11-12", "2026-11-07", "2026-02-30", "2027-01-30", "2026-11-14"][Math.floor(roll * 6)]; break;
      case "file": a[f.id] = [["https://x/1"], ["https://x/1", "https://x/1", "https://x/2", "https://x/3"], "https://x/9", []][Math.floor(roll * 4)]; break;
      case "contact": a[f.id] = ["a@b.co", "+1 555 123 4567", "nope", "x@y"][Math.floor(roll * 4)]; break;
      default: {
        const ids = (f.values || []).map((v) => v.id).concat(["bogus"]);
        if (isMultiSelect(f) || roll < 0.2) a[f.id] = ids.filter(() => r() < 0.5).concat(r() < 0.3 ? [ids[0], ids[0]] : []);
        else a[f.id] = ids[Math.floor(r() * ids.length)];
      }
    }
  }
  return a;
}

test("fast path matches the original implementation on 3000 random selections", () => {
  const r = rng(20261106);
  for (let i = 0; i < 3000; i++) {
    const set = randomSet(r, i);
    const answers = randomAnswers(r, set);
    const ctx = {
      variantId: ["gid://shopify/ProductVariant/1", "2", 7][i % 3],
      baseMinor: Math.floor(r() * 50000),
      rate: ["1.0", "0.92", "151.37"][i % 3],
      currency: ["USD", "EUR", "JPY"][i % 3],
      sellingPlan: i % 17 === 0,
    };
    const label = JSON.stringify({ set, answers, ctx });
    const eff = effectiveAnswers(set, answers, ctx);
    assert.deepEqual(eff, oEffective(set, answers, ctx), label);
    assert.deepEqual(computeVisibility(set, answers, ctx), oVisibility(set, answers, ctx), label);
    assert.deepEqual(quoteAddons(set, answers, ctx), oQuote(set, answers, ctx), label);
    assert.deepEqual(quoteAddons(set, eff, { ...ctx, effective: true }), oQuote(set, answers, ctx), label);

    const ev = evaluateSelection(set, answers, ctx);
    assert.deepEqual(ev.answers, eff, label);
    assert.deepEqual(ev.quote, oQuote(set, answers, ctx), label);
    for (const f of set.fields) assert.equal(ev.fieldsById[f.id], f);

    const vctx = { variantId: ctx.variantId, today: i % 5 ? "2026-11-06" : undefined };
    const expected = oValidate(set, answers, vctx);
    assert.deepEqual(validateAnswers(set, answers, vctx), expected, label);
    assert.deepEqual(validateEvaluated(set, evaluateSelection(set, answers, { variantId: ctx.variantId, noQuote: true }), vctx), expected, label);

    const dctx = { locale: i % 2 ? "fr" : "en", yes: i % 4 ? undefined : "Oui" };
    assert.deepEqual(displayEntries(set, eff, dctx), oDisplay(set, eff, dctx), label);
  }
});

test("templates: fast path equals original on their default answers", () => {
  for (const tpl of TEMPLATES) {
    const set = { id: tpl.key, v: 1, defaultLocale: "en", fields: tpl.fields };
    const answers = {};
    for (const f of tpl.fields) {
      const d = (f.values || []).find((v) => v.default);
      if (d) answers[f.id] = d.id;
      else if (f.type === "toggle" || f.type === "checkbox") answers[f.id] = true;
      else if (f.type === "text") answers[f.id] = "ABC";
    }
    const ctx = { baseMinor: 4999, currency: "USD" };
    assert.deepEqual(evaluateSelection(set, answers, ctx).quote, oQuote(set, answers, ctx), tpl.key);
  }
});

test("evaluateSelection with noQuote skips pricing", () => {
  const set = { id: "x", v: 1, fields: [{ id: "a", type: "toggle", label: "A", price: { type: "fixed", amount: 5 } }] };
  const ev = evaluateSelection(set, { a: true }, { noQuote: true });
  assert.deepEqual(ev.answers, { a: true });
  assert.equal(ev.quote.perItemMinor, 0);
  assert.equal(evaluateSelection(set, { a: true }, { baseMinor: 0 }).quote.perItemMinor, 500);
});

test("chargeableChars and length match Array.from on tricky strings", () => {
  const samples = ["", "AB", " A B ", "\tA\nB\r\v\f", " x y　﻿", "Élan d'or", "😀 A", "a\ud800b", "\udc00", "     z", "日本語 テキスト"];
  for (const s of samples) {
    assert.equal(chargeableChars(s), Array.from(s.replace(/\s+/g, "")).length, JSON.stringify(s));
  }
  const set = { id: "x", v: 1, fields: [{ id: "a", type: "text", label: "A", settings: { maxLength: 2 } }] };
  assert.deepEqual(validateAnswers(set, { a: "😀😀" }), []);
  assert.equal(validateAnswers(set, { a: "😀😀😀" })[0].code, "max_length");
  // exhaustive check of the whitespace table against the regex engine
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCharCode(c);
    assert.equal(chargeableChars(ch), /\s/.test(ch) ? 0 : 1, `U+${c.toString(16)}`);
  }
});
