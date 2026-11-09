// Add-on revenue analytics (PRD F14) built from order webhooks.

import db from "../db.server";
import {
  PROPERTY_KEY,
  decodeSelection,
  effectiveAnswers,
  isChoiceType,
  quoteAddons,
  t,
  toMinor,
  variantKey,
} from "../../shared/options-core.js";
import { getSetVersion } from "./optionSets.server";
import { getSettings, recordAddonOrder } from "./settings.server";
import { uploadIdFromLink } from "./storage.server";

const prop = (li, name) => (li.properties || []).find((p) => p && p.name === name)?.value;

/**
 * Record one order. Idempotent per order id (webhooks can repeat).
 * @returns {Promise<{ pauseChanged: boolean }>}
 */
export async function processOrder(shop, order) {
  const key = `${shop}|${order.id}`;
  if (await db.processedOrder.findUnique({ where: { id: key } })) return { pauseChanged: false };

  const settings = await getSettings(shop);
  const currency = settings.currency; // analytics are reported in the shop currency (shop_money)
  const addonVariant = variantKey(settings.addonVariantId);
  const lineItems = order.line_items || [];
  const addonLines = lineItems.filter((li) => addonVariant && String(li.variant_id) === addonVariant);
  const chargedMinor = addonLines.reduce(
    (sum, li) => sum + toMinor(Number(li.price_set?.shop_money?.amount ?? li.price) * li.quantity, currency),
    0,
  );
  const charged = chargedMinor > 0;
  const date = String(order.created_at || new Date().toISOString()).slice(0, 10);

  const statLines = [];
  const uploadIds = [];
  const versionCache = new Map();

  for (const li of lineItems) {
    if (addonVariant && String(li.variant_id) === addonVariant) continue;
    const sel = decodeSelection(prop(li, PROPERTY_KEY));
    if (!sel) continue;
    const cacheKey = `${sel.s}:${sel.v}`;
    if (!versionCache.has(cacheKey)) versionCache.set(cacheKey, await getSetVersion(shop, sel.s, sel.v));
    const set = versionCache.get(cacheKey);
    if (!set) continue;
    set.defaultLocale = settings.primaryLocale;

    const base = toMinor(Number(li.price_set?.shop_money?.amount ?? li.price), currency);
    const ctx = { variantId: li.variant_id, baseMinor: base, currency };
    const answers = effectiveAnswers(set, sel.a, ctx);
    const quote = charged ? quoteAddons(set, answers, ctx) : { lines: [] };

    for (const field of set.fields) {
      const a = answers[field.id];
      if (a === undefined) continue;
      if (field.type === "file") for (const url of a) uploadIds.push(uploadIdFromLink(url));
      const label = t(field.label, settings.primaryLocale);
      const valueIds = isChoiceType(field.type) ? (Array.isArray(a) ? a : [a]) : [""];
      for (const valueId of valueIds) {
        const value = valueId ? (field.values || []).find((v) => v.id === valueId) : null;
        const priced = quote.lines.find((p) => p.fieldId === field.id && (p.valueId || "") === valueId);
        const amountMinor = priced ? (priced.scope === "line" ? priced.amountMinor : priced.amountMinor * li.quantity) : 0;
        statLines.push({
          date,
          optionSetId: set.id,
          fieldId: field.id,
          valueId,
          label,
          valueLabel: value ? t(value.label, settings.primaryLocale) : field.type === "checkbox" || field.type === "toggle" ? "Yes" : "",
          quantity: li.quantity,
          amountMinor,
        });
      }
    }
  }

  await db.$transaction([
    ...statLines.map((s) =>
      db.dailyStat.upsert({
        where: {
          shop_date_optionSetId_fieldId_valueId: {
            shop,
            date: s.date,
            optionSetId: s.optionSetId,
            fieldId: s.fieldId,
            valueId: s.valueId,
          },
        },
        create: {
          shop,
          date: s.date,
          optionSetId: s.optionSetId,
          fieldId: s.fieldId,
          valueId: s.valueId,
          label: s.label,
          valueLabel: s.valueLabel,
          orders: 1,
          quantity: s.quantity,
          revenueMinor: s.amountMinor,
          currency,
        },
        update: {
          label: s.label,
          valueLabel: s.valueLabel,
          orders: { increment: 1 },
          quantity: { increment: s.quantity },
          revenueMinor: { increment: s.amountMinor },
        },
      }),
    ),
    db.processedOrder.create({
      data: {
        id: key,
        shop,
        orderId: String(order.id),
        addonMinor: chargedMinor,
        lines: JSON.stringify(statLines.filter((s) => s.amountMinor > 0)),
      },
    }),
  ]);

  const ids = uploadIds.filter(Boolean);
  if (ids.length) {
    await db.upload.updateMany({ where: { shop, id: { in: ids } }, data: { orderId: String(order.id) } });
  }

  const pauseChanged = charged ? await recordAddonOrder(shop) : false;
  return { pauseChanged };
}

