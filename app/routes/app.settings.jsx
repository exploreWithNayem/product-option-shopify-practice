import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { gql } from "../services/admin-api.server";
import {
  DEFAULT_STRINGS,
  STRING_LABELS,
  getSettings,
  parseSettingsJson,
  pushConfigs,
  updateSettings,
  audit,
} from "../services/settings.server";
import { ensureSetup, setFailureMode } from "../services/setup.server";
import { latestSyncJob, scheduleFullSync, isSyncRunning } from "../services/sync.server";
import { themeLinks, themeStatus } from "../services/theme.server";
import { planFor } from "../services/plans";
import { Select, TextField } from "../components/wc";

const LOCALES = `#graphql
  query ShineSettingsLocales {
    shopLocales(published: true) {
      locale
      name
      primary
    }
  }
`;

const PACKING_SLIP_SNIPPET = `{% for property in line_item.properties %}
  {% assign key_start = property.first | slice: 0 %}
  {% if property.last != blank and key_start != '_' %}
    <p class="line-item-property">{{ property.first }}: {{ property.last }}</p>
  {% endif %}
{% endfor %}`;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getSettings(shop);
  const [locales, theme, job] = await Promise.all([
    gql(admin, LOCALES).then((d) => d.shopLocales).catch(() => [{ locale: settings.primaryLocale, name: settings.primaryLocale, primary: true }]),
    themeStatus(admin),
    latestSyncJob(shop),
  ]);
  const plan = planFor(settings.plan);
  return {
    failureMode: settings.failureMode,
    strings: parseSettingsJson(settings).strings || {},
    defaults: DEFAULT_STRINGS,
    labels: STRING_LABELS,
    locales,
    theme,
    links: themeLinks(shop),
    uploads: { maxUploadMb: plan.maxUploadMb, maxFiles: plan.maxFiles, plan: plan.name },
    job: job ? { status: job.status, scanned: job.scanned, updated: job.updated, removed: job.removed, finishedAt: job.finishedAt } : null,
    syncing: isSyncRunning(shop),
    snippet: PACKING_SLIP_SNIPPET,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "failure-mode") {
    const mode = form.get("mode") === "allow" ? "allow" : "block";
    try {
      await setFailureMode(admin, shop, mode);
      await audit(shop, "failure-mode", { actor: session.email || "", details: mode });
      return { message: mode === "allow" ? "Checkout now allows the base price if pricing can't run." : "Checkout is blocked if pricing can't run." };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (intent === "strings") {
    const locale = String(form.get("locale"));
    const values = JSON.parse(String(form.get("values") || "{}"));
    const settings = await getSettings(shop);
    const extra = parseSettingsJson(settings);
    const clean = {};
    for (const key of Object.keys(DEFAULT_STRINGS)) {
      const v = String(values[key] || "").trim().slice(0, 300);
      if (v) clean[key] = v;
    }
    extra.strings = { ...(extra.strings || {}), [locale]: clean };
    const updated = await updateSettings(shop, { settings: JSON.stringify(extra) });
    await pushConfigs(admin, updated);
    return { message: "Storefront text saved" };
  }
  if (intent === "resync") {
    await scheduleFullSync(shop, "manual");
    return { message: "Re-applying option sets to all products" };
  }
  if (intent === "setup") {
    const { problems } = await ensureSetup(admin, shop, { force: true });
    return problems.length ? { error: problems.join(" ") } : { message: "Setup checked: pricing and checkout validation are on." };
  }
  return null;
};

function StatusRow({ ok, label, okText, badText, href, action }) {
  return (
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
      <s-stack gap="small-100">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">{ok ? okText : badText}</s-text>
      </s-stack>
      {ok ? (
        <s-badge tone="success">On</s-badge>
      ) : (
        <s-button href={href} target="_blank">
          {action}
        </s-button>
      )}
    </s-grid>
  );
}

export default function Settings() {
  const d = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const primary = d.locales.find((l) => l.primary)?.locale || "en";
  const [locale, setLocale] = useState(primary);
  const [values, setValues] = useState(d.strings[primary] || {});
  const [mode, setMode] = useState(d.failureMode);

  useEffect(() => setValues(d.strings[locale] || {}), [locale, d.strings]);
  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  const post = (data) => fetcher.submit(data, { method: "post" });
  const busy = (intent) => fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;

  return (
    <s-page heading="Settings">
      <s-section heading="If add-on pricing can't run">
        <s-stack gap="base">
          <s-paragraph>
            Add-on prices are set at checkout by a Shopify Function. If it ever fails to run, Shopify follows this setting.
          </s-paragraph>
          <Select label="Checkout behavior" value={mode} onValue={setMode}>
            <s-option value="block">Block checkout with a clear message (recommended, never undercharge)</s-option>
            <s-option value="allow">Allow checkout at the product&apos;s base price</s-option>
          </Select>
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              disabled={mode === d.failureMode || undefined}
              loading={busy("failure-mode") || undefined}
              onClick={() => post({ intent: "failure-mode", mode })}
            >
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Theme">
        <s-stack gap="base">
          {d.theme.error ? (
            <s-banner tone="warning">We couldn&apos;t read your theme: {d.theme.error}</s-banner>
          ) : (
            <s-text color="subdued">Live theme: {d.theme.theme || "none"}</s-text>
          )}
          {!d.theme.os2 && !d.theme.error && (
            <s-banner tone="warning">
              Your product template isn&apos;t an Online Store 2.0 template. The app embed still adds options to product pages, but the block can&apos;t be placed.
            </s-banner>
          )}
          <StatusRow
            ok={d.theme.embedOn}
            label="App embed"
            okText="Options are on in your theme."
            badText="Options are off in your theme, so shoppers can't see them."
            href={d.links.embed}
            action="Turn them on"
          />
          <s-divider></s-divider>
          <StatusRow
            ok={d.theme.blockOn}
            label="Product page block"
            okText="The options block is on your product template."
            badText="The options block isn't on your product template yet."
            href={d.links.block}
            action="Add it"
          />
          <s-text color="subdued">
            The app only adds an app block and an app embed. It never edits theme files, so uninstalling leaves your theme as it was.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Storefront text">
        <s-stack gap="base">
          <s-paragraph>Change any text shoppers see. Words in braces are filled in by the app. Leave a field empty to use the default.</s-paragraph>
          {d.locales.length > 1 && (
            <Select label="Language" value={locale} onValue={setLocale}>
              {d.locales.map((l) => (
                <s-option key={l.locale} value={l.locale}>
                  {l.name} ({l.locale})
                </s-option>
              ))}
            </Select>
          )}
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
            {Object.keys(d.defaults).map((key) => (
              <TextField
                key={`${locale}-${key}`}
                label={d.labels[key] || key}
                placeholder={d.defaults[key]}
                value={values[key] || ""}
                onValue={(v) => setValues((cur) => ({ ...cur, [key]: v }))}
              />
            ))}
          </s-grid>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" loading={busy("strings") || undefined} onClick={() => post({ intent: "strings", locale, values: JSON.stringify(values) })}>
              Save text
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="File uploads">
        <s-unordered-list>
          <s-list-item>
            {d.uploads.plan} plan: files up to {d.uploads.maxUploadMb} MB, {d.uploads.maxFiles} per item. <s-link href="/app/plan">Change plan</s-link>
          </s-list-item>
          <s-list-item>JPG, PNG and PDF only. The real file type is checked, not just the name.</s-list-item>
          <s-list-item>Files are private. Only links on your orders open them.</s-list-item>
          <s-list-item>Files are deleted about 180 days after the order. Download any you need to keep before then.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Packing slips">
        <s-stack gap="base">
          <s-paragraph>
            Shopify shows choices on orders and notifications. If your packing slip template doesn&apos;t list them, paste this inside the line item loop of Settings &gt; Shipping and delivery &gt; Packing slip template.
          </s-paragraph>
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{d.snippet}</pre>
          </s-box>
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={() => {
                navigator.clipboard?.writeText(d.snippet);
                shopify.toast.show("Snippet copied");
              }}
            >
              Copy snippet
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Maintenance">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-stack gap="small-100">
              <s-text type="strong">Re-apply option sets to all products</s-text>
              <s-text color="subdued">
                {d.syncing
                  ? "Running now…"
                  : d.job
                    ? `Last run: ${d.job.status}, ${d.job.scanned} checked, ${d.job.updated} updated, ${d.job.removed} removed${d.job.finishedAt ? ` (${new Date(d.job.finishedAt).toLocaleString()})` : ""}`
                    : "Not run yet"}
              </s-text>
            </s-stack>
            <s-button loading={busy("resync") || undefined} disabled={d.syncing || undefined} onClick={() => post({ intent: "resync" })}>
              Re-apply
            </s-button>
          </s-grid>
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-stack gap="small-100">
              <s-text type="strong">Check pricing setup</s-text>
              <s-text color="subdued">Makes sure the add-on product, pricing function and checkout validation are in place.</s-text>
            </s-stack>
            <s-button loading={busy("setup") || undefined} onClick={() => post({ intent: "setup" })}>
              Check
            </s-button>
          </s-grid>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
