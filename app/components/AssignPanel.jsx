// Step 2 of the editor: which products show this option set (PRD F3, screen A5).

import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { NumberField, Switch, TextField } from "./wc";

function ChipList({ items, onRemove, render = (x) => x }) {
  if (!items.length) return null;
  return (
    <s-stack direction="inline" gap="small-200">
      {items.map((x, i) => (
        <s-button key={typeof x === "string" ? x : x.id} variant="secondary" icon="x" accessibilityLabel={`Remove ${render(x)}`} onClick={() => onRemove(i)}>
          {render(x)}
        </s-button>
      ))}
    </s-stack>
  );
}

function TermInput({ label, details, items, onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...items, ...parts])]);
    setDraft("");
  };
  return (
    <s-stack gap="small-200">
      <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
        <TextField
          label={label}
          details={details}
          value={draft}
          onValue={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <s-button onClick={add}>Add</s-button>
      </s-grid>
      <ChipList items={items} onRemove={(i) => onChange(items.filter((_, j) => j !== i))} />
    </s-stack>
  );
}

/**
 * @param {{
 *   rules: any, onRules: (r: any) => void, priority: number, onPriority: (n: number) => void,
 *   status: string, preview: any, previewing: boolean, others: {name: string, priority: number}[],
 *   check: any, onCheck: (productId: string) => void,
 * }} props
 */
export function AssignPanel({ rules, onRules, priority, onPriority, status, preview, previewing, others, check, onCheck }) {
  const shopify = useAppBridge();
  const up = (patch) => onRules({ ...rules, ...patch });

  const pick = async (type) => {
    const key = type === "product" ? "products" : "collections";
    const sel = await shopify.resourcePicker({ type, multiple: true, selectionIds: rules[key].map((x) => ({ id: x.id })) });
    if (!sel) return;
    up({ [key]: sel.map((x) => ({ id: x.id, title: x.title, image: x.images?.[0]?.originalSrc || x.image?.originalSrc || null })) });
  };
  const pickToCheck = async () => {
    const sel = await shopify.resourcePicker({ type: "product", multiple: false });
    if (sel?.[0]) onCheck(sel[0].id);
  };

  return (
    <div className="ed-assign">
      <div className="ed-assign__main">
        {status === "active" ? (
          <s-banner tone="info">Assignment changes go live on your store as soon as you save.</s-banner>
        ) : (
          <s-banner tone="info">Products show this option set once you publish it.</s-banner>
        )}
        <s-section heading="Show this option set on">
          <s-stack gap="base">
            <Switch label="All products" details="Option sets with a higher priority still win on their products." checked={!!rules.all} onValue={(v) => up({ all: v })} />
            {!rules.all && (
              <>
                <s-stack gap="small-200">
                  <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                    <s-text type="strong">Products</s-text>
                    <s-button icon="product" onClick={() => pick("product")}>
                      Choose products
                    </s-button>
                  </s-grid>
                  <ChipList items={rules.products} render={(p) => p.title} onRemove={(i) => up({ products: rules.products.filter((_, j) => j !== i) })} />
                </s-stack>
                <s-stack gap="small-200">
                  <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                    <s-text type="strong">Collections</s-text>
                    <s-button icon="collection" onClick={() => pick("collection")}>
                      Choose collections
                    </s-button>
                  </s-grid>
                  <ChipList items={rules.collections} render={(c) => c.title} onRemove={(i) => up({ collections: rules.collections.filter((_, j) => j !== i) })} />
                </s-stack>
                <TermInput label="Product tags" details="Separate several with commas." items={rules.tags} onChange={(tags) => up({ tags })} />
                <TermInput label="Product types" items={rules.types} onChange={(types) => up({ types })} />
                <TermInput label="Vendors" items={rules.vendors} onChange={(vendors) => up({ vendors })} />
              </>
            )}
          </s-stack>
        </s-section>
        <s-section heading="Priority">
          <s-stack gap="base">
            <NumberField
              label="Priority"
              details="When several option sets match a product, the highest priority wins. Each product shows exactly one set."
              min={-1000}
              max={1000}
              step={1}
              value={priority}
              onValue={(v) => onPriority(v === "" ? 0 : v)}
            />
            {others.length > 0 && <s-text color="subdued">Other live sets: {others.map((o) => `${o.name} (${o.priority})`).join(", ")}</s-text>}
          </s-stack>
        </s-section>
      </div>

      <div className="ed-assign__side">
        <s-section heading="Matched products">
          {previewing && <s-spinner accessibilityLabel="Updating preview" size="base"></s-spinner>}
          {preview ? (
            <s-stack gap="base">
              <s-heading>
                {preview.approximate ? "About " : ""}
                {preview.count} product{preview.count === 1 ? "" : "s"}
              </s-heading>
              {preview.parts?.length > 1 && (
                <s-unordered-list>
                  {preview.parts.map((p) => (
                    <s-list-item key={p.label}>
                      {p.label}: {p.count}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              )}
              {preview.samples?.map((p) => (
                <s-stack key={p.id} direction="inline" gap="small-200" alignItems="center">
                  {p.image ? <s-thumbnail src={p.image} alt="" size="small-200"></s-thumbnail> : <s-icon type="product" />}
                  <s-text>{p.title}</s-text>
                </s-stack>
              ))}
              <s-text color="subdued">Higher-priority sets may take some of these products.</s-text>
            </s-stack>
          ) : (
            <s-paragraph>Add a rule to see which products match.</s-paragraph>
          )}
        </s-section>
        <s-section heading="Which set does a product show?">
          <s-stack gap="base">
            <s-button onClick={pickToCheck}>Check a product</s-button>
            {check && (
              <s-box padding="base" background="subdued" borderRadius="base">
                {check.error ? (
                  <s-text>{check.error}</s-text>
                ) : check.set ? (
                  <s-paragraph>
                    <s-text type="strong">{check.product}</s-text> shows <s-text type="strong">{check.set}</s-text> ({check.reason}, priority {check.priority}).
                    {!check.isThis && " Save and publish here first if you expected this set."}
                  </s-paragraph>
                ) : (
                  <s-paragraph>
                    <s-text type="strong">{check.product}</s-text> doesn&apos;t match any live option set.
                  </s-paragraph>
                )}
              </s-box>
            )}
          </s-stack>
        </s-section>
      </div>
    </div>
  );
}
