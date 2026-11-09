import { authenticate } from "../shopify.server";
import { processOrder } from "../services/analytics.server";
import { getSettings, pushConfigs } from "../services/settings.server";

export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  try {
    const { pauseChanged } = await processOrder(shop, payload);
    // Free plan limit reached (or lifted): update storefront + Function config.
    if (pauseChanged && admin) await pushConfigs(admin, await getSettings(shop));
  } catch (e) {
    console.error("order analytics failed", shop, e);
  }
  return new Response();
};
