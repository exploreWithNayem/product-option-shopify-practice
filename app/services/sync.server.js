// Keeps every product's `$app:options` / `$app:pricing` metafields equal to the
// option set its assignment rules resolve to. Our DB (ProductAssignment) records
// what was last written, so a sync only touches products that changed.

import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { toFunctionSet } from "../../shared/options-core.js";
import { gql, assertNoUserErrors, chunk, sleep } from "./admin-api.server";
import { activeSetsForSync, resolvedSetJson } from "./optionSets.server";
import { getSettings } from "./settings.server";
import { ADDON_PRODUCT_TAG } from "./setup.server";

const PRODUCTS_PAGE = `#graphql
  query ShineSyncProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      nodes {
        id
        tags
        productType
        vendor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_PRODUCTS = `#graphql
  query ShineCollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const ONE_PRODUCT = `#graphql
  query ShineSyncOneProduct($id: ID!) {
    product(id: $id) {
      id
      tags
      productType
      vendor
      collections(first: 250) {
        nodes {
          id
        }
      }
    }
  }
`;

const SET_METAFIELDS = `#graphql
  mutation ShineSyncSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_METAFIELDS = `#graphql
  mutation ShineSyncDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PREVIEW_SEARCH = `#graphql
  query ShinePreviewSearch($query: String, $first: Int!) {
    productsCount(query: $query) {
      count
    }
    products(first: $first, query: $query, sortKey: TITLE) {
      nodes {
        id
        title
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 80, maxHeight: 80 })
            }
          }
        }
      }
    }
  }
`;

