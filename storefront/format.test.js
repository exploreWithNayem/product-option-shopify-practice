import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STRINGS, fileKind, fill, issueMessage, makeMoney, parseRate, propertyKey, quickAddTarget, typesText } from "./format.js";

test("fill replaces known placeholders only", () => {
  assert.equal(fill("Please add {field} to continue.", { field: "Monogram" }), "Please add Monogram to continue.");
  assert.equal(fill("{used}/{max} characters", { used: 2, max: 3 }), "2/3 characters");
  assert.equal(fill("Keep {unknown}", {}), "Keep {unknown}");
});

test("money formats minor units per currency", () => {
  assert.equal(makeMoney("USD", "en")(8500), "$85.00");
  assert.equal(makeMoney("JPY", "ja")(1514), "￥1,514");
  assert.match(makeMoney("EUR", "fr")(920), /^9,20\s€$/);
  assert.equal(parseRate("0.92"), 0.92);
  assert.equal(parseRate(undefined), 1);
  assert.equal(parseRate("abc"), 1);
});

test("PRD copy for validation issues", () => {
  const field = { label: { en: "Monogram", fr: "Monogramme" } };
  assert.equal(issueMessage({ code: "required" }, field, DEFAULT_STRINGS, "en"), "Please add Monogram to continue.");
  assert.equal(issueMessage({ code: "charset", params: { charset: "letters" } }, field, DEFAULT_STRINGS, "en"), "Monogram can only use letters.");
  assert.equal(issueMessage({ code: "max_select", params: { max: 2 } }, field, DEFAULT_STRINGS, "en"), "Choose up to 2.");
  assert.equal(issueMessage({ code: "date_blocked" }, field, DEFAULT_STRINGS, "en"), DEFAULT_STRINGS.date_unavailable);
  assert.equal(
    issueMessage({ code: "required" }, field, { ...DEFAULT_STRINGS, required: "Veuillez ajouter {field} pour continuer." }, "fr"),
    "Veuillez ajouter Monogramme pour continuer.",
  );
});

test("property keys never contain brackets", () => {
  assert.equal(propertyKey("Size [cm]"), "Size (cm)");
  assert.equal(propertyKey("  "), "Option");
});

test("upload kinds and hint text", () => {
  assert.equal(fileKind({ name: "photo.JPEG", type: "" }), "jpg");
  assert.equal(fileKind({ name: "scan", type: "application/pdf" }), "pdf");
  assert.equal(fileKind({ name: "evil.svg", type: "image/svg+xml" }), null);
  assert.equal(fileKind({ name: "a.png", type: "image/png" }, ["jpg"]), null);
  assert.equal(typesText(["jpg", "png", "pdf"]), "JPG, PNG or PDF");
  assert.equal(typesText(["pdf"]), "PDF");
  assert.equal(typesText(["jpg", "png"], "ou"), "JPG ou PNG");
});

test("quick-add guard sends required-option products to their page", () => {
  const map = { 111: "/products/tux" };
  const fd = new FormData();
  fd.set("id", "111");
  assert.equal(quickAddTarget(fd, map), "/products/tux");
  fd.set("properties[_shine_options]", '{"s":"x","v":1,"a":{}}');
  assert.equal(quickAddTarget(fd, map), null);
  assert.equal(quickAddTarget(JSON.stringify({ items: [{ id: 222 }, { id: 111, quantity: 1 }] }), map), "/products/tux");
  assert.equal(quickAddTarget(JSON.stringify({ id: 111, properties: { _shine_options: "{}" } }), map), null);
  assert.equal(quickAddTarget("id=111&quantity=1", map), "/products/tux");
  assert.equal(quickAddTarget("id=999", map), null);
  assert.equal(quickAddTarget("{bad json", map), null);
});

test("messages for the new option types", async () => {
  const { safeFont, safeHex } = await import("./format.js");
  const field = { label: "Size" };
  assert.equal(issueMessage({ code: "dimension_invalid" }, field, DEFAULT_STRINGS, "en"), "Enter both width and height for Size.");
  assert.equal(issueMessage({ code: "min_value", params: { min: 20, side: "width" } }, field, DEFAULT_STRINGS, "en"), "Size width must be at least 20.");
  assert.equal(issueMessage({ code: "max_value", params: { max: 200, side: "height" } }, field, DEFAULT_STRINGS, "en"), "Size height can be at most 200.");
  assert.equal(issueMessage({ code: "min_value", params: { min: 5 } }, field, DEFAULT_STRINGS, "en"), "Size must be at least 5.");
  assert.equal(issueMessage({ code: "time_invalid" }, field, DEFAULT_STRINGS, "en"), "Choose an available time for Size.");
  assert.equal(issueMessage({ code: "time_unavailable" }, field, DEFAULT_STRINGS, "en"), "Choose an available time for Size.");
  assert.equal(issueMessage({ code: "color_invalid" }, field, DEFAULT_STRINGS, "en"), "Choose a color for Size.");
  assert.equal(fill(DEFAULT_STRINGS.per_area, { price: "$0.01", unit: "cm" }), "+$0.01 per cm²");

  assert.equal(safeFont('"Brush Script MT", cursive'), '"Brush Script MT", cursive');
  assert.equal(safeFont("Arial; background:url(x)"), "");
  assert.equal(safeFont("x}body{color:red"), "");
  assert.equal(safeHex("#ABC"), "#aabbcc");
  assert.equal(safeHex("#12ab9f"), "#12ab9f");
  assert.equal(safeHex("red"), "");
  assert.equal(safeHex("#12345"), "");
});

test("design layer placement is relative to the image box", async () => {
  const { layerBox } = await import("./layer.js");
  const box = layerBox({ left: 110, top: 220, width: 400, height: 300 }, { left: 100, top: 200 }, { x: 50, y: 25, size: 10 });
  assert.deepEqual(box, { left: 210, top: 95, fontSize: 40, maxWidth: 360 });
  // out-of-range values are clamped, tiny sizes get a readable minimum
  const c = layerBox({ left: 0, top: 0, width: 100, height: 100 }, { left: 0, top: 0 }, { x: 150, y: -5, size: 0.1 });
  assert.equal(c.left, 100);
  assert.equal(c.top, 0);
  assert.equal(c.fontSize, 8);
});
