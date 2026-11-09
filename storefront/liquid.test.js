import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shopify's Liquid tokenizer ends an output tag {{ ... }} at the first "}", so a
// literal like '{used}' inside one fails to parse on Shopify (offline theme-check
// accepts it). Brace placeholders belong inside {% liquid %} tags instead.
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extensions/product-options");

function liquidFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return liquidFiles(p);
    return e.name.endsWith(".liquid") ? [p] : [];
  });
}

test("no output tag contains a literal brace", () => {
  const offenders = [];
  for (const file of liquidFiles(ext)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      if (/[{}]/.test(m[1])) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(ext, file)}:${line} ${m[0].slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
