import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, updateSettings } from "../services/settings.server";
import { getAnalytics, isoDaysAgo } from "../services/analytics.server";
import { themeLinks, themeStatus } from "../services/theme.server";
import { runCartTest } from "../services/cartTest.server";
import { planFor } from "../services/plans";
import { money } from "../components/wc";

export const loader = async ({ request }) => {
  // Use the authenticated redirect: it keeps shop/host/id_token on the URL, which
  // an embedded document request needs (React Router's plain redirect drops them).
  const { admin, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getSettings(shop);
  const sets = await db.optionSet.findMany({
    where: { shop },
    select: { id: true, status: true, productCount: true },
  });
  if (sets.length === 0 && !settings.onboardingDone) throw redirect("/app/onboarding");

  const [theme, stats] = await Promise.all([
    themeStatus(admin),
    getAnalytics(shop, isoDaysAgo(29), isoDaysAgo(0)),
  ]);
  const plan = planFor(settings.plan);
  const live = sets.filter((s) => s.status === "active");
  return {
    shop,
    currency: settings.currency,
    plan: { key: plan.key, name: plan.name, limit: plan.addonOrderLimit },
    usage: settings.addonOrdersThisMonth,
    pricingPaused: settings.pricingPaused,
    testPassed: !!settings.testPassedAt,
    theme,
    links: themeLinks(shop),
    counts: {
      sets: sets.length,
      live: live.length,
      products: live.reduce((n, s) => n + s.productCount, 0),
    },
    revenueMinor: stats.revenueMinor,
    orders: stats.orders,
    topChosen: stats.topChosen.slice(0, 5),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "test") return runCartTest(admin, session.shop);
  if (intent === "finish-onboarding") {
    await updateSettings(session.shop, { onboardingDone: true });
    return { ok: true };
  }
  return null;
};

function Step({ done, title, children, action }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        <s-icon type={done ? "check-circle" : "circle"} tone={done ? "success" : "neutral"}></s-icon>
        <s-stack gap="small-200">
          <s-text type="strong">{title}</s-text>
          {!done && children ? <s-text color="subdued">{children}</s-text> : null}
        </s-stack>
        {!done ? action : <s-badge tone="success">Done</s-badge>}
      </s-grid>
    </s-box>
  );
}

