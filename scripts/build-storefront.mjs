#!/usr/bin/env node
/**
 * Bundles the storefront scripts into the theme app extension assets:
 *   storefront/guard.js  -> assets/shine-options.js          (schema script, every page, tiny)
 *   storefront/index.js  -> assets/shine-options-product.js  (product pages with an option set;
 *                                                             includes shared/options-core.js)
 *   storefront/widget-date.js   -> assets/shine-options-date.js    (only when the set has a date field)
 *   storefront/widget-upload.js -> assets/shine-options-upload.js  (only when the set has a file field)
 *   storefront/widget-layer.js  -> assets/shine-options-layer.js   (only when the set has a design layer)
 *
 *   node scripts/build-storefront.mjs           one-off build, prints sizes
 *   node scripts/build-storefront.mjs --watch   rebuild on change (use beside `shopify app dev`)
 */
import { build, context } from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "extensions/product-options/assets");
const BUDGET_GZIP = 20 * 1024; // PRD NFR: storefront script 20 KB or less gzipped (both files together)
const BUDGET_SCHEMA_RAW = 10000; // Shopify's suggested limit for JS referenced by a block schema
const entries = {
  "shine-options": path.join(root, "storefront/guard.js"),
  "shine-options-product": path.join(root, "storefront/index.js"),
  "shine-options-date": path.join(root, "storefront/widget-date.js"),
  "shine-options-upload": path.join(root, "storefront/widget-upload.js"),
  "shine-options-layer": path.join(root, "storefront/widget-layer.js"),
};
const BUDGET_PAGE_GZIP = 10000; // theme-check AssetSizeJavaScript: JS on a page load, compressed

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: entries,
  outdir: assets,
  bundle: true,
  format: "iife",
  minify: true,
  target: ["es2018", "chrome80", "safari13", "firefox78", "edge80"],
  legalComments: "none",
  banner: { js: "/* Shine Options storefront. Built from storefront/ — do not edit. */" },
  logLevel: "info",
};

function report() {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  let totalGz = 0;
  for (const name of Object.keys(entries)) {
    const code = readFileSync(path.join(assets, `${name}.js`));
    const gz = gzipSync(code, { level: 9 }).length;
    totalGz += gz;
    console.log(`${name}.js: ${kb(code.length)} raw, ${kb(gz)} gzip`);
    if (name === "shine-options-product" && gz > BUDGET_PAGE_GZIP) {
      console.warn(`${name}.js is over the ${BUDGET_PAGE_GZIP} B per-page theme guideline.`);
    }
    if (name === "shine-options" && code.length > BUDGET_SCHEMA_RAW) {
      console.error(`${name}.js is over Shopify's ${BUDGET_SCHEMA_RAW} B app block script limit.`);
      process.exitCode = 1;
    }
  }
  console.log(`worst-case product page: ${kb(totalGz)} gzip (budget ${kb(BUDGET_GZIP)})`);
  if (totalGz > BUDGET_GZIP) {
    console.error("Over the storefront script budget.");
    process.exitCode = 1;
  }
}

if (process.argv.includes("--watch")) {
  const ctx = await context({
    ...options,
    plugins: [{ name: "size", setup: (b) => b.onEnd((r) => !r.errors.length && report()) }],
  });
  await ctx.watch();
} else {
  await build(options);
  report();
}
