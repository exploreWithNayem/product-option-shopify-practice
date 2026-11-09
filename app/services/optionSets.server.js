import db from "../db.server";
import { lintOptionSet } from "../../shared/options-core.js";
import { audit } from "./settings.server";

export const EMPTY_RULES = { all: false, products: [], collections: [], tags: [], types: [], vendors: [] };

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/** DB row -> plain object with parsed JSON. */
export function parseSet(row) {
  if (!row) return null;
  const { versions, ...rest } = row;
  const latest = versions?.find((v) => v.version === row.version);
  const fields = safeJson(row.fields, []);
  return {
    ...rest,
    fields,
    rules: { ...EMPTY_RULES, ...safeJson(row.rules, {}) },
    hasUnpublishedChanges: row.version === 0 ? true : latest ? latest.fields !== row.fields : false,
  };
}

export async function listSets(shop, { includeArchived = true } = {}) {
  const rows = await db.optionSet.findMany({
    where: { shop, ...(includeArchived ? {} : { status: { not: "archived" } }) },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
    include: { versions: { select: { version: true, fields: true } } },
  });
  return rows.map(parseSet);
}

export async function getSet(shop, id) {
  const row = await db.optionSet.findFirst({
    where: { shop, id },
    include: { versions: { select: { version: true, fields: true } } },
  });
  return parseSet(row);
}

/** A random 6-digit display ID that's unused in this shop. */
export async function nextNumber(shop) {
  for (;;) {
    const n = 100000 + Math.floor(Math.random() * 900000);
    if (!(await db.optionSet.findFirst({ where: { shop, number: n }, select: { id: true } }))) return n;
  }
}

/** Short summary of assignment rules for lists ("All products", "3 products, tag: gift"). */
export function rulesSummary(rules) {
  if (!rules) return "Not assigned";
  if (rules.all) return "All products";
  const parts = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (rules.products?.length) parts.push(rules.products.length === 1 ? rules.products[0].title : n(rules.products.length, "product", "products"));
  if (rules.collections?.length)
    parts.push(rules.collections.length === 1 ? `Collection: ${rules.collections[0].title}` : n(rules.collections.length, "collection", "collections"));
  if (rules.tags?.length) parts.push(rules.tags.length === 1 ? `Tag: ${rules.tags[0]}` : n(rules.tags.length, "tag", "tags"));
  if (rules.types?.length) parts.push(rules.types.length === 1 ? `Type: ${rules.types[0]}` : n(rules.types.length, "type", "types"));
  if (rules.vendors?.length) parts.push(rules.vendors.length === 1 ? `Vendor: ${rules.vendors[0]}` : n(rules.vendors.length, "vendor", "vendors"));
  return parts.length ? parts.join(", ") : "Not assigned";
}

export async function createSet(shop, { name, fields = [], rules = EMPTY_RULES, priority = 0 }, actor = "") {
  const row = await db.optionSet.create({
    data: {
      shop,
      number: await nextNumber(shop),
      name: name || "Untitled option set",
      fields: JSON.stringify(fields),
      rules: JSON.stringify({ ...EMPTY_RULES, ...rules }),
      priority,
    },
  });
  await audit(shop, "create", { actor, optionSetId: row.id, details: row.name });
  return row;
}

/** Save the working copy. Live products keep the last published version. */
export async function saveSet(shop, id, { name, fields, rules, priority }, actor = "") {
  const data = {};
  if (name !== undefined) data.name = String(name).slice(0, 120) || "Untitled option set";
  if (fields !== undefined) data.fields = JSON.stringify(fields);
  if (rules !== undefined) data.rules = JSON.stringify({ ...EMPTY_RULES, ...rules });
  if (priority !== undefined) data.priority = Math.max(-1000, Math.min(1000, Math.round(Number(priority) || 0)));
  const res = await db.optionSet.updateMany({ where: { shop, id }, data });
  if (!res.count) throw new Response("Not found", { status: 404 });
  await audit(shop, "save", { actor, optionSetId: id, details: Object.keys(data).join(",") });
}

/**
 * Publish: lint, snapshot as a new version, mark active. Older versions are kept
 * for orders already placed. Caller schedules the metafield sync.
 * @returns {{ ok: true, version: number } | { ok: false, problems: string[] }}
 */
