import { authenticate } from "../shopify.server";
import { processRefund } from "../services/analytics.server";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  try {
    await processRefund(shop, payload);
  } catch (e) {
    console.error("refund analytics failed", shop, e);
  }
  return new Response();
};