/** Subtract refunded add-on amounts from analytics (partial refunds included). */
export async function processRefund(shop, refund) {
  const key = `${shop}|${refund.order_id}`;
  const order = await db.processedOrder.findUnique({ where: { id: key } });
  if (!order || order.addonMinor <= 0) return;
  const settings = await getSettings(shop);
  const addonVariant = variantKey(settings.addonVariantId);
  const refundedMinor = (refund.refund_line_items || [])
    .filter((r) => addonVariant && String(r.line_item?.variant_id) === addonVariant)
    .reduce((sum, r) => sum + toMinor(Number(r.subtotal_set?.shop_money?.amount ?? r.subtotal ?? 0), settings.currency), 0);
  if (refundedMinor <= 0) return;
  const lines = JSON.parse(order.lines || "[]");
  const total = lines.reduce((s, l) => s + l.amountMinor, 0) || 1;
  let left = Math.min(refundedMinor, order.addonMinor - order.refundedMinor);
  if (left <= 0) return;
  const ops = lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round((refundedMinor * l.amountMinor) / total);
    left -= share;
    return db.dailyStat.updateMany({
      where: { shop, date: l.date, optionSetId: l.optionSetId, fieldId: l.fieldId, valueId: l.valueId },
      data: { revenueMinor: { decrement: Math.max(0, share) } },
    });
  });
  await db.$transaction([
    ...ops,
    db.processedOrder.update({ where: { id: key }, data: { refundedMinor: { increment: refundedMinor } } }),
  ]);
}

/**
 * Aggregated analytics for a date range (inclusive, YYYY-MM-DD).
 */
export async function getAnalytics(shop, from, to) {
  const rows = await db.dailyStat.findMany({ where: { shop, date: { gte: from, lte: to } } });
  const sets = await db.optionSet.findMany({ where: { shop }, select: { id: true, name: true } });
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  const orderCount = await db.processedOrder.count({
    where: { shop, addonMinor: { gt: 0 }, createdAt: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } },
  });

  const bySet = new Map();
  const byField = new Map();
  const byValue = new Map();
  const byDay = new Map();
  let revenue = 0;
  for (const r of rows) {
    revenue += r.revenueMinor;
    const s = bySet.get(r.optionSetId) || { id: r.optionSetId, name: setName.get(r.optionSetId) || "Deleted set", revenueMinor: 0, choices: 0 };
    s.revenueMinor += r.revenueMinor;
    s.choices += r.orders;
    bySet.set(r.optionSetId, s);
    const fk = `${r.optionSetId}|${r.fieldId}`;
    const f = byField.get(fk) || { set: s.name, label: r.label, revenueMinor: 0, choices: 0 };
    f.revenueMinor += r.revenueMinor;
    f.choices += r.orders;
    byField.set(fk, f);
    if (r.valueId || r.valueLabel) {
      const vk = `${fk}|${r.valueId}`;
      const v = byValue.get(vk) || { set: s.name, field: r.label, value: r.valueLabel, revenueMinor: 0, choices: 0, quantity: 0 };
      v.revenueMinor += r.revenueMinor;
      v.choices += r.orders;
      v.quantity += r.quantity;
      byValue.set(vk, v);
    }
    byDay.set(r.date, (byDay.get(r.date) || 0) + r.revenueMinor);
  }
  const sortRev = (a, b) => b.revenueMinor - a.revenueMinor || b.choices - a.choices;
  return {
    revenueMinor: revenue,
    orders: orderCount,
    bySet: [...bySet.values()].sort(sortRev),
    byField: [...byField.values()].sort(sortRev),
    byValue: [...byValue.values()].sort(sortRev),
    topChosen: [...byValue.values()].sort((a, b) => b.choices - a.choices).slice(0, 10),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

export function isoDaysAgo(days, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Date range from ?days= or ?from=&to= (YYYY-MM-DD). */
export function rangeFrom(url) {
  const sp = new URL(url).searchParams;
  const to = sp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to")) ? sp.get("to") : isoDaysAgo(0);
  const from =
    sp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from"))
      ? sp.get("from")
      : isoDaysAgo(Number(sp.get("days") || 30) - 1);
  return { from, to };
}
