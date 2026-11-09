import db from "../db.server";
import { gql, assertNoUserErrors } from "./admin-api.server";
import { planFor } from "./plans";
import { DEFAULT_STRINGS } from "../../storefront/format.js";

// Storefront copy (PRD "Copy" section). The storefront script owns the list of
// keys and defaults; merchants override any of them per language in Settings.
export { DEFAULT_STRINGS };

const LABELS = {
  price: "Price beside a choice",
  per_char: "Price per character",
  per_unit: "Price per unit",
  add_to_cart: "Add-to-cart button with add-ons",
  counter: "Character counter",
  required: "Required field missing",
  charset_letters: "Wrong format (letters only)",
  charset_numbers: "Wrong format (numbers only)",
  max_select: "Too many selections",
  upload_drop: "Upload hint",
  upload_too_large: "Upload too large",
  upload_failed: "Upload failed",
  date_note: "Date note",
  subscription: "Subscription selected",
  yes: "Checked value (cart)",
};

/** Human label for a storefront string key. */
export const STRING_LABELS = Object.fromEntries(
  Object.keys(DEFAULT_STRINGS).map((k) => [k, LABELS[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())]),
);

export const MAX_OPTION_LINES = 8;

export function currentMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/** Load (or create) the settings row for a shop. */
export async function getSettings(shop) {
  const existing = await db.shopSettings.findUnique({ where: { shop } });
  if (existing) return rollUsageMonth(existing);
  return db.shopSettings.create({ data: { shop, usageMonth: currentMonth() } });
}

export function parseSettingsJson(settings) {
  try {
    return JSON.parse(settings.settings || "{}");
  } catch {
    return {};
  }
}

/** Reset the Free plan add-on counter at the start of each month. */
export async function rollUsageMonth(settings) {
  const month = currentMonth();
  if (settings.usageMonth === month) return settings;
  return db.shopSettings.update({
    where: { shop: settings.shop },
    data: { usageMonth: month, addonOrdersThisMonth: 0, pricingPaused: false },
  });
}

/** Shop metafield `$app:config` read by the theme app extension. */
export function storefrontConfig(settings) {
  const plan = planFor(settings.plan);
  const extra = parseSettingsJson(settings);
  return {
    pricingPaused: !!settings.pricingPaused,
    uploadUrl: "/apps/shine-options/uploads",
    maxUploadMb: plan.maxUploadMb,
    maxFiles: plan.maxFiles,
    strings: extra.strings || {},
    rollout: extra.rollout || {},
  };
}

/** `$app:config` on the CartTransform and Validation objects. */
export function functionConfig(settings) {
  return {
    addonVariantId: settings.addonVariantId || null,
    pricingPaused: !!settings.pricingPaused,
    maxFiles: planFor(settings.plan).maxFiles,
    // Personalized lines per checkout that stay inside the JS Function
    // instruction budget (measured: 8 lines x 5 fields ~ 8.1M of 11M).
    maxOptionLines: MAX_OPTION_LINES,
  };
}

const SET_METAFIELDS = `#graphql
  mutation ShineSetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key }
      userErrors { field message }
    }
  }
`;

const SHOP_ID = `#graphql
  query ShineShopId { shop { id } }
`;

/** Push storefront + Function configuration metafields. */
export async function pushConfigs(admin, settings) {
  const { shop } = await gql(admin, SHOP_ID);
  const metafields = [
    {
      ownerId: shop.id,
      namespace: "$app",
      key: "config",
      type: "json",
      value: JSON.stringify(storefrontConfig(settings)),
    },
  ];
  const fn = JSON.stringify(functionConfig(settings));
  if (settings.cartTransformId) {
    metafields.push({ ownerId: settings.cartTransformId, namespace: "$app", key: "config", type: "json", value: fn });
  }
  if (settings.validationId) {
    metafields.push({ ownerId: settings.validationId, namespace: "$app", key: "config", type: "json", value: fn });
  }
  const data = await gql(admin, SET_METAFIELDS, { metafields });
  assertNoUserErrors(data.metafieldsSet, "Saving app configuration");
}

export async function updateSettings(shop, data) {
  return db.shopSettings.update({ where: { shop }, data });
}

/**
 * Count an order that was charged add-ons. On the Free plan, pricing pauses
 * when the monthly limit is reached (options still show, without prices).
 * @returns {Promise<boolean>} true when the pause state changed
 */
export async function recordAddonOrder(shop) {
  let settings = await getSettings(shop);
  settings = await db.shopSettings.update({
    where: { shop },
    data: { addonOrdersThisMonth: { increment: 1 } },
  });
  const limit = planFor(settings.plan).addonOrderLimit;
  const shouldPause = limit !== null && settings.addonOrdersThisMonth >= limit;
  if (shouldPause !== settings.pricingPaused) {
    await db.shopSettings.update({ where: { shop }, data: { pricingPaused: shouldPause } });
    return true;
  }
  return false;
}

export async function audit(shop, action, { actor = "", optionSetId = null, details = "" } = {}) {
  try {
    await db.auditLog.create({
      data: { shop, action, actor, optionSetId, details: typeof details === "string" ? details : JSON.stringify(details) },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
