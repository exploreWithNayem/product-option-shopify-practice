// Live preview of an option set as shoppers will see it, using the same core
// rules (conditions, prices, validation) as the storefront and checkout.
// The product itself is shown as a skeleton; prices beside choices and the
// add-on total on the button are real.

import { useMemo, useState } from "react";
import {
  computeVisibility,
  dateIssue,
  earliestDate,
  effectiveAnswers,
  isChoiceType,
  isMultiSelect,
  quoteAddons,
  t,
  timeSlots,
  toMinor,
  validateAnswers,
} from "../../shared/options-core.js";
import { money } from "./wc";

// Percent prices need a product price; the preview assumes this one.
const SAMPLE_PRICE = 100;

const MESSAGES = {
  required: "Please add {field} to continue.",
  charset: "{field} can only use letters.",
  max_select: "Choose up to {max}.",
  min_select: "Choose at least {min}.",
  max_length: "{field} can be up to {max} characters.",
  min_length: "{field} needs at least {min} characters.",
  dimension_invalid: "Enter both width and height for {field}.",
  time_unavailable: "Choose an available time for {field}.",
  time_invalid: "Choose an available time for {field}.",
  color_invalid: "Choose a color for {field}.",
  default: "Please check {field}.",
};

function message(issue, field, locale) {
  const tpl = MESSAGES[issue.code] || MESSAGES.default;
  return tpl
    .replace("{field}", t(field.label, locale) || "this field")
    .replace("{max}", issue.params?.max ?? "")
    .replace("{min}", issue.params?.min ?? "");
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function OptionsPreview({ fields, locale = "en", currency = "USD", device = "desktop" }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [popup, setPopup] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const set = useMemo(() => ({ id: "preview", v: 1, defaultLocale: locale, fields }), [fields, locale]);
  const today = todayIso();

  const withDefaults = useMemo(() => {
    const a = { ...answers };
    for (const f of fields) {
      if (f.id in a) continue;
      if ((f.type === "checkbox" || f.type === "toggle") && f.settings?.defaultOn) a[f.id] = true;
      const def = (f.values || []).filter((v) => v.default).map((v) => v.id);
      if (def.length && isChoiceType(f.type)) a[f.id] = isMultiSelect(f) ? def : def[0];
      if (f.type === "range" && f.settings?.default !== undefined && f.settings?.default !== "") a[f.id] = Number(f.settings.default);
      if (f.type === "color_picker" && f.settings?.default) a[f.id] = f.settings.default;
    }
    return a;
  }, [answers, fields]);

  const visible = computeVisibility(set, withDefaults, {});
  const baseMinor = toMinor(SAMPLE_PRICE, currency);
  const quote = quoteAddons(set, effectiveAnswers(set, withDefaults, {}), { baseMinor, currency });
  const addons = quote.perItemMinor + quote.perLineMinor;
  const issues = submitted ? validateAnswers(set, withDefaults, { today }) : [];
  const issueFor = (id) => issues.find((i) => i.fieldId === id);
  const fmt = (minor) => money(minor, currency);
  const usesPercent = fields.some((f) => f.price?.type === "percent" || (f.values || []).some((v) => v.priceType === "percent" && v.price));
  const valuePrice = (v) => {
    if (!v?.price) return "";
    const amount = v.priceType === "percent" ? Math.round((baseMinor * v.price) / 100) : toMinor(v.price, currency);
    return ` (+${fmt(amount)})`;
  };
  const fieldPrice = (f) => {
    if (!f.price?.amount) return "";
    const unit = fmt(toMinor(f.price.amount, currency));
    if (f.price.type === "per_char") return ` (+${unit} per letter)`;
    if (f.price.type === "per_unit") return ` (+${unit} each)`;
    if (f.price.type === "percent") return ` (+${fmt(Math.round((baseMinor * f.price.amount) / 100))})`;
    return ` (+${unit})`;
  };
  const setA = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggleIn = (f, id) => {
    const cur = withDefaults[f.id];
    if (isMultiSelect(f)) {
      const arr = cur || [];
      setA(f.id, arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
    } else setA(f.id, cur === id ? undefined : id);
  };

  // Options after a group belong to it until the next group.
  const segments = [];
  for (const f of fields) {
    if (f.type === "group") {
      segments.push({ group: f, items: [] });
      continue;
    }
    if (f.type === "design_layer") continue;
    if (!segments.length) segments.push({ group: null, items: [] });
    segments[segments.length - 1].items.push(f);
  }
  const layers = fields.filter((f) => f.type === "design_layer" && visible[f.id]);
  const layerText = (layer) => {
    const s = layer.settings || {};
    const text = s.sourceField ? withDefaults[s.sourceField] : "";
    if (!text || (s.sourceField && !visible[s.sourceField])) return null;
    let font = s.font;
    const fontField = s.fontField && fields.find((x) => x.id === s.fontField);
    if (fontField && visible[fontField.id]) font = fontField.values?.find((v) => v.id === withDefaults[fontField.id])?.font || font;
    let color = s.color || "#ffffff";
    const colorField = s.colorField && fields.find((x) => x.id === s.colorField);
    if (colorField && visible[colorField.id]) {
      const a = withDefaults[colorField.id];
      color = colorField.type === "color_picker" ? a || color : colorField.values?.find((v) => v.id === a)?.color || color;
    }
    return { text: String(text), font, color, x: Number(s.x ?? 50), y: Number(s.y ?? 50), size: Number(s.size ?? 8), align: s.align || "center" };
  };

  const renderField = (f) => {
    if (!visible[f.id]) return null;

        const label = t(f.label, locale);
        const help = t(f.help, locale);
        const ph = t(f.placeholder, locale);
        const a = withDefaults[f.id];
        const issue = issueFor(f.id);
        const id = `pv-${f.id}`;

        // Layout and content elements
        switch (f.type) {
          case "heading":
            return (
              <p key={f.id} className={`pv__heading pv__heading--${f.settings?.size || "medium"}`}>
                {label}
              </p>
            );
          case "paragraph":
            return (
              <p key={f.id} className="pv__paragraph">
                {t(f.text, locale)}
              </p>
            );
          case "divider":
            return <hr key={f.id} className="pv__divider" />;
          case "spacer":
            return <div key={f.id} style={{ height: Math.max(4, Math.min(120, Number(f.settings?.height) || 16)) }} aria-hidden="true" />;
          case "popup":
            return (
              <button key={f.id} type="button" className="pv__popup-link" onClick={() => setPopup(f)}>
                {f.settings?.image ? <img src={f.settings.image} alt="" /> : <span className="pv__popup-thumb" aria-hidden="true" />}
                {label}
              </button>
            );
          default:
            break;
        }

        let control = null;
        const selectedNames = isChoiceType(f.type)
          ? (Array.isArray(a) ? a : a ? [a] : []).map((vid) => t(f.values?.find((v) => v.id === vid)?.label, locale)).filter(Boolean)
          : [];
        switch (f.type) {
          case "text":
          case "contact":
            control = (
              <>
                <input
                  id={id}
                  type={f.type === "contact" ? (f.settings?.format === "phone" ? "tel" : "email") : "text"}
                  value={a || ""}
                  placeholder={ph}
                  maxLength={f.settings?.maxLength || undefined}
                  onChange={(e) => setA(f.id, e.target.value)}
                />
                {f.type === "text" && f.settings?.maxLength ? (
                  <div className="pv__muted pv__count">
                    {Array.from(a || "").length}/{f.settings.maxLength} characters
                  </div>
                ) : null}
              </>
            );
            break;
          case "textarea":
            control = <textarea id={id} rows={4} value={a || ""} placeholder={ph} maxLength={f.settings?.maxLength || undefined} onChange={(e) => setA(f.id, e.target.value)} />;
            break;
          case "number":
            control = <input id={id} type="number" min={f.settings?.min} max={f.settings?.max} step={f.settings?.step || 1} value={a ?? ""} placeholder={ph} onChange={(e) => setA(f.id, e.target.value)} />;
            break;
          case "dropdown":
            control = (
              <select id={id} value={a || ""} onChange={(e) => setA(f.id, e.target.value || undefined)}>
                <option value="">{ph || "Please select"}</option>
                {(f.values || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {t(v.label, locale)}
                    {valuePrice(v)}
                  </option>
                ))}
              </select>
            );
            break;
          case "radio":
          case "checkbox_group":
            control = (
              <div className="pv__choices" role={f.type === "radio" ? "radiogroup" : "group"} aria-labelledby={`${id}-l`}>
                {(f.values || []).map((v) => {
                  const multi = f.type === "checkbox_group";
                  const checked = multi ? (a || []).includes(v.id) : a === v.id;
                  return (
                    <label key={v.id} className="pv__choice">
                      <input type={multi ? "checkbox" : "radio"} name={id} checked={checked} onChange={() => (multi ? toggleIn(f, v.id) : setA(f.id, v.id))} />
                      {t(v.label, locale)}
                      <span className="pv__price">{valuePrice(v)}</span>
                    </label>
                  );
                })}
              </div>
            );
            break;
          case "color_swatch":
          case "image_swatch":
            control = (
              <div className="pv__swatches" role="group" aria-labelledby={`${id}-l`}>
                {(f.values || []).map((v) => {
                  const on = isMultiSelect(f) ? (a || []).includes(v.id) : a === v.id;
                  const name = `${t(v.label, locale)}${valuePrice(v)}`;
                  return (
                    <button
                      type="button"
                      key={v.id}
                      aria-pressed={on}
                      aria-label={name}
                      title={name}
                      className={`pv__swatch pv__swatch--${f.type === "color_swatch" ? "color" : "image"} ${on ? "is-on" : ""}`}
                      style={f.type === "color_swatch" ? { background: v.color || "#ccc" } : undefined}
                      onClick={() => toggleIn(f, v.id)}
                    >
                      {f.type === "image_swatch" && (v.image ? <img src={v.image} alt="" /> : <span>{t(v.label, locale).slice(0, 2)}</span>)}
                    </button>
                  );
                })}
              </div>
            );
            break;
          case "buttons":
            control = (
              <div className="pv__buttons" role="group" aria-labelledby={`${id}-l`}>
                {(f.values || []).map((v) => {
                  const on = isMultiSelect(f) ? (a || []).includes(v.id) : a === v.id;
                  return (
                    <button type="button" key={v.id} aria-pressed={on} className={`pv__btn ${on ? "is-on" : ""}`} onClick={() => toggleIn(f, v.id)}>
                      {t(v.label, locale)}
                      {valuePrice(v)}
                    </button>
                  );
                })}
              </div>
            );
            break;
          case "checkbox":
          case "toggle":
            control = (
              <label className={`pv__choice ${f.type === "toggle" ? "pv__switch" : ""}`}>
                <input type="checkbox" role={f.type === "toggle" ? "switch" : undefined} checked={!!a} onChange={(e) => setA(f.id, e.target.checked)} />
                {f.type === "toggle" && <span className="pv__track" aria-hidden="true" />}
                {label}
                <span className="pv__price">{fieldPrice(f)}</span>
              </label>
            );
            break;
          case "date": {
            const earliest = earliestDate(f, today);
            control = (
              <>
                <input id={id} type="date" min={earliest || undefined} value={a || ""} onChange={(e) => setA(f.id, e.target.value)} />
                {earliest && <div className="pv__muted">Earliest available date: {earliest}</div>}
                {a && dateIssue(f, a, today) && <div className="pv__muted">That date isn&apos;t available.</div>}
              </>
            );
            break;
          }
          case "font_picker":
            control = (
              <div className="pv__buttons" role="group" aria-labelledby={`${id}-l`}>
                {(f.values || []).map((v) => {
                  const on = a === v.id;
                  return (
                    <button type="button" key={v.id} aria-pressed={on} className={`pv__btn ${on ? "is-on" : ""}`} style={{ fontFamily: v.font }} onClick={() => toggleIn(f, v.id)}>
                      {t(v.label, locale)}
                      {valuePrice(v)}
                    </button>
                  );
                })}
              </div>
            );
            break;
          case "product_list": {
            const multi = isMultiSelect(f);
            control = (
              <div className="pv__products" role={multi ? "group" : "radiogroup"} aria-labelledby={`${id}-l`}>
                {(f.values || []).length === 0 && <span className="pv__muted">Pick products in the settings.</span>}
                {(f.values || []).map((v) => {
                  const on = multi ? (a || []).includes(v.id) : a === v.id;
                  return (
                    <label key={v.id} className={`pv__product ${on ? "is-on" : ""}`}>
                      <input type={multi ? "checkbox" : "radio"} name={id} checked={on} onChange={() => toggleIn(f, v.id)} />
                      {v.image ? <img src={v.image} alt="" /> : <span className="pv__product-img" aria-hidden="true" />}
                      <span className="pv__product-name">{t(v.label, locale)}</span>
                      <span className="pv__price">{v.price ? `+${fmt(toMinor(v.price, currency))}` : ""}</span>
                    </label>
                  );
                })}
              </div>
            );
            break;
          }
          case "range": {
            const st = f.settings || {};
            const min = Number(st.min ?? 0);
            const max = Number(st.max ?? 100);
            const shown = a ?? min;
            control = (
              <div className="pv__range">
                <input
                  id={id}
                  type="range"
                  min={min}
                  max={max}
                  step={st.step || 1}
                  value={shown}
                  aria-valuetext={`${shown}${st.unit ? ` ${st.unit}` : ""}`}
                  onChange={(e) => setA(f.id, Number(e.target.value))}
                />
                <output htmlFor={id}>
                  {a === undefined ? "–" : shown}
                  {st.unit ? ` ${st.unit}` : ""}
                </output>
              </div>
            );
            break;
          }
          case "dimension": {
            const st = f.settings || {};
            const [w, h] = Array.isArray(a) ? a : ["", ""];
            const setDim = (i, v) => {
              const next = Array.isArray(a) ? [...a] : ["", ""];
              next[i] = v;
              setA(f.id, next[0] === "" && next[1] === "" ? undefined : next);
            };
            control = (
              <div className="pv__dims">
                <label>
                  <span className="pv__muted">Width</span>
                  <input id={id} type="number" min={st.minWidth} max={st.maxWidth} value={w ?? ""} onChange={(e) => setDim(0, e.target.value)} />
                </label>
                <span aria-hidden="true">×</span>
                <label>
                  <span className="pv__muted">Height</span>
                  <input type="number" min={st.minHeight} max={st.maxHeight} value={h ?? ""} onChange={(e) => setDim(1, e.target.value)} />
                </label>
                {st.unit ? <span className="pv__muted">{st.unit}</span> : null}
              </div>
            );
            break;
          }
          case "time":
            control = (
              <select id={id} value={a || ""} onChange={(e) => setA(f.id, e.target.value || undefined)}>
                <option value="">Choose a time</option>
                {timeSlots(f).map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            );
            break;
          case "color_picker":
            control = (
              <div className="pv__colorpick">
                <input id={id} type="color" value={a || "#000000"} onChange={(e) => setA(f.id, e.target.value)} aria-label={label} />
                <input type="text" value={a || ""} placeholder="#000000" maxLength={7} onChange={(e) => setA(f.id, e.target.value || undefined)} aria-label={`${label} hex code`} />
              </div>
            );
            break;
          case "file":
            control = (
              <div className="pv__upload">
                Drag a file here or tap to upload
                <div className="pv__muted">
                  {(f.settings?.fileTypes || ["jpg", "png", "pdf"]).map((x) => x.toUpperCase()).join(", ")}
                </div>
              </div>
            );
            break;
          default:
            control = null;
        }
        const inline = f.type === "checkbox" || f.type === "toggle";
        return (
          <div key={f.id} className={`pv__field ${issue ? "has-error" : ""}`}>
            {!inline && (
              <label id={`${id}-l`} htmlFor={id} className="pv__label">
                {label}
                {f.required ? <span aria-hidden="true"> *</span> : null}
                {!isChoiceType(f.type) && <span className="pv__price">{fieldPrice(f)}</span>}
                {(f.type === "color_swatch" || f.type === "image_swatch") && selectedNames.length > 0 && (
                  <span className="pv__price">: {selectedNames.join(", ")}</span>
                )}
              </label>
            )}
            {control}
            {help ? <div className="pv__muted">{help}</div> : null}
            {issue ? (
              <div className="pv__error" role="alert">
                {message(issue, f, locale)}
              </div>
            ) : null}
          </div>
        );
        };

  return (
    <div className={`pv pv--${device}`}>
      {layers.length > 0 && (
        <div className="pv__image" aria-label="Product image preview">
          {layers.map((l) => {
            const o = layerText(l);
            if (!o) return null;
            return (
              <span
                key={l.id}
                className="pv__layer"
                style={{ left: `${o.x}%`, top: `${o.y}%`, fontFamily: o.font, color: o.color, fontSize: `${o.size}cqw`, textAlign: o.align }}
              >
                {o.text}
              </span>
            );
          })}
        </div>
      )}
      <div className="pv__skeleton" aria-hidden="true">
        <div className="pv__bar pv__bar--title" />
        <div className="pv__bar pv__bar--price" />
      </div>
      {fields.length === 0 && <p className="pv__muted">Options you add appear here.</p>}

      {segments.map((seg, si) => {
        if (!seg.group) return <div key={`seg-${si}`} className="pv__seg">{seg.items.map(renderField)}</div>;
        const g = seg.group;
        if (!visible[g.id]) return null;
        const closed = collapsed[g.id] ?? !!g.settings?.collapsed;
        return (
          <div key={g.id} className="pv__group">
            <button type="button" className="pv__group-head" aria-expanded={!closed} onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !closed }))}>
              <span>{t(g.label, locale)}</span>
              <span aria-hidden="true">{closed ? "+" : "−"}</span>
            </button>
            {!closed && <div className="pv__group-body">{seg.items.map(renderField)}</div>}
          </div>
        );
      })}

      <button type="button" className="pv__add" onClick={() => setSubmitted(true)}>
        Add to cart{addons > 0 ? ` · +${fmt(addons)}` : ""}
      </button>
      {usesPercent && <p className="pv__muted">Percent prices are shown for a {fmt(baseMinor)} product.</p>}
      {submitted && issues.length === 0 && <p className="pv__ok">Ready to add to cart.</p>}

      {popup && (
        <div className="pv__overlay" role="dialog" aria-modal="true" aria-label={t(popup.title, locale) || t(popup.label, locale)}>
          <div className="pv__dialog">
            <div className="pv__dialog-head">
              <strong>{t(popup.title, locale) || t(popup.label, locale)}</strong>
              <button type="button" className="pv__close" aria-label="Close" onClick={() => setPopup(null)}>
                ×
              </button>
            </div>
            {popup.settings?.image ? <img src={popup.settings.image} alt="" className="pv__dialog-img" /> : null}
            <p className="pv__paragraph">{t(popup.text, locale)}</p>
          </div>
        </div>
      )}
      <style>{PREVIEW_CSS}</style>
    </div>
  );
}

