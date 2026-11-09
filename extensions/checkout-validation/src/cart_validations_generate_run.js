// @ts-check
import { decodeSelection, evaluateSelection, t, validateEvaluated } from "../../../shared/options-core.js";

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 * @typedef {import("../../../shared/options-core.js").OptionSet} OptionSet
 * @typedef {import("../../../shared/options-core.js").ValidationIssue} ValidationIssue
 */

const TARGET = "$.cart";

/**
 * Most personalized lines one checkout supports. Above this the pricing
 * Function could run out of instructions (Shopify allows 11M per run), so we
 * stop the checkout with a clear message instead of risking a failed or
 * undercharged order. Overridable per shop with `maxOptionLines` in config.
 * Chosen from `shopify app function run` benchmarks of the pricing Function.
 */
const DEFAULT_MAX_OPTION_LINES = 8;

/**
 * Checkout copy from the PRD ("Checkout (Validation Function messages)").
 * @param {ValidationIssue} issue
 * @param {string} product
 * @param {string} field
 */
function messageFor(issue, product, field) {
  switch (issue.code) {
    case "required":
      return `${product} needs ${field}. Go back to the product page to add it.`;
    case "invalid_value":
      return `Your ${field} choice is no longer available for ${product}. Please choose again.`;
    default:
      return `${product} needs a valid ${field}. Go back to the product page to fix it.`;
  }
}

/**
 * Blocks checkout when a product with an option set is missing a required
 * choice, carries a value that isn't in the set, breaks a field rule, or was
 * personalized against an option set the product no longer uses. A line with
 * no selection at all is checked too, which catches quick add and "Buy it now"
 * paths that skipped the product form.
 *
 * Errors are only returned during checkout, never on cart interactions, so a
 * stale line can't stop the shopper from editing or emptying their cart.
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  /** @type {{ message: string, target: string }[]} */
  const errors = [];
  if (input.buyerJourney?.step === "CART_INTERACTION") return result(errors);

  const lines = input.cart.lines;

  // Cheap pass first: too many personalized lines -> one message, no per-line work.
  /** @type {{ maxOptionLines?: number } | null} */
  const config = /** @type {any} */ (input.validation?.config?.jsonValue) || null;
  const configured = Number(config?.maxOptionLines);
  const max = configured > 0 ? Math.floor(configured) : DEFAULT_MAX_OPTION_LINES;
  let optionLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.merchandise;
    if (line.selection?.value || (m.__typename === "ProductVariant" && m.product.pricing?.jsonValue)) optionLines++;
  }
  if (optionLines > max) {
    errors.push({
      message: `You can check out up to ${max} personalized items at a time. Please split your order.`,
      target: TARGET,
    });
    return result(errors);
  }

  const today = input.shop.localTime.date;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {string} message */
  const add = (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    errors.push({ message, target: TARGET });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;
    /** @type {OptionSet | null} */
    const set = /** @type {any} */ (merchandise.product.pricing?.jsonValue) || null;
    if (!set || !Array.isArray(set.fields) || set.fields.length === 0) continue;

    const product = merchandise.product.title;
    const selection = decodeSelection(line.selection?.value);

    if (selection && selection.s !== set.id) {
      add(`We updated the price for ${product}. Please review your cart.`);
      continue;
    }

    const ev = evaluateSelection(set, selection ? selection.a : null, { variantId: merchandise.id, noQuote: true });
    const issues = validateEvaluated(set, ev, { today, sellingPlan: !!line.sellingPlanAllocation });
    let lastField = "";
    for (let k = 0; k < issues.length; k++) {
      const issue = issues[k];
      if (issue.fieldId === lastField) continue; // one message per field is enough (issues are grouped by field)
      lastField = issue.fieldId;
      const field = ev.fieldsById[issue.fieldId];
      add(messageFor(issue, product, t(field?.label, set.defaultLocale) || "a choice"));
    }
  }

  return result(errors);
}

/** @param {{ message: string, target: string }[]} errors @returns {CartValidationsGenerateRunResult} */
function result(errors) {
  return { operations: [{ validationAdd: { errors } }] };
}
