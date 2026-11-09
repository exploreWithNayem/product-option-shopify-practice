import db from "../db.server";
import { gql, assertNoUserErrors } from "./admin-api.server";
import { getSettings, pushConfigs, functionConfig } from "./settings.server";
import { planKeyFromName } from "./plans";

export const PRICING_FUNCTION_HANDLE = "pricing";
export const VALIDATION_FUNCTION_HANDLE = "checkout-validation";
export const ADDON_PRODUCT_TAG = "shine-options-addon";

const SETUP_INFO = `#graphql
  query ShineSetupInfo {
    shop {
      id
      name
      currencyCode
      ianaTimezone
      myshopifyDomain
    }
    shopLocales {
      locale
      primary
      published
    }
    currentAppInstallation {
      activeSubscriptions {
        name
        status
      }
    }
    cartTransforms(first: 10) {
      nodes {
        id
        functionId
        blockOnFailure
      }
    }
    validations(first: 50) {
      nodes {
        id
        enabled
        blockOnFailure
        shopifyFunction {
          id
          apiType
          app {
            apiKey
          }
        }
      }
    }
  }
`;

const VARIANT_EXISTS = `#graphql
  query ShineAddonVariant($id: ID!) {
    productVariant(id: $id) {
      id
      product {
        id
      }
    }
  }
`;

const CREATE_ADDON_PRODUCT = `#graphql
  mutation ShineCreateAddonProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 1) {
          nodes {
            id
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

const UPDATE_ADDON_VARIANT = `#graphql
  mutation ShineUpdateAddonVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_CART_TRANSFORM = `#graphql
  mutation ShineCreateCartTransform($functionHandle: String!, $blockOnFailure: Boolean, $metafields: [MetafieldInput!]) {
    cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure, metafields: $metafields) {
      cartTransform {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_CART_TRANSFORM = `#graphql
  mutation ShineDeleteCartTransform($id: ID!) {
    cartTransformDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_VALIDATION = `#graphql
  mutation ShineCreateValidation($validation: ValidationCreateInput!) {
    validationCreate(validation: $validation) {
      validation {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Make sure everything the storefront and checkout need exists:
 * shop facts, the hidden add-on product, the Cart Transform, the Validation,
 * and the configuration metafields. Idempotent; cheap when already done.
 *
 * @returns {Promise<{ settings: any, problems: string[], locales: {locale: string, primary: boolean, published: boolean}[] }>}
 */
export async function ensureSetup(admin, shop, { force = false } = {}) {
  let settings = await getSettings(shop);
  const problems = [];
  const info = await gql(admin, SETUP_INFO);

  const primary = info.shopLocales.find((l) => l.primary)?.locale || "en";
  const active = (info.currentAppInstallation?.activeSubscriptions || []).find((s) => s.status === "ACTIVE");
  const plan = active ? planKeyFromName(active.name) : "free";

  const updates = {};
  if (settings.primaryLocale !== primary) updates.primaryLocale = primary;
  if (settings.currency !== info.shop.currencyCode) updates.currency = info.shop.currencyCode;
  if (settings.timezone !== info.shop.ianaTimezone) updates.timezone = info.shop.ianaTimezone;
  if (settings.plan !== plan) updates.plan = plan;

  // 1. Hidden add-on product (path A: the Function prices this variant).
  let addonOk = false;
  if (settings.addonVariantId) {
    const v = await gql(admin, VARIANT_EXISTS, { id: settings.addonVariantId });
    addonOk = !!v.productVariant;
  }
  if (!addonOk) {
    try {
      const { productId, variantId } = await createAddonProduct(admin, info.shop.name);
      updates.addonProductId = productId;
      updates.addonVariantId = variantId;
    } catch (e) {
      problems.push(`Couldn't create the add-on product: ${e.message}`);
    }
  }

  // 2. Cart Transform (one per app per store).
  const transform = info.cartTransforms.nodes[0];
  if (transform) {
    if (settings.cartTransformId !== transform.id) updates.cartTransformId = transform.id;
  } else {
    try {
      const merged = { ...settings, ...updates };
      const data = await gql(admin, CREATE_CART_TRANSFORM, {
        functionHandle: PRICING_FUNCTION_HANDLE,
        blockOnFailure: merged.failureMode !== "allow",
        metafields: [{ namespace: "$app", key: "config", type: "json", value: JSON.stringify(functionConfig(merged)) }],
      });
      assertNoUserErrors(data.cartTransformCreate, "Turning on add-on pricing");
      updates.cartTransformId = data.cartTransformCreate.cartTransform.id;
    } catch (e) {
      problems.push(`${e.message}. Deploy the app's functions, then reload.`);
    }
  }

  // 3. Checkout validation.
  const apiKey = process.env.SHOPIFY_API_KEY;
  const validation = info.validations.nodes.find(
    (v) => v.shopifyFunction?.app?.apiKey === apiKey && v.shopifyFunction?.apiType === "cart_checkout_validation",
  );
  if (validation) {
    if (settings.validationId !== validation.id) updates.validationId = validation.id;
  } else {
    try {
      const merged = { ...settings, ...updates };
      const data = await gql(admin, CREATE_VALIDATION, {
        validation: {
          functionHandle: VALIDATION_FUNCTION_HANDLE,
          enable: true,
          blockOnFailure: true,
          metafields: [{ namespace: "$app", key: "config", type: "json", value: JSON.stringify(functionConfig(merged)) }],
        },
      });
      assertNoUserErrors(data.validationCreate, "Turning on checkout validation");
      updates.validationId = data.validationCreate.validation.id;
    } catch (e) {
      problems.push(`${e.message}. Deploy the app's functions, then reload.`);
    }
  }

  const changed = Object.keys(updates).length > 0;
  if (changed) {
    settings = await db.shopSettings.update({ where: { shop }, data: updates });
  }
  if (changed || force) {
    try {
      await pushConfigs(admin, settings);
    } catch (e) {
      problems.push(e.message);
    }
  }
  return { settings, problems, locales: info.shopLocales };
}

