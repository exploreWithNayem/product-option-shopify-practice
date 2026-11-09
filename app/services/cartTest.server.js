// Built-in test (PRD user flow step 6): put a product with priced choices in a
// real Storefront API cart, let the Cart Transform price it, and compare the
// cart total with what the option set says it should be.

import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  PROPERTY_KEY,
  displayEntries,
  effectiveAnswers,
  encodeSelection,
  fromMinor,
  isChoiceType,
  lineTotalMinor,
  quoteAddons,
  toMinor,
} from "../../shared/options-core.js";
import { gql } from "./admin-api.server";
import { activeSetsForSync, resolvedSetJson } from "./optionSets.server";
import { getSettings } from "./settings.server";

const PRODUCT = `#graphql
  query ShineTestProduct($id: ID!) {
    product(id: $id) {
      id
      title
      variants(first: 1) {
        nodes {
          id
          price
        }
      }
    }
  }
`;

const CART_CREATE = `#graphql
  mutation ShineTestCart($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        cost {
          totalAmount {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Build a selection that exercises at least one priced choice. */
export function sampleAnswers(set) {
  const answers = {};
  for (const f of set.fields) {
    if (isChoiceType(f.type)) {
      const priced = (f.values || []).find((v) => v.price > 0) || (f.values || [])[0];
      if (priced) answers[f.id] = f.type === "checkbox_group" || (f.type === "buttons" && f.settings?.multiple) ? [priced.id] : priced.id;
    } else if (f.type === "checkbox" || f.type === "toggle") answers[f.id] = true;
    else if (f.type === "text" || f.type === "textarea") {
      const letters = "ABCDEFGH".slice(0, Math.max(1, Math.min(2, Number(f.settings?.maxLength) || 2)));
      answers[f.id] = f.settings?.charset === "numbers" ? "12" : letters;
    } else if (f.type === "number") answers[f.id] = Number(f.settings?.min) || 1;
    else if (f.type === "contact") answers[f.id] = f.settings?.format === "phone" ? "+15555550100" : "test@example.com";
  }
  return answers;
}

/**
 * @returns {Promise<{ ok: boolean, message: string, details?: Record<string, string> }>}
 */
export async function runCartTest(admin, shop) {
  const settings = await getSettings(shop);
  const sets = await activeSetsForSync(shop);
  if (!sets.length) return { ok: false, message: "Publish an option set first." };

  // Pick an assigned product, preferring sets with prices.
  const assignment = await db.productAssignment.findFirst({
    where: { shop, optionSetId: { in: sets.map((s) => s.id) } },
    orderBy: { updatedAt: "desc" },
  });
  if (!assignment) return { ok: false, message: "Assign your option set to at least one product first." };
  const set = sets.find((s) => s.id === assignment.optionSetId);
  const full = resolvedSetJson(set, settings.primaryLocale);

  const data = await gql(admin, PRODUCT, { id: assignment.productId });
  const variant = data.product?.variants.nodes[0];
  if (!variant) return { ok: false, message: "The assigned product has no variants." };

  const currency = settings.currency;
  const baseMinor = toMinor(Number(variant.price), currency);
  const answers = effectiveAnswers(full, sampleAnswers(full), { variantId: variant.id });
  const quote = quoteAddons(full, answers, { variantId: variant.id, baseMinor, currency });
  const expected = lineTotalMinor(baseMinor, quote, 1);
  const attributes = [
    ...displayEntries(full, answers, { locale: settings.primaryLocale }).map(({ key, value }) => ({ key, value })),
    { key: PROPERTY_KEY, value: encodeSelection(full, answers) },
  ];

  let cart;
  try {
    const { storefront } = await unauthenticated.storefront(shop);
    const res = await storefront.graphql(CART_CREATE, {
      variables: { input: { lines: [{ merchandiseId: variant.id, quantity: 1, attributes }] } },
    });
    const json = await res.json();
    const payload = json.data?.cartCreate;
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e) => e.message).join("; "));
    cart = payload?.cart;
  } catch (e) {
    return { ok: false, message: `The test cart couldn't be created: ${e.message}` };
  }

  const actual = toMinor(Number(cart.cost.totalAmount.amount), cart.cost.totalAmount.currencyCode);
  const details = {
    Product: data.product.title,
    "Option set": set.name,
    "Product price": `${fromMinor(baseMinor, currency)} ${currency}`,
    "Add-ons": `${fromMinor(expected - baseMinor, currency)} ${currency}`,
    "Expected total": `${fromMinor(expected, currency)} ${currency}`,
    "Cart total": `${cart.cost.totalAmount.amount} ${cart.cost.totalAmount.currencyCode}`,
  };
  if (settings.pricingPaused) {
    return { ok: false, message: "Add-on pricing is paused for this month (Free plan limit), so the cart shows the base price.", details };
  }
  if (actual === expected) {
    await db.shopSettings.update({ where: { shop }, data: { testPassedAt: new Date() } });
    return { ok: true, message: "Test passed: the cart total includes your add-ons.", details };
  }
  return {
    ok: false,
    message:
      quote.lines.length === 0
        ? "This option set has no priced choices, so there's nothing to charge. Add a price and test again."
        : "The cart total doesn't include the add-ons yet. Check that the app's functions are deployed and try again.",
    details,
  };
}