const PREVIEW_CSS = `
.pv__image{position:relative;aspect-ratio:4/3;border-radius:6px;background:linear-gradient(135deg,#d9d2c5,#a89f91);overflow:hidden;container-type:inline-size}
.pv__layer{position:absolute;transform:translate(-50%,-50%);white-space:pre;line-height:1.1;text-shadow:0 1px 2px rgba(0,0,0,.25);max-width:95%}
.pv__group{border:1px solid #e3e3e3;border-radius:6px}
.pv__group-head{all:unset;cursor:pointer;display:flex;justify-content:space-between;align-items:center;width:100%;box-sizing:border-box;padding:10px 12px;font-weight:600}
.pv__group-head:focus-visible{outline:2px solid #005bd3}
.pv__group-body{display:grid;gap:18px;padding:4px 12px 12px}
.pv__seg{display:grid;gap:18px}
.pv__products{display:grid;gap:8px}
.pv__product{display:grid;grid-template-columns:auto 40px 1fr auto;gap:10px;align-items:center;border:1px solid #d4d4d4;border-radius:6px;padding:8px;cursor:pointer}
.pv__product.is-on{border-color:#303030;box-shadow:inset 0 0 0 1px #303030}
.pv__product img,.pv__product-img{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#ebebeb}
.pv__range{display:flex;align-items:center;gap:12px}
.pv__range input{flex:1;accent-color:#303030}
.pv__range output{min-width:56px;text-align:right}
.pv__dims{display:flex;align-items:end;gap:8px}
.pv__dims label{display:grid;gap:4px;flex:1}
.pv__colorpick{display:flex;gap:8px;align-items:center}
.pv__colorpick input[type=color]{width:44px;height:40px;padding:2px;border:1px solid #d4d4d4;border-radius:4px;background:#fff}
.pv__colorpick input[type=text]{max-width:120px}
.pv{position:relative;color:#303030;font-size:14px;margin:0 auto;width:100%;box-sizing:border-box;display:grid;gap:18px}
.pv--mobile{max-width:375px}
.pv__skeleton{display:grid;gap:14px;margin-bottom:6px}
.pv__bar{background:#e3e3e3;border-radius:4px}
.pv__bar--title{height:26px;width:42%}
.pv__bar--price{height:12px;width:100%}
.pv__muted{color:#616161;font-size:12px}
.pv__count{text-align:right}
.pv__field{display:grid;gap:8px}
.pv__label{font-weight:600}
.pv__price{color:#616161;font-weight:400}
.pv input[type=text],.pv input[type=email],.pv input[type=tel],.pv input[type=number],.pv input[type=date],.pv select,.pv textarea{min-height:40px;border:1px solid #d4d4d4;border-radius:2px;padding:8px 10px;font:inherit;width:100%;box-sizing:border-box;background:#fff;color:inherit}
.pv textarea{min-height:100px;resize:vertical}
.pv select{color:#616161}
.pv__field.has-error input,.pv__field.has-error select,.pv__field.has-error textarea{border-color:#d72c0d}
.pv__choices{display:grid;gap:10px}
.pv__choice{display:flex;gap:10px;align-items:center;cursor:pointer}
.pv__choice input{width:16px;height:16px;margin:0}
.pv__switch input{position:absolute;opacity:0;width:1px;height:1px}
.pv__track{width:34px;height:20px;border-radius:10px;background:#d4d4d4;position:relative;flex:none;transition:background .15s}
.pv__track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.pv__switch input:checked + .pv__track{background:#303030}
.pv__switch input:checked + .pv__track::after{transform:translateX(14px)}
.pv__switch input:focus-visible + .pv__track{outline:2px solid #005bd3;outline-offset:2px}
.pv__swatches{display:flex;flex-wrap:wrap;gap:10px}
.pv__swatch{width:34px;height:34px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #d4d4d4;cursor:pointer;padding:0;display:grid;place-items:center;overflow:hidden;background:#f1f1f1;font-size:11px}
.pv__swatch--image{border-radius:6px}
.pv__swatch img{width:100%;height:100%;object-fit:cover}
.pv__swatch.is-on{box-shadow:0 0 0 2px #303030}
.pv__swatch:focus-visible,.pv__btn:focus-visible,.pv__add:focus-visible,.pv__popup-link:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.pv__buttons{display:flex;flex-wrap:wrap;gap:8px}
.pv__btn{min-height:36px;border:1px solid #d4d4d4;border-radius:4px;background:#fff;padding:6px 14px;cursor:pointer;font:inherit}
.pv__btn.is-on{border-color:#303030;box-shadow:inset 0 0 0 1px #303030}
.pv__upload{border:1px dashed #b5b5b5;border-radius:4px;padding:16px;text-align:center;display:grid;gap:4px}
.pv__heading{margin:0;font-weight:600}
.pv__heading--small{font-size:14px}.pv__heading--medium{font-size:16px}.pv__heading--large{font-size:20px}
.pv__paragraph{margin:0;white-space:pre-line;color:#4a4a4a}
.pv__divider{border:0;border-top:1px solid #e3e3e3;margin:0;width:100%}
.pv__popup-link{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-weight:500;font-size:13px}
.pv__popup-link img,.pv__popup-thumb{width:22px;height:22px;border-radius:3px;object-fit:cover;background:linear-gradient(135deg,#c9b8a6,#8a6f5a)}
.pv__error{color:#8e1f0b;font-size:13px}
.pv__add{width:100%;min-height:48px;border-radius:4px;border:1px solid #303030;background:#fff;color:#303030;font:inherit;font-size:15px;cursor:pointer}
.pv__add:hover{background:#f7f7f7}
.pv__ok{color:#0c5132;margin:0}
.pv__overlay{position:absolute;inset:-12px;background:rgba(0,0,0,.4);display:grid;place-items:center;padding:16px;border-radius:8px;z-index:2}
.pv__dialog{background:#fff;border-radius:12px;padding:16px;max-width:420px;width:100%;display:grid;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.pv__dialog-head{display:flex;justify-content:space-between;align-items:center}
.pv__close{all:unset;cursor:pointer;font-size:22px;width:32px;height:32px;display:grid;place-items:center}
.pv__dialog-img{max-width:100%;border-radius:8px}
`;
