// Settings panel for one field of an option set.

import { useAppBridge } from "@shopify/app-bridge-react";
import { PRICE_TYPES_BY_FIELD, isChoiceType, isDisplayType, t } from "../../shared/options-core.js";
import { newId } from "../../shared/templates.js";
import { Checkbox, ColorField, DateField, NumberField, Select, Switch, TextArea, TextField, UrlField } from "./wc";
import { FONT_STACKS } from "./fonts";

export const TYPE_LABELS = {
  text: "Text (single line)",
  textarea: "Text area",
  number: "Number",
  dropdown: "Dropdown",
  radio: "Radio buttons",
  checkbox: "Checkbox",
  checkbox_group: "Checkbox group",
  toggle: "Toggle",
  buttons: "Button group",
  color_swatch: "Color swatch",
  image_swatch: "Image swatch",
  date: "Date picker",
  file: "File upload",
  contact: "Email or phone",
  heading: "Heading",
  paragraph: "Paragraph",
  divider: "Divider",
  spacer: "Spacer",
  popup: "Modal (popup)",
  font_picker: "Font picker",
  product_list: "Product list",
  range: "Range slider",
  dimension: "Dimension",
  time: "Time picker",
  color_picker: "Color picker",
  group: "Option group",
  design_layer: "Design layer",
};

const PRICE_TYPE_LABELS = {
  fixed: "Fixed amount",
  percent: "Percent of product price",
  per_char: "Per character",
  per_unit: "Per unit",
  per_area: "Per area (width × height)",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A fresh field of a given type, labelled in the shop's primary language. */
export function newField(type, locale) {
  const f = { id: newId("f"), type, label: { [locale]: TYPE_LABELS[type] } };
  if (isChoiceType(type) && type !== "product_list") {
    f.values = [
      { id: newId("v"), label: { [locale]: "Option 1" } },
      { id: newId("v"), label: { [locale]: "Option 2" } },
    ];
    if (type === "color_swatch") {
      f.values[0].color = "#1f2a44";
      f.values[1].color = "#c0392b";
    }
    if (type === "font_picker") {
      f.values = FONT_STACKS.slice(0, 3).map((x) => ({ id: newId("v"), label: { [locale]: x.label }, font: x.font }));
    }
  }
  if (type === "product_list") f.values = [];
  if (type === "range") f.settings = { min: 0, max: 100, step: 1, unit: "" };
  if (type === "dimension") f.settings = { unit: "cm", minWidth: 10, maxWidth: 300, minHeight: 10, maxHeight: 300 };
  if (type === "time") f.settings = { start: "09:00", end: "17:00", interval: 30 };
  if (type === "group") f.settings = { collapsed: false };
  if (type === "design_layer") f.settings = { x: 50, y: 50, size: 8, align: "center", color: "#ffffff", font: FONT_STACKS[0].font };
  if (type === "date") f.settings = { leadDays: 1, maxDaysAhead: 90, weekdays: [], blockedDates: [] };
  if (type === "file") f.settings = { fileTypes: ["jpg", "png", "pdf"], maxFiles: 1 };
  if (type === "contact") f.settings = { format: "email" };
  if (type === "heading") f.settings = { size: "medium" };
  if (type === "paragraph") f.text = { [locale]: "Add a short note for shoppers." };
  if (type === "spacer") f.settings = { height: 16 };
  if (type === "popup") {
    f.label = { [locale]: "Size guide" };
    f.title = { [locale]: "Size guide" };
    f.text = { [locale]: "Describe sizes, materials or care here." };
  }
  return f;
}

const setLoc = (map, locale, value) => {
  const base = typeof map === "string" ? { [locale]: map } : { ...(map || {}) };
  if (value) base[locale] = value;
  else delete base[locale];
  return Object.keys(base).length ? base : undefined;
};

function Section({ heading, children }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>{heading}</s-heading>
        {children}
      </s-stack>
    </s-box>
  );
}