function Metric({ label, value, hint }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

export default function Home() {
  const d = useLoaderData();
  const test = useFetcher();
  const shopify = useAppBridge();
  const testing = test.state !== "idle";

  useEffect(() => {
    if (test.data?.message) shopify.toast.show(test.data.message, { isError: !test.data.ok });
  }, [test.data, shopify]);

  const steps = [
    { done: d.counts.sets > 0, title: "Create an option set", hint: "Start from a template in a few clicks.", href: "/app/onboarding", label: "Choose a template" },
    { done: d.counts.live > 0, title: "Publish it", hint: "Shoppers only see published option sets.", href: "/app/sets", label: "Open option sets" },
    { done: d.counts.products > 0, title: "Assign products", hint: "By product, collection, tag, type or vendor.", href: "/app/sets", label: "Assign" },
    { done: d.theme.embedOn, title: "Turn on in theme", hint: "Switches on the app embed in your theme editor.", href: d.links.embed, label: "Turn on", external: true },
    { done: d.theme.blockOn, title: "Add the options block to your product page", hint: "Places fields exactly where you want them.", href: d.links.block, label: "Add block", external: true },
  ];
  const allDone = steps.every((s) => s.done) && d.testPassed;

  return (
    <s-page heading="Product options">
      <s-button slot="primary-action" variant="primary" href="/app/sets">
        Option sets
      </s-button>

      {!d.theme.embedOn && !d.theme.error && (
        <s-banner tone="warning" heading="Enable app embed" dismissible>
          <s-paragraph>The app embed isn&apos;t enabled on your live theme. Please enable it to display options on your storefront.</s-paragraph>
          <s-button slot="secondary-actions" href={d.links.embed} target="_blank">
            Open theme editor
          </s-button>
        </s-banner>
      )}
      {d.theme.embedOn && !d.theme.blockOn && d.counts.live > 0 && (
        <s-banner tone="info" heading="Options block missing">
          <s-paragraph>
            The options block isn&apos;t on your product template yet.{" "}
            <s-link href={d.links.block} target="_blank">
              Add it
            </s-link>
          </s-paragraph>
        </s-banner>
      )}
      {d.plan.limit !== null && (d.pricingPaused || d.usage >= d.plan.limit * 0.8) && (
        <s-banner tone={d.pricingPaused ? "critical" : "warning"} heading="Free plan limit">
          <s-paragraph>
            You&apos;ve used {d.usage} of {d.plan.limit} add-on orders this month. Upgrade to keep charging for add-ons.{" "}
            <s-link href="/app/plan">See plans</s-link>
          </s-paragraph>
          {d.pricingPaused && (
            <s-paragraph>Options still show on your store, without prices, until next month.</s-paragraph>
          )}
        </s-banner>
      )}

      <s-section heading="Last 30 days">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Metric label="Add-on revenue" value={money(d.revenueMinor, d.currency)} />
          <Metric label="Orders with add-ons" value={String(d.orders)} />
          <Metric label="Live option sets" value={String(d.counts.live)} hint={`${d.counts.sets} in total`} />
          <Metric label="Products covered" value={String(d.counts.products)} />
        </s-grid>
        {d.topChosen.length > 0 && (
          <s-stack gap="small-200">
            <s-text type="strong">Most chosen</s-text>
            <s-stack direction="inline" gap="small-200">
              {d.topChosen.map((v) => (
                <s-badge key={`${v.set}-${v.field}-${v.value}`}>
                  {v.field}: {v.value || "filled in"} ({v.choices})
                </s-badge>
              ))}
            </s-stack>
          </s-stack>
        )}
      </s-section>

      {!allDone && (
        <s-section heading="Setup">
          <s-stack gap="base">
            {steps.map((s) => (
              <Step
                key={s.title}
                done={s.done}
                title={s.title}
                action={
                  <s-button href={s.href} target={s.external ? "_blank" : undefined}>
                    {s.label}
                  </s-button>
                }
              >
                {s.hint}
              </Step>
            ))}
            <Step
              done={d.testPassed}
              title="Run the built-in test"
              action={
                <test.Form method="post">
                  <input type="hidden" name="intent" value="test" />
                  <s-button type="submit" variant="primary" loading={testing || undefined} disabled={d.counts.products === 0 || undefined}>
                    Run test
                  </s-button>
                </test.Form>
              }
            >
              Adds a sample product with choices to a cart and confirms the total.
            </Step>
          </s-stack>
        </s-section>
      )}

      {test.data?.details && (
        <s-section heading={test.data.ok ? "Test passed" : "Test result"}>
          <s-banner tone={test.data.ok ? "success" : "warning"}>{test.data.message}</s-banner>
          <s-table>
            <s-table-header-row>
              <s-table-header>Check</s-table-header>
              <s-table-header>Value</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {Object.entries(test.data.details).map(([k, v]) => (
                <s-table-row key={k}>
                  <s-table-cell>{k}</s-table-cell>
                  <s-table-cell>{v}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section slot="aside" heading="Plan">
        <s-paragraph>
          {d.plan.name}
          {d.plan.limit !== null ? ` · ${d.usage}/${d.plan.limit} add-on orders this month` : " · unlimited add-on orders"}
        </s-paragraph>
        <s-link href="/app/plan">Change plan</s-link>
      </s-section>
      <s-section slot="aside" heading="Tips">
        <s-unordered-list>
          <s-list-item>Show a price beside every paid choice so shoppers know the total before paying.</s-list-item>
          <s-list-item>Use conditions to hide follow-up fields until they matter, like engraving text after &quot;Add engraving&quot;.</s-list-item>
          <s-list-item>Packing slip doesn&apos;t list choices? Add the line item properties snippet from Settings.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
