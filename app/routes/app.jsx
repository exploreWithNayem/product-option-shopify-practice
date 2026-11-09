import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getSettings } from "../services/settings.server";
import { ensureSetup } from "../services/setup.server";
import { purgeOldUploads } from "../services/storage.server";
import db from "../db.server";

// Setup is idempotent but costs an Admin API call, so re-check at most every
// 10 minutes per shop unless something is missing.
const lastCheck = new Map();
const lastProblems = new Map();

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getSettings(shop);
  const missing = !settings.addonVariantId || !settings.cartTransformId || !settings.validationId;
  const stale = Date.now() - (lastCheck.get(shop) || 0) > 10 * 60 * 1000;
  if (missing || stale) {
    try {
      const { problems } = await ensureSetup(admin, shop, { force: !lastCheck.has(shop) });
      lastProblems.set(shop, problems);
    } catch (e) {
      lastProblems.set(shop, [String(e?.message || e)]);
    }
    lastCheck.set(shop, Date.now());
  }
  purgeOldUploads(db).catch((e) => console.error("upload purge failed", e));

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", setupProblems: lastProblems.get(shop) || [] };
};

export default function App() {
  const { apiKey, setupProblems } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/sets">Option sets</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/plan">Plan</s-link>
      </s-app-nav>
      {setupProblems.length > 0 && (
        <div style={{ padding: "16px 16px 0" }}>
          <s-banner tone="critical" heading="Add-on pricing isn't fully set up">
            {setupProblems.map((p) => (
              <s-paragraph key={p}>{p}</s-paragraph>
            ))}
          </s-banner>
        </div>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