async function createAddonProduct(admin, shopName) {
  const data = await gql(admin, CREATE_ADDON_PRODUCT, {
    product: {
      title: "Product options add-ons",
      status: "ACTIVE",
      vendor: shopName,
      productType: "Option add-on",
      tags: [ADDON_PRODUCT_TAG],
      descriptionHtml:
        "<p>Used by the Shine Options app to charge add-on prices at checkout. Don't delete or rename it. It isn't published to your online store.</p>",
    },
  });
  assertNoUserErrors(data.productCreate, "Creating the add-on product");
  const product = data.productCreate.product;
  const variantId = product.variants.nodes[0].id;
  const upd = await gql(admin, UPDATE_ADDON_VARIANT, {
    productId: product.id,
    variants: [
      {
        id: variantId,
        price: "0.00",
        taxable: true,
        inventoryPolicy: "CONTINUE",
        inventoryItem: { requiresShipping: false, tracked: false, sku: "SHINE-OPTIONS-ADDON" },
      },
    ],
  });
  assertNoUserErrors(upd.productVariantsBulkUpdate, "Setting up the add-on product");
  return { productId: product.id, variantId };
}

/**
 * Switch what happens when add-on pricing can't run: block checkout (default,
 * never undercharge) or allow the base price. blockOnFailure is fixed at
 * creation, so the Cart Transform is recreated.
 */
export async function setFailureMode(admin, shop, mode) {
  let settings = await getSettings(shop);
  if (settings.cartTransformId) {
    const del = await gql(admin, DELETE_CART_TRANSFORM, { id: settings.cartTransformId });
    assertNoUserErrors(del.cartTransformDelete, "Updating checkout behavior");
  }
  settings = await db.shopSettings.update({
    where: { shop },
    data: { failureMode: mode === "allow" ? "allow" : "block", cartTransformId: null },
  });
  const data = await gql(admin, CREATE_CART_TRANSFORM, {
    functionHandle: PRICING_FUNCTION_HANDLE,
    blockOnFailure: settings.failureMode !== "allow",
    metafields: [{ namespace: "$app", key: "config", type: "json", value: JSON.stringify(functionConfig(settings)) }],
  });
  assertNoUserErrors(data.cartTransformCreate, "Updating checkout behavior");
  return db.shopSettings.update({
    where: { shop },
    data: { cartTransformId: data.cartTransformCreate.cartTransform.id },
  });
}
