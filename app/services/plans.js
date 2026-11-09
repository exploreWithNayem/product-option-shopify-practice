// Plans from the PRD "Pricing and plans" table. Prices are configured in the
// Partner Dashboard (Shopify App Pricing); this file only describes limits so
// the app can enforce them. Safe to import on the client.

export const PLANS = {
  free: {
    key: "free",
    name: "Free",
    price: 0,
    addonOrderLimit: 50,
    maxUploadMb: 5,
    maxFiles: 1,
    analytics: false,
    csv: false,
    features: [
      "All 14 field types",
      "Unlimited option sets and products",
      "Conditional logic",
      "Add-on pricing on 50 orders a month",
      "Uploads up to 5 MB",
    ],
  },
  starter: {
    key: "starter",
    name: "Starter",
    price: 9.99,
    addonOrderLimit: null,
    maxUploadMb: 20,
    maxFiles: 5,
    analytics: false,
    csv: false,
    features: ["Unlimited orders with add-ons", "Uploads up to 20 MB, 5 files per item", "All templates", "All languages"],
  },
  growth: {
    key: "growth",
    name: "Growth",
    price: 19.99,
    addonOrderLimit: null,
    maxUploadMb: 100,
    maxFiles: 20,
    analytics: true,
    csv: true,
    features: [
      "Everything in Starter",
      "Add-on analytics",
      "CSV import and export",
      "Bulk assignment",
      "Uploads up to 100 MB, 20 files",
      "Priority support",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    price: 39.99,
    addonOrderLimit: null,
    maxUploadMb: 100,
    maxFiles: 20,
    analytics: true,
    csv: true,
    features: ["Everything in Growth", "POS and headless API when released", "Guided onboarding call"],
  },
};

export const PLAN_ORDER = ["free", "starter", "growth", "pro"];

/** Map an App Pricing subscription name ("Growth", "Growth plan") to a plan key. */
export function planKeyFromName(name) {
  const n = String(name || "").toLowerCase();
  return PLAN_ORDER.slice(1).find((k) => n.includes(k)) || "free";
}

export function planFor(key) {
  return PLANS[key] || PLANS.free;
}
