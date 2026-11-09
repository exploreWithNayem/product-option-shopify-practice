import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify removes the app block and embed itself. We drop sessions now and keep
// shop data until shop/redact (48 hours later) in case the merchant reinstalls.
export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  await db.shopSettings.updateMany({
    where: { shop },
    data: { cartTransformId: null, validationId: null },
  });
  return new Response();
};
