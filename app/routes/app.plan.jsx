import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../services/settings.server";
import { PLANS, PLAN_ORDER, planFor } from "../services/plans";

// Plans are configured in the Partner Dashboard (Shopify App Pricing). Shopify
// hosts the plan selection page, trials, upgrades, downgrades and cancellation;
// this page shows usage and sends the merchant there.

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    current: settings.plan,
    usage: settings.addonOrdersThisMonth,
    limit: planFor(settings.plan).addonOrderLimit,
    paused: settings.pricingPaused,
    plans: PLAN_ORDER.map((k) => PLANS[k]),
  };
};

export const action = async ({ request }) => {
  const { redirect, session } = await authenticate.admin(request);
  const store = session.shop.replace(".myshopify.com", "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "shine-options";
  return redirect(`https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`, { target: "_top" });
};

export default function Plan() {
  const d = useLoaderData();
  const pct = d.limit ? Math.min(100, Math.round((d.usage / d.limit) * 100)) : 0;
  return (
    <s-page heading="Plan and billing">
      <s-section heading="This month">
        <s-stack gap="base">
          <s-paragraph>
            You&apos;re on the <s-text type="strong">{planFor(d.current).name}</s-text> plan.
          </s-paragraph>
          {d.limit !== null ? (
            <>
              <s-paragraph>
                You&apos;ve used {d.usage} of {d.limit} add-on orders this month.
                {d.paused ? " Add-on pricing is paused until next month; options still show without prices." : ""}
              </s-paragraph>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={d.limit}
                aria-valuenow={d.usage}
                aria-label="Add-on orders used this month"
                style={{ height: 8, borderRadius: 4, background: "#e3e3e3", overflow: "hidden" }}
              >
                <div style={{ width: `${pct}%`, height: "100%", background: d.paused ? "#c70a24" : "#303030" }} />
              </div>
            </>
          ) : (
            <s-paragraph>{d.usage} orders with add-ons this month. No limit on your plan.</s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          {d.plans.map((p) => (
            <s-box key={p.key} padding="base" border="base" borderRadius="base" background={p.key === d.current ? "subdued" : "base"}>
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{p.name}</s-heading>
                  {p.key === d.current && <s-badge tone="success">Current</s-badge>}
                </s-stack>
                <s-text type="strong">{p.price === 0 ? "Free" : `$${p.price}/month`}</s-text>
                <s-unordered-list>
                  {p.features.map((f) => (
                    <s-list-item key={f}>{f}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Paid plans include a 14-day free trial, and development stores are free. Stores that install in the first 90 days keep their price for life. All charges go through Shopify.
          </s-paragraph>
          <Form method="post">
            <s-button type="submit" variant="primary">
              Change plan
            </s-button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