export async function publishSet(shop, id, defaultLocale, actor = "") {
  const set = await getSet(shop, id);
  if (!set) throw new Response("Not found", { status: 404 });
  const problems = lintOptionSet({ id: set.id, v: set.version + 1, defaultLocale, fields: set.fields });
  if (problems.length) return { ok: false, problems };
  const version = set.version + 1;
  const fieldsJson = JSON.stringify(set.fields);
  await db.$transaction([
    db.optionSetVersion.create({ data: { optionSetId: id, version, fields: fieldsJson } }),
    db.optionSet.update({
      where: { id },
      data: { version, status: "active", publishedAt: new Date() },
    }),
  ]);
  await audit(shop, "publish", { actor, optionSetId: id, details: `v${version}` });
  return { ok: true, version };
}

export async function setStatus(shop, id, status, actor = "") {
  const set = await getSet(shop, id);
  if (!set) throw new Response("Not found", { status: 404 });
  const next = status === "archived" ? "archived" : status === "draft" ? "draft" : set.version > 0 ? "active" : "draft";
  await db.optionSet.update({ where: { id }, data: { status: next } });
  await audit(shop, next === "archived" ? "archive" : next === "draft" ? "unpublish" : "restore", { actor, optionSetId: id });
  return next;
}

export async function duplicateSet(shop, id, actor = "") {
  const set = await getSet(shop, id);
  if (!set) throw new Response("Not found", { status: 404 });
  return createSet(
    shop,
    { name: `${set.name} (copy)`, fields: set.fields, rules: EMPTY_RULES, priority: set.priority },
    actor,
  );
}

export async function deleteSet(shop, id, actor = "") {
  await db.optionSet.deleteMany({ where: { shop, id } });
  await audit(shop, "delete", { actor, optionSetId: id });
}

/** Active sets with the fields of their published version, highest priority first. */
export async function activeSetsForSync(shop) {
  const rows = await db.optionSet.findMany({
    where: { shop, status: "active", version: { gt: 0 } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: { versions: true },
  });
  return rows
    .map((row) => {
      const ver = row.versions.find((v) => v.version === row.version);
      if (!ver) return null;
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        priority: row.priority,
        rules: { ...EMPTY_RULES, ...safeJson(row.rules, {}) },
        fields: safeJson(ver.fields, []),
      };
    })
    .filter(Boolean);
}

/** The JSON written to a product's `$app:options` metafield. */
export function resolvedSetJson(set, defaultLocale) {
  // Fields switched off in the editor (eye icon) never reach the storefront or checkout.
  return { id: set.id, v: set.version, name: set.name, defaultLocale, fields: set.fields.filter((f) => !f.hidden) };
}

/** Version snapshot for analytics (orders placed against an older version). */
export async function getSetVersion(shop, optionSetId, version) {
  const row = await db.optionSetVersion.findFirst({
    where: { optionSetId, version, optionSet: { shop } },
    include: { optionSet: { select: { name: true } } },
  });
  if (!row) return null;
  return { id: optionSetId, v: version, name: row.optionSet.name, fields: safeJson(row.fields, []) };
}

const PRODUCT_LIST_VARIANTS = `#graphql
  query ShineProductListVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
        title
        product {
          id
          title
          featuredMedia {
            preview {
              image {
                url(transform: { maxWidth: 160, maxHeight: 160 })
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Product-list values carry the product's price so checkout can charge it.
 * Refresh price, title and image from Shopify on every save; drop products
 * that no longer exist.
 * @returns {Promise<{ fields: any[], removed: number }>}
 */
export async function refreshProductLists(admin, fields) {
  const ids = [...new Set(fields.filter((f) => f.type === "product_list").flatMap((f) => (f.values || []).map((v) => v.variantId).filter(Boolean)))];
  if (!ids.length) return { fields, removed: 0 };
  const found = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await admin.graphql(PRODUCT_LIST_VARIANTS, { variables: { ids: ids.slice(i, i + 100) } });
    const json = await res.json();
    for (const n of json.data?.nodes || []) if (n?.id) found.set(n.id, n);
  }
  let removed = 0;
  const next = fields.map((f) => {
    if (f.type !== "product_list") return f;
    const values = (f.values || [])
      .filter((v) => {
        const ok = !v.variantId || found.has(v.variantId);
        if (!ok) removed++;
        return ok;
      })
      .map((v) => {
        const n = found.get(v.variantId);
        if (!n) return v;
        const variantTitle = n.title && n.title !== "Default Title" ? ` – ${n.title}` : "";
        return {
          ...v,
          price: Number(n.price) || 0,
          productId: n.product?.id || v.productId,
          productTitle: `${n.product?.title || "Product"}${variantTitle}`,
          image: n.product?.featuredMedia?.preview?.image?.url || v.image,
        };
      });
    return { ...f, values };
  });
  return { fields: next, removed };
}
