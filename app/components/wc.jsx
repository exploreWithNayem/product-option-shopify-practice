// Controlled wrappers for Polaris web components.
//
// React 18 sets props on custom elements as attributes and doesn't route
// `change`/`input` events from them through onChange. These wrappers bind
// native listeners and keep the element's value/checked property in sync, so
// Polaris fields behave like normal controlled inputs.
//
// Boolean attributes must be omitted (not "false") on custom elements in React 18,
// so pass booleans through `bool()`.

import { useEffect, useRef } from "react";

export const bool = (v) => (v ? true : undefined);

/** Listen to a native (custom) event on a web component via its ref. */
export function useElementEvent(ref, name, handler) {
  useNative(ref, [name], handler);
}

function useNative(ref, events, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fn = (e) => latest.current?.(e);
    events.forEach((name) => el.addEventListener(name, fn));
    return () => events.forEach((name) => el.removeEventListener(name, fn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, events.join(",")]);
}

function useSyncProp(ref, prop, value) {
  useEffect(() => {
    const el = ref.current;
    if (el && value !== undefined && el[prop] !== value) el[prop] = value;
  }, [ref, prop, value]);
}

function makeValueField(Tag, { events = ["input", "change"], cast = (v) => v } = {}) {
  function Field({ value, onValue, onBlurValue, required, disabled, readOnly, ...rest }) {
    const ref = useRef(null);
    const str = value === undefined || value === null ? "" : String(value);
    useSyncProp(ref, "value", str);
    useNative(ref, events, (e) => onValue?.(cast(e.currentTarget.value)));
    useNative(ref, ["blur"], (e) => onBlurValue?.(cast(e.currentTarget.value)));
    return (
      <Tag
        ref={ref}
        value={str}
        required={bool(required)}
        disabled={bool(disabled)}
        readOnly={bool(readOnly)}
        {...rest}
      />
    );
  }
  Field.displayName = `WC(${Tag})`;
  return Field;
}

export const TextField = makeValueField("s-text-field");
export const TextArea = makeValueField("s-text-area");
export const SearchField = makeValueField("s-search-field");
export const ColorField = makeValueField("s-color-field", { events: ["change"] });
export const DateField = makeValueField("s-date-field", { events: ["change"] });
export const UrlField = makeValueField("s-url-field");
export const Select = makeValueField("s-select", { events: ["change"] });
export const NumberField = makeValueField("s-number-field", {
  cast: (v) => (v === "" || v === null || v === undefined ? "" : Number(v)),
});
export const MoneyField = makeValueField("s-money-field", {
  cast: (v) => (v === "" || v === null || v === undefined ? "" : Number(v)),
});

function makeCheckField(Tag) {
  function Field({ checked, onValue, disabled, ...rest }) {
    const ref = useRef(null);
    useSyncProp(ref, "checked", !!checked);
    useNative(ref, ["change"], (e) => onValue?.(!!e.currentTarget.checked));
    return <Tag ref={ref} checked={bool(checked)} disabled={bool(disabled)} {...rest} />;
  }
  Field.displayName = `WC(${Tag})`;
  return Field;
}

export const Checkbox = makeCheckField("s-checkbox");
export const Switch = makeCheckField("s-switch");

/** Format integer minor units in a currency for display in the admin. */
export function money(minor, currency = "USD", locale = "en") {
  const zero = ["JPY", "KRW", "VND", "CLP", "ISK", "XAF", "XOF", "XPF", "UGX", "PYG", "RWF", "KMF", "GNF", "BIF", "DJF", "VUV"];
  const d = zero.includes(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(
      minor / Math.pow(10, d),
    );
  } catch {
    return `${(minor / Math.pow(10, d)).toFixed(d)} ${currency}`;
  }
}

/** Trigger a file download from an authenticated (App Bridge) fetch. */
export async function downloadFrom(url, fallbackName) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
