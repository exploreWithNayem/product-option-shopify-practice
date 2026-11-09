import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TEMPLATES, templateFields } from "../../shared/templates.js";
import { createSet } from "../services/optionSets.server";
import { getSettings, updateSettings } from "../services/settings.server";
import { Select } from "../components/wc";

const VERTICALS = [
  { value: "jewelry", label: "Jewelry, watches and gifts", template: "engraving" },
  { value: "gifts", label: "Gifts, books, beauty and home", template: "gift_wrap" },
  { value: "bakery", label: "Cakes, bakery and food", template: "bakery" },
  { value: "made", label: "Furniture, apparel and print (made to order)", template: "custom_size" },
  { value: "electronics", label: "Electronics and appliances", template: "warranty" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    templates: TEMPLATES.map(({ key, name, description, sells, fields }) => ({
      key,
      name,
      description,
      sells,
      fieldCount: fields.length,
      fieldNames: fields.map((f) => f.label.en),
    })),
    locale: settings.primaryLocale,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const key = String(form.get("template") || "");
  const settings = await getSettings(shop);
  const tpl = TEMPLATES.find((t) => t.key === key);
  const row = await createSet(
    shop,
    { name: tpl ? tpl.name : "Untitled option set", fields: tpl ? templateFields(key, settings.primaryLocale) : [] },
    session.email || "",
  );
  await updateSettings(shop, { onboardingDone: true, onboardingStep: 2 });
  // The list page opens the new set in the full-screen editor window.
  throw redirect(`/app/sets?open=${row.id}&welcome=1`);
};

export default function Onboarding() {
  const { templates } = useLoaderData();
  const fetcher = useFetcher();
  const [vertical, setVertical] = useState("");
  const suggested = VERTICALS.find((v) => v.value === vertical)?.template;
  const busyKey = fetcher.state !== "idle" ? fetcher.formData?.get("template") : null;
  const ordered = suggested ? [...templates].sort((a, b) => (a.key === suggested ? -1 : b.key === suggested ? 1 : 0)) : templates;

  const choose = (key) => fetcher.submit({ template: key }, { method: "post" });

  return (
    <s-page heading="Welcome to Product Options" inlineSize="base">
      <s-section>
        <s-stack gap="base">
          <s-ordered-list>
            <s-list-item>
              <s-text type="strong">Pick a template</s-text>
            </s-list-item>
            <s-list-item>Edit labels and prices with a live preview</s-list-item>
            <s-list-item>Assign it to products</s-list-item>
            <s-list-item>Turn it on in your theme</s-list-item>
            <s-list-item>Run the built-in cart test</s-list-item>
          </s-ordered-list>
          <s-paragraph>What do you sell? We&apos;ll start you with a ready-made option set.</s-paragraph>
          <Select label="What do you sell?" labelAccessibilityVisibility="exclusive" value={vertical} onValue={setVertical} placeholder="Choose what you sell">
            {VERTICALS.map((v) => (
              <s-option key={v.value} value={v.value}>
                {v.label}
              </s-option>
            ))}
          </Select>
        </s-stack>
      </s-section>

      <s-section heading="Templates">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {ordered.map((t) => (
            <s-box key={t.key} padding="base" border="base" borderRadius="base" background={t.key === suggested ? "subdued" : "base"}>
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{t.name}</s-heading>
                  {t.key === suggested && <s-badge tone="success">Suggested</s-badge>}
                </s-stack>
                <s-text color="subdued">{t.sells}</s-text>
                <s-paragraph>{t.description}</s-paragraph>
                <s-text color="subdued">{t.fieldNames.join(" · ")}</s-text>
                <s-button
                  variant={t.key === suggested ? "primary" : "secondary"}
                  onClick={() => choose(t.key)}
                  loading={busyKey === t.key || undefined}
                  disabled={(busyKey && busyKey !== t.key) || undefined}
                  accessibilityLabel={`Use the ${t.name} template`}
                >
                  Use template
                </s-button>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-text color="subdued">Prefer a blank canvas?</s-text>
          <s-button variant="tertiary" onClick={() => choose("")} loading={busyKey === "" || undefined}>
            Start from scratch
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
