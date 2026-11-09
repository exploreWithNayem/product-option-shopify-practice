// "Add option" picker: Options (Selection / Inputs / Layout + Content) and
// Templates tabs with search. A dropdown panel centered under the "Add option"
// button (the parent positions it); closes on choice, outside click or Escape.

import { useEffect, useRef, useState } from "react";
import { TEMPLATES } from "../../shared/templates.js";
import { SearchField } from "./wc";

export const MENU_LABELS = {
  dropdown: "Dropdown",
  image_swatch: "Image swatch",
  checkbox: "Checkbox",
  checkbox_group: "Checkbox group",
  buttons: "Button(s)",
  radio: "Radio buttons",
  color_swatch: "Color swatch",
  toggle: "Switch",
  text: "Text box",
  textarea: "Text area",
  number: "Number box",
  file: "File upload",
  date: "Date picker",
  contact: "Email or phone",
  popup: "Modal (popup)",
  heading: "Heading",
  paragraph: "Paragraph",
  divider: "Divider",
  spacer: "Spacer",
  font_picker: "Font picker",
  product_list: "Product list",
  range: "Range slider",
  dimension: "Dimension",
  time: "Time picker",
  color_picker: "Color picker",
  group: "Option group",
  design_layer: "Design layer",
};

export const TYPE_ICONS = {
  dropdown: "select",
  image_swatch: "image",
  checkbox: "checkbox",
  checkbox_group: "list-bulleted",
  buttons: "button",
  radio: "radio-control",
  color_swatch: "color",
  toggle: "toggle-on",
  text: "text",
  textarea: "text-block",
  number: "hashtag",
  file: "upload",
  date: "calendar",
  contact: "email",
  popup: "layout-popup",
  heading: "text-title",
  paragraph: "text-align-left",
  divider: "minus",
  spacer: "viewport-tall",
  font_picker: "text-font",
  product_list: "product-list",
  range: "adjust",
  dimension: "measurement-size",
  time: "clock",
  color_picker: "eye-dropper",
  group: "layout-section",
  design_layer: "image-magic",
};

const COLUMNS = [
  [
    {
      heading: "Selection",
      items: [
        { type: "dropdown" },
        { type: "image_swatch" },
        { type: "checkbox" },
        { type: "checkbox_group" },
        { type: "buttons" },
        { type: "radio" },
        { type: "color_swatch" },
        { type: "toggle" },
        { type: "font_picker" },
        { type: "product_list" },
        { type: "range" },
      ],
    },
  ],
  [
    {
      heading: "Inputs",
      items: [
        { type: "text" },
        { type: "textarea" },
        { type: "number" },
        { type: "file" },
        { type: "date" },
        { type: "contact" },
        { type: "dimension" },
        { type: "time" },
        { type: "color_picker" },
      ],
    },
  ],
  [
    {
      heading: "Layout",
      items: [{ type: "popup" }, { type: "group" }, { type: "design_layer" }],
    },
    {
      heading: "Content",
      items: [{ type: "heading" }, { type: "paragraph" }, { type: "divider" }, { type: "spacer" }],
    },
  ],
];

export function AddFieldMenu({ tab, onTab, onAddType, onAddTemplate, onClose }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const panel = useRef(null);
  const q = query.trim().toLowerCase();
  const match = (label) => !q || label.toLowerCase().includes(q);

  // Move focus into the panel when it opens; Escape closes it.
  useEffect(() => {
    panel.current?.querySelector(".afm__tab.is-on")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = (type) => {
    onAddType(type);
    onClose();
  };
  const addTemplate = (key) => {
    onAddTemplate(key);
    onClose();
  };

  return (
    <div className="afm-panel" ref={panel} role="dialog" aria-label="Add option">
      <div className="afm">
        <div className="afm__top">
          <div className="afm__tabs" role="tablist" aria-label="Add">
            {[
              ["options", "Options"],
              ["templates", "Templates"],
            ].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`afm__tab ${tab === key ? "is-on" : ""}`} onClick={() => onTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <s-button
            type="button"
            icon="search"
            variant="secondary"
            accessibilityLabel={searching ? "Close search" : "Search"}
            onClick={() => {
              if (searching) setQuery("");
              setSearching(!searching);
            }}
          ></s-button>
        </div>
        {searching && (
          <SearchField
            label={tab === "options" ? "Search options" : "Search templates"}
            labelAccessibilityVisibility="exclusive"
            placeholder={tab === "options" ? "Search options" : "Search templates"}
            value={query}
            onValue={setQuery}
          />
        )}

        {tab === "options" ? (
          <>
            <div className="afm__cols">
              {COLUMNS.map((col, ci) => (
                <div key={ci} className="afm__col">
                  {col.map((group) => {
                    const items = group.items.filter((it) => match(MENU_LABELS[it.type]));
                    if (!items.length) return null;
                    return (
                      <div key={group.heading} className="afm__group">
                        <p className="afm__heading">{group.heading}</p>
                        {items.map((it) => (
                          <s-button key={it.type} type="button" variant="tertiary" icon={TYPE_ICONS[it.type]} onClick={() => add(it.type)}>
                            {MENU_LABELS[it.type]}
                          </s-button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="afm__templates">
            {TEMPLATES.filter((t) => match(`${t.name} ${t.sells} ${t.description}`)).map((t) => (
              <s-clickable key={t.key} padding="small-200" borderRadius="base" border="base" onClick={() => addTemplate(t.key)}>
                <s-stack gap="small-100">
                  <s-text type="strong">{t.name}</s-text>
                  <s-text color="subdued">{t.description}</s-text>
                  <s-text color="subdued">Adds: {t.fields.map((f) => f.label.en).join(", ")}</s-text>
                </s-stack>
              </s-clickable>
            ))}
          </div>
        )}
      </div>
      <style>{AFM_CSS}</style>
    </div>
  );
}

const AFM_CSS = `
.afm-panel{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));z-index:30;background:#fff;border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.16)}
.afm{padding:12px;display:grid;gap:10px;font-size:14px;color:#303030}
.afm__top{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.afm__tabs{display:grid;grid-template-columns:1fr 1fr;background:#ebebeb;border-radius:8px;padding:2px}
.afm__tab{all:unset;cursor:pointer;text-align:center;padding:5px 8px;border-radius:6px;font-weight:500}
.afm__tab.is-on{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.afm__tab:focus-visible,.afm__item:focus-visible,.afm__tpl:focus-visible{outline:2px solid #005bd3;outline-offset:1px}
.afm__cols{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.afm__col{display:grid;gap:12px;align-content:start}
.afm__group{display:grid;gap:0;justify-items:start}
.afm__heading{margin:0 0 4px;font-weight:600}
.afm__item{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:6px;min-height:20px}
.afm__item:hover{background:#f1f1f1}
.afm__item.is-soon{cursor:default;color:#b5b5b5}
.afm__item.is-soon:hover{background:none}
.afm__item.is-soon s-icon{opacity:.45}
.afm__foot{margin:4px 0 0;color:#616161}
.afm__templates{display:grid;gap:6px}
.afm__tpl{all:unset;cursor:pointer;display:grid;gap:2px;padding:8px;border-radius:8px;border:1px solid #e3e3e3}
.afm__tpl:hover{background:#f7f7f7}
.afm__tpl-name{font-weight:600}
.afm__tpl-desc{color:#616161}
`;
