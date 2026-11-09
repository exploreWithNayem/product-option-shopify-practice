// @ts-check
import {
  PROPERTY_KEY,
  decodeSelection,
  displayEntries,
  evaluateSelection,
  fromMinor,
  t,
  toMinor,
  unitAddonMinor,
} from "../../../shared/options-core.js";

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 * @typedef {import("../generated/api").Operation} Operation
 * @typedef {import("../../../shared/options-core.js").OptionSet} OptionSet
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * Prices product add-ons (PRD path A): a line with priced choices is expanded
 * into the product at its own price, one component per product-list pick (a
 * real product with its own inventory, at its own price), and the hidden add-on
 * variant priced with whatever add-on amount remains. The cart still shows one line. The amount is always
 * recomputed here from the option set; nothing the browser sends is trusted
 * except which choices were made.
 *
 * Large carts are not cut short here (that would undercharge): the validation
 * Function blocks checkout above the supported number of personalized lines.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  /** @type {{ addonVariantId?: string, pricingPaused?: boolean } | null} */
  const config = /** @type {any} */ (input.cartTransform?.config?.jsonValue) || null;
  if (!config || config.pricingPaused) return NO_CHANGES;

  const rate = Number(input.presentmentCurrencyRate) || 1;
  /** @type {Operation[]} */
  const operations = [];

  for (const line of input.cart.lines) {
    if (line.sellingPlanAllocation) continue; // Shopify rejects transforms with a selling plan
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;
    const raw = line.selection?.value;
    if (!raw) continue;
    /** @type {OptionSet | null} */
    const set = /** @type {any} */ (merchandise.product.pricing?.jsonValue) || null;
    if (!set || !Array.isArray(set.fields)) continue;
    const selection = decodeSelection(raw);
    if (!selection) continue;

    const currency = line.cost.amountPerQuantity.currencyCode;
    const baseMinor = toMinor(Number(line.cost.amountPerQuantity.amount), currency);
    const ev = evaluateSelection(set, selection.a, { variantId: merchandise.id, baseMinor, rate, currency });
    const addonMinor = unitAddonMinor(ev.quote, line.quantity);
    if (addonMinor <= 0) continue;

    // Product-list picks become their own components. Duplicates of one variant are
    // merged (unit price rounded up so the shopper is never undercharged).
    /** @type {Map<string, { count: number, totalMinor: number }>} */
    const products = new Map();
    for (let i = 0; i < ev.quote.lines.length; i++) {
      const p = ev.quote.lines[i];
      if (!p.variantId) continue;
      const cur = products.get(p.variantId) || { count: 0, totalMinor: 0 };
      cur.count += 1;
      cur.totalMinor += p.amountMinor;
      products.set(p.variantId, cur);
    }
    /** @type {any[]} */
    const productItems = [];
    let productMinor = 0;
    for (const [variantId, { count, totalMinor }] of products) {
      const unit = Math.ceil(totalMinor / count);
      productMinor += unit * count;
      productItems.push({
        merchandiseId: variantId,
        quantity: count,
        price: { adjustment: { fixedPricePerUnit: { amount: fromMinor(unit, currency) } } },
      });
    }
    const restMinor = addonMinor - productMinor;
    if (restMinor > 0 && !config.addonVariantId) continue; // can't charge the remainder: leave the line alone

    const locale = set.defaultLocale;
    // Component 1 carries the canonical choices (store language) for fulfillment,
    // plus the raw selection so order webhooks can decode it after expansion.
    const entries = displayEntries(set, ev.answers, { locale });
    /** @type {{ key: string, value: string }[]} */
    const choices = [];
    for (let i = 0; i < entries.length; i++) choices.push({ key: entries[i].key, value: entries[i].value });
    choices.push({ key: PROPERTY_KEY, value: raw });

    // Hidden add-on variant: one attribute summarizing the non-product add-ons.
    let summary = "";
    let n = 0;
    for (let i = 0; i < ev.quote.lines.length; i++) {
      const p = ev.quote.lines[i];
      if (p.variantId) continue;
      const field = ev.fieldsById[p.fieldId];
      let name = t(field?.label, locale) || p.fieldId;
      if (p.valueId && field?.values) {
        for (let j = 0; j < field.values.length; j++) {
          if (field.values[j].id === p.valueId) {
            name += `: ${t(field.values[j].label, locale)}`;
            break;
          }
        }
      }
      summary += `${n++ ? ", " : ""}${name} +${fromMinor(p.amountMinor, currency)}${p.scope === "line" ? " once per line" : ""}`;
    }

    /** @type {any[]} */
    const items = [
      {
        merchandiseId: merchandise.id,
        quantity: 1,
        price: { adjustment: { fixedPricePerUnit: { amount: fromMinor(baseMinor, currency) } } },
        attributes: choices,
      },
      ...productItems,
    ];
    if (restMinor > 0) {
      items.push({
        merchandiseId: config.addonVariantId,
        quantity: 1,
        price: { adjustment: { fixedPricePerUnit: { amount: fromMinor(restMinor, currency) } } },
        attributes: [{ key: "Add-ons", value: `${summary} (${currency})` }],
      });
    }

    operations.push({ lineExpand: { cartLineId: line.id, expandedCartItems: items } });
  }

  return operations.length ? { operations } : NO_CHANGES;
}
