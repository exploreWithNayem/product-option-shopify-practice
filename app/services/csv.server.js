// CSV import/export of option sets (PRD F15). One row per field; JSON columns
// carry nested data so an export re-imports to identical sets.

import db from "../db.server";
import { FIELD_TYPES } from "../../shared/options-core.js";
import { EMPTY_RULES, listSets, nextNumber } from "./optionSets.server";
import { audit } from "./settings.server";

export const COLUMNS = [
  "set_id",
  "set_name",
  "status",
  "priority",
  "rules_json",
  "field_id",
  "type",
  "label_json",
  "help_json",
  "placeholder_json",
  "required",
  "price_json",
  "scope",
  "values_json",
  "settings_json",
  "condition_json",
];

const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const j = (v) => (v === undefined || v === null ? "" : JSON.stringify(v));

export function toCsv(rows) {
  return [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** RFC 4180 parser. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const s = String(text).replace(/^\uFEFF/, "");
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

export async function exportSetsCsv(shop, ids = null) {
  const sets = (await listSets(shop)).filter((s) => !ids || ids.includes(s.id));
  const rows = [];
  for (const s of sets) {
    const base = { set_id: s.id, set_name: s.name, status: s.status, priority: s.priority, rules_json: j(s.rules) };
    if (!s.fields.length) {
      rows.push(base);
      continue;
    }
    for (const f of s.fields) {
      rows.push({
        ...base,
        field_id: f.id,
        type: f.type,
        label_json: j(f.label),
        help_json: j(f.help),
        placeholder_json: j(f.placeholder),
        required: f.required ? "true" : "false",
        price_json: j(f.price),
        scope: f.scope || "",
        values_json: j(f.values),
        settings_json: j(f.settings),
        condition_json: j(f.condition),
      });
    }
  }
  return toCsv(rows);
}

/**
 * Import: rows grouped by set_id (or set_name when set_id is empty). Existing
 * sets in this shop are updated (working copy; publish to go live); new ones
 * are created as drafts.
 * @returns {Promise<{ created: number, updated: number, errors: string[] }>}
 */
export async function importSetsCsv(shop, text, actor = "") {
  const table = parseCsv(text);
  if (!table.length) return { created: 0, updated: 0, errors: ["The file is empty."] };
  const header = table[0].map((h) => h.trim());
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { created: 0, updated: 0, errors: [`Missing columns: ${missing.join(", ")}`] };
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const errors = [];
  const groups = new Map();

  const parse = (raw, line, col) => {
    if (raw === undefined || raw === "") return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      errors.push(`Row ${line}: ${col} isn't valid JSON.`);
      return undefined;
    }
  };

  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const get = (c) => r[idx[c]] ?? "";
    const key = get("set_id") || `name:${get("set_name")}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: get("set_id"),
        name: get("set_name") || "Imported option set",
        status: get("status"),
        priority: Number(get("priority")) || 0,
        rules: parse(get("rules_json"), line, "rules_json") || EMPTY_RULES,
        fields: [],
      });
    }
    if (!get("field_id")) return;
    const type = get("type");
    if (!FIELD_TYPES.includes(type)) {
      errors.push(`Row ${line}: unknown field type "${type}".`);
      return;
    }
    const field = { id: get("field_id"), type, label: parse(get("label_json"), line, "label_json") ?? "" };
    const opt = {
      help: parse(get("help_json"), line, "help_json"),
      placeholder: parse(get("placeholder_json"), line, "placeholder_json"),
      price: parse(get("price_json"), line, "price_json"),
      values: parse(get("values_json"), line, "values_json"),
      settings: parse(get("settings_json"), line, "settings_json"),
      condition: parse(get("condition_json"), line, "condition_json"),
    };
    if (get("required") === "true") field.required = true;
    if (get("scope")) field.scope = get("scope");
    for (const [k, v] of Object.entries(opt)) if (v !== undefined) field[k] = v;
    groups.get(key).fields.push(field);
  });

  if (errors.length) return { created: 0, updated: 0, errors };

  let created = 0;
  let updated = 0;
  for (const g of groups.values()) {
    const existing = g.id ? await db.optionSet.findFirst({ where: { shop, id: g.id } }) : null;
    if (existing) {
      await db.optionSet.update({
        where: { id: existing.id },
        data: {
          name: g.name,
          priority: g.priority,
          rules: JSON.stringify({ ...EMPTY_RULES, ...g.rules }),
          fields: JSON.stringify(g.fields),
          ...(g.status === "archived" ? { status: "archived" } : {}),
        },
      });
      updated++;
    } else {
      await db.optionSet.create({
        data: {
          shop,
          number: await nextNumber(shop),
          name: g.name,
          priority: g.priority,
          rules: JSON.stringify({ ...EMPTY_RULES, ...g.rules }),
          fields: JSON.stringify(g.fields),
          status: g.status === "archived" ? "archived" : "draft",
        },
      });
      created++;
    }
  }
  await audit(shop, "import", { actor, details: `${created} created, ${updated} updated` });
  return { created, updated, errors };
}
