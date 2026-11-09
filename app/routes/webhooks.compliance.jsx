import { authenticate } from "../shopify.server";
import db from "../db.server";
import { remove } from "../services/storage.server";

// Mandatory privacy webhooks. We store no customer names or emails; the only
// personal data is shopper uploads linked to orders.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    const orders = (payload.orders_requested || []).map(String);
    const files = orders.length ? await db.upload.count({ where: { shop, orderId: { in: orders } } }) : 0;
    // The merchant can download these files from the order links; nothing else is held.
    console.log(`data request for ${shop}: ${files} uploaded file(s) on ${orders.length} order(s)`);
  }

  if (topic === "CUSTOMERS_REDACT") {
    const orders = (payload.orders_to_redact || []).map(String);
    if (orders.length) {
      const uploads = await db.upload.findMany({ where: { shop, orderId: { in: orders } } });
      for (const u of uploads) await remove(u.storageKey);
      await db.upload.deleteMany({ where: { shop, orderId: { in: orders } } });
    }
  }

  if (topic === "SHOP_REDACT") {
    const uploads = await db.upload.findMany({ where: { shop } });
    for (const u of uploads) await remove(u.storageKey);
    const sets = await db.optionSet.findMany({ where: { shop }, select: { id: true } });
    await db.$transaction([
      db.upload.deleteMany({ where: { shop } }),
      db.optionSetVersion.deleteMany({ where: { optionSetId: { in: sets.map((s) => s.id) } } }),
      db.optionSet.deleteMany({ where: { shop } }),
      db.dailyStat.deleteMany({ where: { shop } }),
      db.processedOrder.deleteMany({ where: { shop } }),
      db.auditLog.deleteMany({ where: { shop } }),
      db.syncJob.deleteMany({ where: { shop } }),
      db.productAssignment.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