const PREVIEW_COLLECTION = `#graphql
  query ShinePreviewCollection($id: ID!) {
    collection(id: $id) {
      id
      title
      productsCount {
        count
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Rule matching

const lower = (s) => String(s || "").trim().toLowerCase();

/**
 * Does a product match a set's assignment rules? Any rule matching is enough.
 * @param {any} rules
 * @param {{ id: string, tags: string[], productType?: string, vendor?: string }} product
 * @param {(collectionId: string, productId: string) => boolean} inCollection
 */
export function ruleMatches(rules, product, inCollection) {
  if (!rules) return false;
  if (rules.all) return true;
  if ((rules.products || []).some((p) => p.id === product.id)) return true;
  if ((rules.collections || []).some((c) => inCollection(c.id, product.id))) return true;
  const tags = new Set((product.tags || []).map(lower));
  if ((rules.tags || []).some((t) => tags.has(lower(t)))) return true;
  if ((rules.types || []).some((t) => lower(t) === lower(product.productType))) return true;
  if ((rules.vendors || []).some((v) => lower(v) === lower(product.vendor))) return true;
  return false;
}

/** First set (by priority) whose rules match. */
export function resolveSet(sets, product, inCollection) {
  if ((product.tags || []).map(lower).includes(ADDON_PRODUCT_TAG)) return null;
  for (const s of sets) if (ruleMatches(s.rules, product, inCollection)) return s;
  return null;
}

/** Explain which rule applied (shown in the admin). */
export function explainMatch(rules, product, inCollection) {
  if (rules.all) return "All products";
  if ((rules.products || []).some((p) => p.id === product.id)) return "Picked product";
  const c = (rules.collections || []).find((c) => inCollection(c.id, product.id));
  if (c) return `Collection: ${c.title || c.id}`;
  const tags = new Set((product.tags || []).map(lower));
  const t = (rules.tags || []).find((t) => tags.has(lower(t)));
  if (t) return `Tag: ${t}`;
  if ((rules.types || []).some((x) => lower(x) === lower(product.productType))) return `Type: ${product.productType}`;
  if ((rules.vendors || []).some((x) => lower(x) === lower(product.vendor))) return `Vendor: ${product.vendor}`;
  return "";
}

// ---------------------------------------------------------------------------
// Writes

async function gqlRetry(admin, query, variables) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gql(admin, query, variables);
    } catch (e) {
      const msg = String(e?.message || e);
      if (attempt < 5 && /throttl/i.test(msg)) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

function metafieldsFor(productId, set, defaultLocale) {
  const full = resolvedSetJson(set, defaultLocale);
  return [
    { ownerId: productId, namespace: "$app", key: "options", type: "json", value: JSON.stringify(full) },
    {
      ownerId: productId,
      namespace: "$app",
      key: "pricing",
      type: "json",
      value: JSON.stringify(toFunctionSet(full, defaultLocale)),
    },
  ];
}

async function writeAssignments(admin, shop, writes, defaultLocale) {
  // metafieldsSet takes up to 25 metafields: 12 products x 2 metafields.
  for (const batch of chunk(writes, 12)) {
    const metafields = batch.flatMap((w) => metafieldsFor(w.productId, w.set, defaultLocale));
    const data = await gqlRetry(admin, SET_METAFIELDS, { metafields });
    assertNoUserErrors(data.metafieldsSet, "Saving product options");
    await db.$transaction(
      batch.map((w) =>
        db.productAssignment.upsert({
          where: { id: `${shop}|${w.productId}` },
          create: { id: `${shop}|${w.productId}`, shop, productId: w.productId, optionSetId: w.set.id, version: w.set.version },
          update: { optionSetId: w.set.id, version: w.set.version },
        }),
      ),
    );
  }
}

async function removeAssignments(admin, shop, productIds) {
  for (const batch of chunk(productIds, 12)) {
    const metafields = batch.flatMap((ownerId) => [
      { ownerId, namespace: "$app", key: "options" },
      { ownerId, namespace: "$app", key: "pricing" },
    ]);
    const data = await gqlRetry(admin, DELETE_METAFIELDS, { metafields });
    assertNoUserErrors(data.metafieldsDelete, "Removing product options");
    await db.productAssignment.deleteMany({ where: { id: { in: batch.map((p) => `${shop}|${p}`) } } });
  }
}

// ---------------------------------------------------------------------------
// Full sync (background job with progress)

const running = new Map(); // shop -> { rerun: boolean }

/** Queue a full sync. Coalesces bursts: at most one running + one queued per shop. */
export async function scheduleFullSync(shop, reason = "") {
  const state = running.get(shop);
  if (state) {
    state.rerun = true;
    return null;
  }
  const job = await db.syncJob.create({ data: { shop, reason, status: "queued" } });
  running.set(shop, { rerun: false });
  // Fire and forget; progress is persisted on the SyncJob row.
  (async () => {
    let jobId = job.id;
    for (;;) {
      try {
        await runFullSync(shop, jobId);
      } catch (e) {
        console.error("sync failed", shop, e);
        await db.syncJob.update({
          where: { id: jobId },
          data: { status: "failed", error: String(e?.message || e).slice(0, 500), finishedAt: new Date() },
        });
      }
      const st = running.get(shop);
      if (st?.rerun) {
        st.rerun = false;
        jobId = (await db.syncJob.create({ data: { shop, reason: "changes during sync", status: "queued" } })).id;
        continue;
      }
      running.delete(shop);
      break;
    }
  })();
  return job;
}

export async function runFullSync(shop, jobId) {
  const { admin } = await unauthenticated.admin(shop);
  const settings = await getSettings(shop);
  const defaultLocale = settings.primaryLocale || "en";
  await db.syncJob.update({ where: { id: jobId }, data: { status: "running" } });

  const sets = await activeSetsForSync(shop);

  // Collection memberships for collection rules.
  const collectionIds = new Set(sets.flatMap((s) => (s.rules.collections || []).map((c) => c.id)));
  const members = new Map();
  for (const cid of collectionIds) {
    const ids = new Set();
    let cursor = null;
    for (;;) {
      const data = await gqlRetry(admin, COLLECTION_PRODUCTS, { id: cid, cursor });
      const conn = data.collection?.products;
      if (!conn) break;
      conn.nodes.forEach((n) => ids.add(n.id));
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    members.set(cid, ids);
  }
  const inCollection = (cid, pid) => !!members.get(cid)?.has(pid);

  const existing = new Map(
    (await db.productAssignment.findMany({ where: { shop } })).map((a) => [a.productId, a]),
  );
  const seen = new Set();
  const counts = new Map(sets.map((s) => [s.id, 0]));
  let scanned = 0;
  let updated = 0;
  let removed = 0;
  let cursor = null;

  for (;;) {
    const data = await gqlRetry(admin, PRODUCTS_PAGE, { cursor });
    const writes = [];
    const removals = [];
    for (const p of data.products.nodes) {
      scanned++;
      seen.add(p.id);
      const set = resolveSet(sets, p, inCollection);
      const prev = existing.get(p.id);
      if (set) {
        counts.set(set.id, (counts.get(set.id) || 0) + 1);
        if (!prev || prev.optionSetId !== set.id || prev.version !== set.version) writes.push({ productId: p.id, set });
      } else if (prev) {
        removals.push(p.id);
      }
    }
    if (writes.length) await writeAssignments(admin, shop, writes, defaultLocale);
    if (removals.length) await removeAssignments(admin, shop, removals);
    updated += writes.length;
    removed += removals.length;
    await db.syncJob.update({ where: { id: jobId }, data: { scanned, updated, removed } });
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  // Products deleted from the store: forget them (their metafields went with them).
  const gone = [...existing.keys()].filter((id) => !seen.has(id));
  if (gone.length) await db.productAssignment.deleteMany({ where: { id: { in: gone.map((p) => `${shop}|${p}`) } } });

  await db.$transaction([
    db.optionSet.updateMany({ where: { shop }, data: { productCount: 0 } }),
    ...[...counts.entries()].map(([id, n]) => db.optionSet.update({ where: { id }, data: { productCount: n } })),
  ]);
  await db.syncJob.update({
    where: { id: jobId },
    data: { status: "done", scanned, updated, removed, finishedAt: new Date() },
  });
}

/** Re-resolve a single product (products/create and products/update webhooks). */
export async function syncProduct(admin, shop, productId) {
  const sets = await activeSetsForSync(shop);
  const prev = await db.productAssignment.findUnique({ where: { id: `${shop}|${productId}` } });
  if (!sets.length && !prev) return "none";
  const data = await gqlRetry(admin, ONE_PRODUCT, { id: productId });
  if (!data.product) return "missing";
  const cols = new Set(data.product.collections.nodes.map((n) => n.id));
  const set = resolveSet(sets, data.product, (cid) => cols.has(cid));
  const settings = await getSettings(shop);
  if (set) {
    if (prev && prev.optionSetId === set.id && prev.version === set.version) return "unchanged";
    await writeAssignments(admin, shop, [{ productId, set }], settings.primaryLocale || "en");
    return "updated";
  }
  if (prev) {
    await removeAssignments(admin, shop, [productId]);
    return "removed";
  }
  return "none";
}

/** Latest sync job for progress display. */
export async function latestSyncJob(shop) {
  return db.syncJob.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } });
}

/** True while a background sync for this shop is running in this process. */
export function isSyncRunning(shop) {
  return running.has(shop);
}

// ---------------------------------------------------------------------------
// Matched-product preview for the assignment screen

const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function previewMatches(admin, rules) {
  const terms = [
    ...(rules.tags || []).map((t) => `tag:${q(t)}`),
    ...(rules.types || []).map((t) => `product_type:${q(t)}`),
    ...(rules.vendors || []).map((v) => `vendor:${q(v)}`),
  ];
  let count = 0;
  let samples = [];
  const parts = [];
  if (rules.all) {
    const data = await gql(admin, PREVIEW_SEARCH, { query: `-tag:${q(ADDON_PRODUCT_TAG)}`, first: 8 });
    return {
      count: data.productsCount.count,
      approximate: false,
      samples: data.products.nodes.map(sample),
      parts: [{ label: "All products", count: data.productsCount.count }],
    };
  }
  if (terms.length) {
    const data = await gql(admin, PREVIEW_SEARCH, { query: terms.join(" OR "), first: 8 });
    count += data.productsCount.count;
    samples = data.products.nodes.map(sample);
    parts.push({ label: "Tags, types and vendors", count: data.productsCount.count });
  }
  for (const c of rules.collections || []) {
    const data = await gql(admin, PREVIEW_COLLECTION, { id: c.id });
    const n = data.collection?.productsCount?.count || 0;
    count += n;
    parts.push({ label: `Collection: ${data.collection?.title || c.title}`, count: n });
  }
  if ((rules.products || []).length) {
    count += rules.products.length;
    parts.push({ label: "Picked products", count: rules.products.length });
    samples = [...rules.products.slice(0, 8).map((p) => ({ id: p.id, title: p.title, image: p.image || null })), ...samples].slice(0, 8);
  }
  return { count, approximate: parts.length > 1, samples, parts };
}

function sample(n) {
  return { id: n.id, title: n.title, image: n.featuredMedia?.preview?.image?.url || null };
}
