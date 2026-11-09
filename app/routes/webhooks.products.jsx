import { authenticate } from "../shopify.server";
import { syncProduct } from "../services/sync.server";

// products/create + products/update: new products pick up their option set automatically (PRD F3).
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();
  try {
    await syncProduct(admin, shop, payload.admin_graphql_api_id);
  } catch (e) {
    console.error("product sync failed", shop, e);
  }
  return new Response();
};