export function FieldEditor({ field, fields, locale, locales, currency, onChange, onDelete }) {
  const shopify = useAppBridge();
  const s = field.settings || {};
  const up = (patch) => onChange({ ...field, ...patch });
  const upS = (patch) => up({ settings: { ...s, ...patch } });
  const index = fields.findIndex((f) => f.id === field.id);
  const earlier = fields.slice(0, index).filter((f) => !isDisplayType(f.type) && !f.hidden);
  const priceTypes = PRICE_TYPES_BY_FIELD[field.type] || [];
  const choice = isChoiceType(field.type);
  const otherLocales = locales.filter((l) => l !== locale);
  const display = isDisplayType(field.type);

  // ----- values
  const values = field.values || [];
  const setValues = (next) => up({ values: next });
  const upV = (i, patch) => setValues(values.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const moveV = (i, d) => {
    const next = [...values];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setValues(next);
  };

  // ----- condition
  const cond = field.condition || null;
  const setCond = (c) => up({ condition: c });
  const rules = cond?.rules || [];
  const upRule = (i, patch) => setCond({ ...cond, rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const pickVariant = async (i) => {
    const sel = await shopify.resourcePicker({ type: "variant", multiple: false });
    const v = sel?.[0];
    if (v) upRule(i, { value: v.id, valueLabel: `${v.product?.title || v.title || ""} – ${v.title || v.displayName || ""}` });
  };

  return (
    <s-stack gap="base">
      <Section heading={`${TYPE_LABELS[field.type]} settings`}>
        {display && (
          <>
            <TextField
              label={field.type === "heading" ? "Heading text" : field.type === "popup" ? "Link text" : field.type === "group" ? "Group title" : "Name"}
              details={["heading", "popup", "group"].includes(field.type) ? undefined : "Only you see this name."}
              value={t(field.label, locale)}
              onValue={(v) => up({ label: setLoc(field.label, locale, v) || "" })}
            />
            {field.type === "heading" && (
              <Select label="Size" value={s.size || "medium"} onValue={(v) => upS({ size: v })}>
                <s-option value="small">Small</s-option>
                <s-option value="medium">Medium</s-option>
                <s-option value="large">Large</s-option>
              </Select>
            )}
            {field.type === "popup" && (
              <TextField label="Popup title" placeholder={t(field.label, locale)} value={t(field.title, locale)} onValue={(v) => up({ title: setLoc(field.title, locale, v) })} />
            )}
            {(field.type === "paragraph" || field.type === "popup") && (
              <TextArea label={field.type === "popup" ? "Popup text" : "Text"} rows={5} value={t(field.text, locale)} onValue={(v) => up({ text: setLoc(field.text, locale, v) })} />
            )}
            {field.type === "popup" && (
              <UrlField label="Image URL (optional)" details="Use an image from Content > Files." value={s.image || ""} onValue={(v) => upS({ image: v || undefined })} />
            )}
            {field.type === "spacer" && (
              <NumberField label="Height (px)" min={4} max={120} step={4} value={s.height ?? 16} onValue={(v) => upS({ height: v === "" ? 16 : v })} />
            )}
            {field.type === "group" && (
              <>
                <s-text color="subdued">Options below this group belong to it until the next group. Hiding the group with a condition hides all of them.</s-text>
                <Switch label="Start collapsed" checked={!!s.collapsed} onValue={(v) => upS({ collapsed: v || undefined })} />
              </>
            )}
            {field.type === "design_layer" && (
              <>
                <s-text color="subdued">Shows the shopper&apos;s text on the main product image as they type.</s-text>
                <Select label="Text comes from" value={s.sourceField || ""} onValue={(v) => upS({ sourceField: v || undefined })}>
                  <s-option value="">Choose a text option</s-option>
                  {fields
                    .filter((f) => f.type === "text" || f.type === "textarea")
                    .map((f) => (
                      <s-option key={f.id} value={f.id}>
                        {t(f.label, locale) || f.id}
                      </s-option>
                    ))}
                </Select>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <Select label="Font" value={s.fontField ? `field:${s.fontField}` : s.font || FONT_STACKS[0].font} onValue={(v) => (v.startsWith("field:") ? upS({ fontField: v.slice(6) }) : upS({ fontField: undefined, font: v }))}>
                    {fields
                      .filter((f) => f.type === "font_picker")
                      .map((f) => (
                        <s-option key={f.id} value={`field:${f.id}`}>
                          Shopper&apos;s choice in {t(f.label, locale)}
                        </s-option>
                      ))}
                    {FONT_STACKS.map((fs) => (
                      <s-option key={fs.font} value={fs.font}>
                        {fs.label}
                      </s-option>
                    ))}
                  </Select>
                  <Select label="Color" value={s.colorField ? `field:${s.colorField}` : "fixed"} onValue={(v) => upS({ colorField: v.startsWith("field:") ? v.slice(6) : undefined })}>
                    {fields
                      .filter((f) => f.type === "color_picker" || f.type === "color_swatch")
                      .map((f) => (
                        <s-option key={f.id} value={`field:${f.id}`}>
                          Shopper&apos;s choice in {t(f.label, locale)}
                        </s-option>
                      ))}
                    <s-option value="fixed">Fixed color</s-option>
                  </Select>
                </s-grid>
                {!s.colorField && <ColorField label="Text color" value={s.color || "#ffffff"} onValue={(v) => upS({ color: v })} />}
                <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
                  <NumberField label="Across (%)" min={0} max={100} value={s.x ?? 50} onValue={(v) => upS({ x: v === "" ? 50 : v })} />
                  <NumberField label="Down (%)" min={0} max={100} value={s.y ?? 50} onValue={(v) => upS({ y: v === "" ? 50 : v })} />
                  <NumberField label="Size (% of width)" min={2} max={40} value={s.size ?? 8} onValue={(v) => upS({ size: v === "" ? 8 : v })} />
                  <Select label="Align" value={s.align || "center"} onValue={(v) => upS({ align: v })}>
                    <s-option value="left">Left</s-option>
                    <s-option value="center">Center</s-option>
                    <s-option value="right">Right</s-option>
                  </Select>
                </s-grid>
              </>
            )}
          </>
        )}
        {!display && (
        <>
        <TextField label="Label" value={t(field.label, locale)} onValue={(v) => up({ label: setLoc(field.label, locale, v) || "" })} required />
        <TextField label="Help text" details="Shown under the field and as a tooltip." value={t(field.help, locale)} onValue={(v) => up({ help: setLoc(field.help, locale, v) })} />
        {["text", "textarea", "number", "dropdown", "contact"].includes(field.type) && (
          <TextField label="Placeholder" value={t(field.placeholder, locale)} onValue={(v) => up({ placeholder: setLoc(field.placeholder, locale, v) })} />
        )}
        <Switch
          label={field.type === "checkbox" || field.type === "toggle" ? "Must be checked to add to cart" : "Required"}
          details="Hidden fields are never required."
          checked={!!field.required}
          onValue={(v) => up({ required: v || undefined })}
        />
        </>
        )}

        {field.type === "text" && (
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <NumberField label="Min characters" min={0} value={s.minLength ?? ""} onValue={(v) => upS({ minLength: v === "" ? undefined : v })} />
            <NumberField label="Max characters" min={1} value={s.maxLength ?? ""} onValue={(v) => upS({ maxLength: v === "" ? undefined : v })} />
            <Select label="Allowed characters" value={s.charset || "any"} onValue={(v) => upS({ charset: v })}>
              <s-option value="any">Any</s-option>
              <s-option value="letters">Letters only</s-option>
              <s-option value="numbers">Numbers only</s-option>
              <s-option value="alphanumeric">Letters and numbers</s-option>
            </Select>
          </s-grid>
        )}
        {field.type === "textarea" && (
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <NumberField label="Max characters" min={1} value={s.maxLength ?? ""} onValue={(v) => upS({ maxLength: v === "" ? undefined : v })} />
            <NumberField label="Max lines" min={1} value={s.maxLines ?? ""} onValue={(v) => upS({ maxLines: v === "" ? undefined : v })} />
          </s-grid>
        )}
        {field.type === "number" && (
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <NumberField label="Min" value={s.min ?? ""} onValue={(v) => upS({ min: v === "" ? undefined : v })} />
            <NumberField label="Max" value={s.max ?? ""} onValue={(v) => upS({ max: v === "" ? undefined : v })} />
            <NumberField label="Step" min={0} value={s.step ?? ""} onValue={(v) => upS({ step: v === "" ? undefined : v })} />
          </s-grid>
        )}
        {(field.type === "checkbox" || field.type === "toggle") && (
          <Checkbox label="On by default" checked={!!s.defaultOn} onValue={(v) => upS({ defaultOn: v || undefined })} />
        )}
        {field.type === "checkbox_group" && (
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <NumberField label="Min selections" min={0} value={s.minSelect ?? ""} onValue={(v) => upS({ minSelect: v === "" ? undefined : v })} />
            <NumberField label="Max selections" min={1} value={s.maxSelect ?? ""} onValue={(v) => upS({ maxSelect: v === "" ? undefined : v })} />
          </s-grid>
        )}
        {field.type === "buttons" && (
          <Switch label="Shoppers can pick more than one" checked={!!s.multiple} onValue={(v) => upS({ multiple: v || undefined })} />
        )}
        {field.type === "image_swatch" && (
          <Switch label="Change the product image when picked" checked={!!s.changeImage} onValue={(v) => upS({ changeImage: v || undefined })} />
        )}
        {field.type === "product_list" && (
          <Switch label="Shoppers can pick more than one" checked={!!s.multiple} onValue={(v) => upS({ multiple: v || undefined })} />
        )}
        {field.type === "range" && (
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <NumberField label="Min" value={s.min ?? 0} onValue={(v) => upS({ min: v === "" ? 0 : v })} />
            <NumberField label="Max" value={s.max ?? 100} onValue={(v) => upS({ max: v === "" ? 100 : v })} />
            <NumberField label="Step" min={0} value={s.step ?? 1} onValue={(v) => upS({ step: v === "" ? 1 : v })} />
            <NumberField label="Starts at" details="Empty: shoppers must move the slider." value={s.default ?? ""} onValue={(v) => upS({ default: v === "" ? undefined : v })} />
            <TextField label="Unit" placeholder="cm" value={s.unit || ""} onValue={(v) => upS({ unit: v || undefined })} />
          </s-grid>
        )}
        {field.type === "dimension" && (
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <TextField label="Unit" placeholder="cm" value={s.unit || ""} onValue={(v) => upS({ unit: v || undefined })} />
            <NumberField label="Min width" min={0} value={s.minWidth ?? ""} onValue={(v) => upS({ minWidth: v === "" ? undefined : v })} />
            <NumberField label="Max width" min={0} value={s.maxWidth ?? ""} onValue={(v) => upS({ maxWidth: v === "" ? undefined : v })} />
            <span />
            <NumberField label="Min height" min={0} value={s.minHeight ?? ""} onValue={(v) => upS({ minHeight: v === "" ? undefined : v })} />
            <NumberField label="Max height" min={0} value={s.maxHeight ?? ""} onValue={(v) => upS({ maxHeight: v === "" ? undefined : v })} />
          </s-grid>
        )}
        {field.type === "time" && (
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <TextField label="First slot" placeholder="09:00" details="24-hour, HH:MM" value={s.start || ""} onValue={(v) => upS({ start: v || undefined })} />
            <TextField label="Last slot" placeholder="17:00" value={s.end || ""} onValue={(v) => upS({ end: v || undefined })} />
            <NumberField label="Every (minutes)" min={5} max={240} step={5} value={s.interval ?? 30} onValue={(v) => upS({ interval: v === "" ? 30 : v })} />
          </s-grid>
        )}
        {field.type === "color_picker" && (
          <ColorField label="Starting color (optional)" value={s.default || ""} onValue={(v) => upS({ default: v || undefined })} />
        )}
        {field.type === "contact" && (
          <Select label="Format" value={s.format || "email"} onValue={(v) => upS({ format: v })}>
            <s-option value="email">Email</s-option>
            <s-option value="phone">Phone</s-option>
          </Select>
        )}
        {field.type === "file" && (
          <s-stack gap="small-200">
            <s-text>Allowed file types</s-text>
            <s-stack direction="inline" gap="base">
              {["jpg", "png", "pdf"].map((ext) => (
                <Checkbox
                  key={ext}
                  label={ext.toUpperCase()}
                  checked={(s.fileTypes || ["jpg", "png", "pdf"]).includes(ext)}
                  onValue={(on) => {
                    const cur = new Set(s.fileTypes || ["jpg", "png", "pdf"]);
                    if (on) cur.add(ext);
                    else cur.delete(ext);
                    upS({ fileTypes: [...cur] });
                  }}
                />
              ))}
            </s-stack>
            <NumberField label="Max files" details="Your plan also limits file size and count." min={1} max={20} value={s.maxFiles ?? 1} onValue={(v) => upS({ maxFiles: v === "" ? 1 : v })} />
          </s-stack>
        )}
        {field.type === "date" && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <NumberField label="Lead time (days)" min={0} value={s.leadDays ?? 0} onValue={(v) => upS({ leadDays: v === "" ? 0 : v })} />
              <NumberField label="Max days ahead" min={1} value={s.maxDaysAhead ?? ""} onValue={(v) => upS({ maxDaysAhead: v === "" ? undefined : v })} />
            </s-grid>
            <s-stack gap="small-200">
              <s-text>Allowed weekdays (none checked = every day)</s-text>
              <s-stack direction="inline" gap="base">
                {WEEKDAYS.map((d, i) => (
                  <Checkbox
                    key={d}
                    label={d}
                    checked={(s.weekdays || []).includes(i)}
                    onValue={(on) => {
                      const cur = new Set(s.weekdays || []);
                      if (on) cur.add(i);
                      else cur.delete(i);
                      upS({ weekdays: [...cur].sort() });
                    }}
                  />
                ))}
              </s-stack>
            </s-stack>
            <s-stack gap="small-200">
              <DateField
                label="Block a date"
                details="Holidays or days you're closed. Dates use your store's time zone."
                value=""
                onValue={(v) => v && upS({ blockedDates: [...new Set([...(s.blockedDates || []), v])].sort() })}
              />
              <s-stack direction="inline" gap="small-200">
                {(s.blockedDates || []).map((d) => (
                  <s-button key={d} variant="secondary" icon="x" accessibilityLabel={`Unblock ${d}`} onClick={() => upS({ blockedDates: s.blockedDates.filter((x) => x !== d) })}>
                    {d}
                  </s-button>
                ))}
              </s-stack>
            </s-stack>
          </s-stack>
        )}
      </Section>

      {field.type === "product_list" && (
        <Section heading="Products">
          {values.length === 0 && <s-paragraph>Choose the products shoppers can add. Each one is added to the order as its own item, with its own inventory.</s-paragraph>}
          {values.map((v, i) => (
            <s-box key={v.id} padding="small-200" border="base" borderRadius="base">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                {v.image ? <s-thumbnail src={v.image} alt="" size="small"></s-thumbnail> : <s-icon type="product" />}
                <s-stack gap="small-100">
                  <TextField label="Label shoppers see" value={t(v.label, locale)} onValue={(x) => upV(i, { label: setLoc(v.label, locale, x) || "" })} />
                  <s-text color="subdued">
                    {v.productTitle || "Product"} · {v.price ? `${Number(v.price).toFixed(2)} ${currency}` : "price set on publish"} (from the product, refreshed when you publish)
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="none">
                  <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move up" disabled={i === 0 || undefined} onClick={() => moveV(i, -1)}></s-button>
                  <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move down" disabled={i === values.length - 1 || undefined} onClick={() => moveV(i, 1)}></s-button>
                  <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove product" onClick={() => setValues(values.filter((_, j) => j !== i))}></s-button>
                </s-stack>
              </s-grid>
            </s-box>
          ))}
          <s-button
            icon="plus"
            onClick={async () => {
              const sel = await shopify.resourcePicker({ type: "variant", multiple: true });
              if (!sel?.length) return;
              const known = new Set(values.map((v) => v.variantId));
              const added = sel
                .filter((x) => !known.has(x.id))
                .map((x) => {
                  const productTitle = x.product?.title || x.displayName || x.title || "Product";
                  const variantTitle = x.title && x.title !== "Default Title" ? ` – ${x.title}` : "";
                  return {
                    id: newId("v"),
                    label: { [locale]: `${productTitle}${variantTitle}` },
                    productTitle: `${productTitle}${variantTitle}`,
                    variantId: x.id,
                    productId: x.product?.id || undefined,
                    price: Number(x.price) || 0,
                    image: x.image?.originalSrc || x.product?.images?.[0]?.originalSrc || undefined,
                  };
                });
              setValues([...values, ...added]);
            }}
          >
            Add products
          </s-button>
        </Section>
      )}

      {choice && field.type !== "product_list" && (
        <Section heading="Values">
          {values.map((v, i) => (
            <s-box key={v.id} padding="small-200" border="base" borderRadius="base">
              <s-stack gap="small-200">
                <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="small-200" alignItems="end">
                  <TextField label={`Value ${i + 1}`} value={t(v.label, locale)} onValue={(x) => upV(i, { label: setLoc(v.label, locale, x) || "" })} />
                  {v.priceType === "percent" ? (
                    <NumberField label="Price (%)" min={0} max={1000} value={v.price ?? ""} onValue={(x) => upV(i, { price: x === "" ? undefined : x })} />
                  ) : (
                    <NumberField label={`Price (${currency})`} min={0} step={0.01} value={v.price ?? ""} onValue={(x) => upV(i, { price: x === "" ? undefined : x })} />
                  )}
                  <Select label="Price type" value={v.priceType || "fixed"} onValue={(x) => upV(i, { priceType: x === "percent" ? "percent" : undefined })}>
                    <s-option value="fixed">Fixed</s-option>
                    <s-option value="percent">Percent</s-option>
                  </Select>
                </s-grid>
                {field.type === "color_swatch" && <ColorField label="Color" value={v.color || "#000000"} onValue={(x) => upV(i, { color: x })} />}
                {field.type === "font_picker" && (
                  <Select label="Font" value={v.font || FONT_STACKS[0].font} onValue={(x) => upV(i, { font: x })}>
                    {FONT_STACKS.map((fs) => (
                      <s-option key={fs.font} value={fs.font}>
                        {fs.label}
                      </s-option>
                    ))}
                  </Select>
                )}
                {field.type === "image_swatch" && (
                  <UrlField label="Image URL" details="Use an image from Content > Files." value={v.image || ""} onValue={(x) => upV(i, { image: x || undefined })} />
                )}
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <Checkbox
                    label="Selected by default"
                    checked={!!v.default}
                    onValue={(on) =>
                      setValues(
                        values.map((x, j) =>
                          j === i ? { ...x, default: on || undefined } : field.type === "checkbox_group" || field.settings?.multiple ? x : { ...x, default: undefined },
                        ),
                      )
                    }
                  />
                  <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move value up" disabled={i === 0 || undefined} onClick={() => moveV(i, -1)}></s-button>
                  <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move value down" disabled={i === values.length - 1 || undefined} onClick={() => moveV(i, 1)}></s-button>
                  <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove value" disabled={values.length <= 1 || undefined} onClick={() => setValues(values.filter((_, j) => j !== i))}></s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
          <s-button
            icon="plus"
            onClick={() =>
              setValues([
                ...values,
                {
                  id: newId("v"),
                  label: { [locale]: field.type === "font_picker" ? FONT_STACKS[values.length % FONT_STACKS.length].label : `Option ${values.length + 1}` },
                  ...(field.type === "font_picker" ? { font: FONT_STACKS[values.length % FONT_STACKS.length].font } : {}),
                },
              ])
            }
          >
            Add value
          </s-button>
        </Section>
      )}

      {!display && field.type !== "product_list" && (priceTypes.length > 0 || choice) && (
        <Section heading="Pricing">
          {!choice && (
            <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="end">
              <Select
                label="Add-on price"
                value={field.price?.type || "none"}
                onValue={(v) => up({ price: v === "none" ? null : { type: v, amount: field.price?.amount || 0 } })}
              >
                <s-option value="none">No price</s-option>
                {priceTypes.map((p) => (
                  <s-option key={p} value={p}>
                    {PRICE_TYPE_LABELS[p]}
                  </s-option>
                ))}
              </Select>
              {field.price && (
                <NumberField
                  label={
                    field.price.type === "percent"
                      ? "Percent"
                      : field.price.type === "per_area"
                        ? `Rate per ${s.unit || "unit"}² (${currency})`
                        : `Amount (${currency})`
                  }
                  min={0}
                  step={field.price.type === "percent" ? 1 : field.price.type === "per_area" ? 0.0001 : 0.01}
                  value={field.price.amount ?? 0}
                  onValue={(v) => up({ price: { ...field.price, amount: v === "" ? 0 : v } })}
                />
              )}
            </s-grid>
          )}
          <Select
            label="Charge"
            details="Per item scales with quantity. Once per line is charged once, whatever the quantity."
            value={field.scope === "line" ? "line" : "item"}
            onValue={(v) => up({ scope: v === "line" ? "line" : undefined })}
          >
            <s-option value="item">Per item</s-option>
            <s-option value="line">Once per cart line</s-option>
          </Select>
          <s-text color="subdued">Prices are in {currency}. Shoppers see them converted to their currency.</s-text>
        </Section>
      )}

      <Section heading="Conditional logic">
        <Switch
          label="Only show this field in some cases"
          checked={!!cond}
          onValue={(on) => setCond(on ? { action: "show", match: "all", rules: [{ source: earlier[0] ? "field" : "variant", field: earlier[0]?.id, op: earlier[0] ? "not_empty" : "is" }] } : null)}
        />
        {cond && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <Select label="Action" value={cond.action} onValue={(v) => setCond({ ...cond, action: v })}>
                <s-option value="show">Show this field when</s-option>
                <s-option value="hide">Hide this field when</s-option>
              </Select>
              <Select label="Match" value={cond.match} onValue={(v) => setCond({ ...cond, match: v })}>
                <s-option value="all">All rules match</s-option>
                <s-option value="any">Any rule matches</s-option>
              </Select>
            </s-grid>
            {rules.map((r, i) => {
              const src = r.source === "variant" ? null : fields.find((f) => f.id === r.field);
              const srcChoice = src && isChoiceType(src.type);
              const srcBool = src && (src.type === "checkbox" || src.type === "toggle");
              return (
                <s-box key={i} padding="small-200" border="base" borderRadius="base">
                  <s-grid gridTemplateColumns="1fr 1fr 1fr auto" gap="small-200" alignItems="end">
                    <Select
                      label="When"
                      value={r.source === "variant" ? "__variant" : r.field || ""}
                      onValue={(v) => upRule(i, v === "__variant" ? { source: "variant", field: undefined, op: "is", value: undefined } : { source: "field", field: v, op: "not_empty", value: undefined })}
                    >
                      {earlier.map((f) => (
                        <s-option key={f.id} value={f.id}>
                          {t(f.label, locale) || f.id}
                        </s-option>
                      ))}
                      <s-option value="__variant">Selected variant</s-option>
                    </Select>
                    <Select label="Is" value={r.op} onValue={(v) => upRule(i, { op: v })}>
                      {r.source === "variant" ? (
                        <>
                          <s-option value="is">is</s-option>
                          <s-option value="is_not">is not</s-option>
                        </>
                      ) : srcBool ? (
                        <>
                          <s-option value="not_empty">checked</s-option>
                          <s-option value="empty">not checked</s-option>
                        </>
                      ) : (
                        <>
                          <s-option value="not_empty">filled in</s-option>
                          <s-option value="empty">empty</s-option>
                          <s-option value="is">is</s-option>
                          <s-option value="is_not">is not</s-option>
                          {!srcChoice && <s-option value="contains">contains</s-option>}
                          {src?.type === "checkbox_group" && <s-option value="contains">includes</s-option>}
                          {src?.type === "number" && (
                            <>
                              <s-option value="gt">greater than</s-option>
                              <s-option value="lt">less than</s-option>
                            </>
                          )}
                        </>
                      )}
                    </Select>
                    {r.source === "variant" ? (
                      <s-button onClick={() => pickVariant(i)}>{r.valueLabel || (r.value ? "Variant picked" : "Choose variant")}</s-button>
                    ) : ["is", "is_not", "contains", "gt", "lt"].includes(r.op) ? (
                      srcChoice ? (
                        <Select label="Value" value={r.value || ""} onValue={(v) => upRule(i, { value: v })}>
                          <s-option value="">Choose…</s-option>
                          {(src.values || []).map((v) => (
                            <s-option key={v.id} value={v.id}>
                              {t(v.label, locale)}
                            </s-option>
                          ))}
                        </Select>
                      ) : (
                        <TextField label="Value" value={r.value ?? ""} onValue={(v) => upRule(i, { value: v })} />
                      )
                    ) : (
                      <span />
                    )}
                    <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove rule" onClick={() => {
                      const next = rules.filter((_, j) => j !== i);
                      setCond(next.length ? { ...cond, rules: next } : null);
                    }}></s-button>
                  </s-grid>
                </s-box>
              );
            })}
            <s-button icon="plus" onClick={() => setCond({ ...cond, rules: [...rules, { source: earlier[0] ? "field" : "variant", field: earlier[0]?.id, op: earlier[0] ? "not_empty" : "is" }] })}>
              Add rule
            </s-button>
            {earlier.length === 0 && <s-text color="subdued">Conditions can use fields above this one, or the selected variant.</s-text>}
          </s-stack>
        )}
      </Section>

      {otherLocales.length > 0 && !["divider", "spacer", "design_layer"].includes(field.type) && (
        <Section heading="Translations">
          {otherLocales.map((loc) => (
            <s-stack key={loc} gap="small-200">
              <s-text type="strong">{loc.toUpperCase()}</s-text>
              <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
                <TextField label="Label" placeholder={t(field.label, locale)} value={typeof field.label === "object" ? field.label[loc] || "" : ""} onValue={(v) => up({ label: setLoc(field.label, loc, v) || "" })} />
                {display ? (
                  <TextField label="Popup title" placeholder={t(field.title, locale)} value={typeof field.title === "object" ? field.title?.[loc] || "" : ""} onValue={(v) => up({ title: setLoc(field.title, loc, v) })} />
                ) : (
                  <TextField label="Help text" placeholder={t(field.help, locale)} value={typeof field.help === "object" ? field.help?.[loc] || "" : ""} onValue={(v) => up({ help: setLoc(field.help, loc, v) })} />
                )}
              </s-grid>
              {(field.type === "paragraph" || field.type === "popup") && (
                <TextArea
                  label="Text"
                  rows={3}
                  placeholder={t(field.text, locale)}
                  value={typeof field.text === "object" ? field.text?.[loc] || "" : ""}
                  onValue={(v) => up({ text: setLoc(field.text, loc, v) })}
                />
              )}
              {values.map((v, i) => (
                <TextField
                  key={v.id}
                  label={`Value: ${t(v.label, locale)}`}
                  placeholder={t(v.label, locale)}
                  value={typeof v.label === "object" ? v.label[loc] || "" : ""}
                  onValue={(x) => upV(i, { label: setLoc(v.label, loc, x) || "" })}
                />
              ))}
            </s-stack>
          ))}
        </Section>
      )}

      <s-stack direction="inline" gap="base">
        <s-button tone="critical" variant="secondary" icon="delete" onClick={onDelete}>
          Delete field
        </s-button>
      </s-stack>
    </s-stack>
  );
}

export function priceSummary(field, currency) {
  if (field.type === "product_list") return (field.values || []).length ? `${field.values.length} product${field.values.length > 1 ? "s" : ""}` : "";
  if (isChoiceType(field.type)) {
    const priced = (field.values || []).filter((v) => v.price > 0);
    return priced.length ? `${priced.length} priced value${priced.length > 1 ? "s" : ""}` : "";
  }
  if (!field.price?.amount) return "";
  const amt = field.price.type === "percent" ? `${field.price.amount}%` : `${field.price.amount} ${currency}`;
  return field.price.type === "per_char" ? `${amt} per character` : field.price.type === "per_unit" ? `${amt} per unit` : `+${amt}`;
}

export { TextArea };
