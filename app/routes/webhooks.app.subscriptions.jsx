import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planKeyFromName, planFor } from "../services/plans";
import { getSettings, pushConfigs, audit } from "../services/settings.server";

// Shopify App Pricing creates/updates the subscription; we only mirror the plan.
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  const sub = payload.app_subscription || {};
  const active = String(sub.status || "").toUpperCase() === "ACTIVE";
  const plan = active ? planKeyFromName(sub.name) : "free";
  const settings = await getSettings(shop);
  if (settings.plan !== plan) {
    const limit = planFor(plan).addonOrderLimit;
    const pricingPaused = limit !== null && settings.addonOrdersThisMonth >= limit;
    const updated = await db.shopSettings.update({ where: { shop }, data: { plan, pricingPaused } });
    await audit(shop, "plan", { details: `${settings.plan} -> ${plan}` });
    if (admin) await pushConfigs(admin, updated);
  }
  return new Response();
};
