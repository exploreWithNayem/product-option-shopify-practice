import { authenticate } from "../shopify.server";
import { activeSetsForSync } from "../services/optionSets.server";
import { scheduleFullSync } from "../services/sync.server";

// Collection membership changed: re-sync if any live set is assigned by this collection.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  const id = payload.admin_graphql_api_id;
  const sets = await activeSetsForSync(shop);
  if (sets.some((s) => (s.rules.collections || []).some((c) => c.id === id))) {
    await scheduleFullSync(shop, "collection updated");
  }
  return new Response();
};
