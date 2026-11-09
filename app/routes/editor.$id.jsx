// Full-screen option set editor, opened from the Option sets list in an App
// Bridge app window (<s-app-window src="/editor/:id">). Two steps:
//   1. Add options   – field list, field settings, live preview
//   2. Select products – assignment rules, priority, matched products
// The page heading/badge/actions render in the window's title bar. A form with
// data-save-bar gives the window its own save bar and asks before closing with
// unsaved changes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { activeSetsForSync, deleteSet, duplicateSet, getSet, publishSet, refreshProductLists, saveSet, setStatus } from "../services/optionSets.server";
import { explainMatch, previewMatches, resolveSet, scheduleFullSync } from "../services/sync.server";
import { getSettings } from "../services/settings.server";
import { gql } from "../services/admin-api.server";
import { lintOptionSet, t } from "../../shared/options-core.js";
import { TEMPLATES, newId } from "../../shared/templates.js";
import { FieldEditor, newField } from "../components/FieldEditor";
import { OptionsPreview } from "../components/OptionsPreview";
import { AddFieldMenu, MENU_LABELS, TYPE_ICONS } from "../components/AddFieldMenu";
import { AssignPanel } from "../components/AssignPanel";
import { Checkbox, TextField } from "../components/wc";

const LOCALES = `#graphql
  query ShineEditorLocales {
    shopLocales(published: true) {
      locale
      primary
    }
  }
`;

const PRODUCT_URL = `#graphql
  query ShineEditorProductUrl($id: ID!) {
    product(id: $id) {
      onlineStoreUrl
      onlineStorePreviewUrl
    }
  }
`;

const PRODUCT_FOR_CHECK = `#graphql
  query ShineEditorCheckProduct($id: ID!) {
    product(id: $id) {
      id
      title
      tags
      productType
      vendor
      collections(first: 250) {
        nodes {
          id
        }
      }
    }
  }
`;

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const set = await getSet(shop, params.id);
  if (!set) throw new Response("Option set not found", { status: 404 });
  const settings = await getSettings(shop);
  const url = new URL(request.url);

  let locales = [settings.primaryLocale];
  try {
    const data = await gql(admin, LOCALES);
    locales = [...data.shopLocales.filter((l) => l.primary), ...data.shopLocales.filter((l) => !l.primary)].map((l) => l.locale);
  } catch {
    // read_locales missing: primary language only
  }

  let viewUrl = null;
  if (set.status === "active") {
    const a = await db.productAssignment.findFirst({ where: { shop, optionSetId: set.id } });
    if (a) {
      const data = await gql(admin, PRODUCT_URL, { id: a.productId }).catch(() => null);
      viewUrl = data?.product?.onlineStoreUrl || data?.product?.onlineStorePreviewUrl || null;
    }
  }

  const [preview, others] = await Promise.all([
    previewMatches(admin, set.rules).catch(() => null),
    db.optionSet.findMany({
      where: { shop, status: "active", id: { not: set.id } },
      select: { name: true, priority: true },
      orderBy: { priority: "desc" },
    }),
  ]);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    set: {
      id: set.id,
      number: set.number,
      name: set.name,
      status: set.status,
      version: set.version,
      fields: set.fields,
      rules: set.rules,
      priority: set.priority,
      hasUnpublishedChanges: set.hasUnpublishedChanges,
    },
    locale: settings.primaryLocale,
    locales,
    currency: settings.currency,
    preview,
    others,
    viewUrl,
    step: url.searchParams.get("step") === "products" ? "products" : "options",
    welcome: url.searchParams.get("welcome") === "1",
  };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const actor = session.email || "";
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "preview") {
    return { preview: await previewMatches(admin, JSON.parse(String(form.get("rules")))) };
  }
  if (intent === "check") {
    const data = await gql(admin, PRODUCT_FOR_CHECK, { id: String(form.get("productId")) });
    if (!data.product) return { check: { error: "Product not found" } };
    const cols = new Set(data.product.collections.nodes.map((n) => n.id));
    const inCol = (cid) => cols.has(cid);
    const winner = resolveSet(await activeSetsForSync(shop), data.product, inCol);
    return {
      check: {
        product: data.product.title,
        set: winner?.name || null,
        isThis: winner?.id === params.id,
        reason: winner ? explainMatch(winner.rules, data.product, inCol) : "",
        priority: winner?.priority ?? null,
      },
    };
  }

  if (intent === "save" || intent === "publish") {
    const payload = JSON.parse(String(form.get("payload")));
    if (!Array.isArray(payload.fields) || payload.fields.length > 100) {
      return { ok: false, error: "An option set can have up to 100 options." };
    }
    const before = await getSet(shop, params.id);
    if (!before) throw new Response("Not found", { status: 404 });
    // Product-list prices come from the products themselves.
    const refreshed = await refreshProductLists(admin, payload.fields);
    payload.fields = refreshed.fields;
    const note = refreshed.removed ? ` ${refreshed.removed} deleted product${refreshed.removed > 1 ? "s were" : " was"} removed from a product list.` : "";
    await saveSet(shop, params.id, payload, actor);

    // Saving a live set publishes it straight away; saving a draft only saves.
    if (intent === "save" && before.status !== "active") return { ok: true, saved: true, message: `Saved.${note}`, fields: payload.fields };
    const settings = await getSettings(shop);
    const res = await publishSet(shop, params.id, settings.primaryLocale, actor);
    if (!res.ok) {
      return { ok: true, saved: true, error: intent === "publish" ? "Fix these before going live." : "Saved as a draft. Fix these to update your store.", problems: res.problems };
    }
    await scheduleFullSync(shop, "set published");
    return {
      ok: true,
      saved: true,
      changed: true,
      fields: payload.fields,
      message: `${before.status === "active" ? "Saved and live." : "Option set is live. Updating products now."}${note}`,
    };
  }
  if (intent === "unpublish") {
    await setStatus(shop, params.id, "draft", actor);
    await scheduleFullSync(shop, "set unpublished");
    return { ok: true, changed: true, message: "Switched to draft. Products no longer show this option set." };
  }
  if (intent === "archive") {
    await setStatus(shop, params.id, "archived", actor);
    await scheduleFullSync(shop, "set archived");
    return { ok: true, changed: true, message: "Option set archived" };
  }
  if (intent === "duplicate") {
    const row = await duplicateSet(shop, params.id, actor);
    return { ok: true, changed: true, duplicated: row.id, message: "Option set duplicated" };
  }
  if (intent === "delete") {
    await deleteSet(shop, params.id, actor);
    await scheduleFullSync(shop, "set deleted");
    return { ok: true, deleted: true };
  }
  return null;
};

/** Copy a field (or a template's fields) with fresh ids, remapping conditions inside the copy. */
function cloneFields(fields, labelSuffix = "") {
  const idMap = {};
  const copies = JSON.parse(JSON.stringify(fields)).map((f) => {
    const nid = newId("f");
    idMap[f.id] = nid;
    return {
      ...f,
      id: nid,
      label: labelSuffix && typeof f.label === "object" ? Object.fromEntries(Object.entries(f.label).map(([k, v]) => [k, `${v}${labelSuffix}`])) : f.label,
      values: f.values?.map((v) => ({ ...v, id: newId("v") })),
    };
  });
  // Remap value ids referenced by conditions within the copied group.
  const valueMap = {};
  fields.forEach((f, i) => (f.values || []).forEach((v, j) => (valueMap[`${f.id}:${v.id}`] = copies[i].values[j].id)));
  for (const c of copies) {
    if (!c.condition) continue;
    c.condition = {
      ...c.condition,
      rules: c.condition.rules.map((r) => {
        if (r.source !== "field" || !idMap[r.field]) return r;
        const mappedValue = valueMap[`${r.field}:${r.value}`];
        return { ...r, field: idMap[r.field], value: mappedValue || r.value };
      }),
    };
  }
  return copies;
}

function EditorScreen() {
  const d = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const saver = useFetcher();
  const previewer = useFetcher();
  const checker = useFetcher();
  const [params] = useSearchParams();

  const initial = useMemo(
    () => ({ name: d.set.name, fields: d.set.fields, rules: d.set.rules, priority: d.set.priority }),
    // Only the first load seeds the draft; later revalidations must not wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.set.id],
  );
  const [draft, setDraft] = useState(initial);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [step, setStep] = useState(d.step);
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [menuTab, setMenuTab] = useState("options");
  const [menuOpen, setMenuOpen] = useState(false);
  const addRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [problems, setProblems] = useState([]);
  const [device, setDevice] = useState("desktop");
  const [showPreview, setShowPreview] = useState(true);
  const draftJson = JSON.stringify(draft);
  const draftInput = useRef(null);
  const submittedJson = useRef(null);
  const channel = useRef(null);
  const { locale, locales, currency } = d;
  const fields = draft.fields;
  const setFields = (fn) => setDraft((cur) => ({ ...cur, fields: typeof fn === "function" ? fn(cur.fields) : fn }));
  const active = d.set.status === "active";

  // Tell the Option sets list (another frame of this app) about changes.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    channel.current = new BroadcastChannel("shine-options-editor");
    return () => channel.current?.close();
  }, []);
  const notify = (type) => channel.current?.postMessage({ type, id: d.set.id });

  // Keep the hidden form control in sync so data-save-bar knows when there are unsaved changes.
  useEffect(() => {
    const el = draftInput.current;
    if (!el || el.value === draftJson) return;
    el.value = draftJson;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, [draftJson]);
  // After a save, the saved draft becomes the form's default value (no longer dirty).
  useEffect(() => {
    const el = draftInput.current;
    if (!el) return;
    el.defaultValue = savedJson;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, [savedJson]);

  useEffect(() => {
    const r = saver.data;
    if (!r) return;
    if (r.saved && submittedJson.current) {
      if (r.fields) {
        // The server refreshed product-list prices: adopt them as the saved state.
        const next = { ...JSON.parse(submittedJson.current), fields: r.fields };
        const json = JSON.stringify(next);
        setDraft((cur) => (JSON.stringify(cur) === submittedJson.current ? next : cur));
        setSavedJson(json);
      } else setSavedJson(submittedJson.current);
    }
    if (r.message) shopify.toast.show(r.message);
    if (r.error) shopify.toast.show(r.error, { isError: true });
    setProblems(r.problems || []);
    if (r.changed || r.saved) notify("changed");
    if (r.deleted) notify("deleted");
    if (r.duplicated) navigate(`/editor/${r.duplicated}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver.data]);

  // Matched-product preview refreshes shortly after the rules change.
  const rulesJson = JSON.stringify(draft.rules);
  useEffect(() => {
    if (step !== "products") return undefined;
    const h = setTimeout(() => previewer.submit({ intent: "preview", rules: rulesJson }, { method: "post" }), 500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesJson, step]);

  const submit = (intent) => {
    submittedJson.current = draftJson;
    saver.submit({ intent, payload: draftJson }, { method: "post" });
  };
  const busyIntent = saver.state !== "idle" ? saver.formData?.get("intent") : null;
  const lint = lintOptionSet({ id: d.set.id, v: 1, defaultLocale: locale, fields });
  const editing = fields.find((f) => f.id === editingId) || null;

  const toggleStatus = () => {
    if (active) return submit("unpublish");
    if (lint.length) {
      setProblems(lint);
      shopify.toast.show("Fix these before going live.", { isError: true });
      return undefined;
    }
    return submit("publish");
  };

  // ----- option list operations
  const uniqueLabel = (type) => {
    const base = MENU_LABELS[type];
    const taken = new Set(fields.map((f) => t(f.label, locale)));
    let n = 1;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };
  const addType = (type) => {
    const f = newField(type, locale);
    if (type !== "popup") f.label = { [locale]: uniqueLabel(type) };
    setFields((fs) => [...fs, f]);
  };
  const addTemplate = (key) => {
    const tpl = TEMPLATES.find((x) => x.key === key);
    if (!tpl) return;
    const relabel = (m) => (m && typeof m === "object" && m.en !== undefined && locale !== "en" ? { [locale]: m.en } : m);
    const copies = cloneFields(tpl.fields).map((f) => ({
      ...f,
      label: relabel(f.label),
      help: relabel(f.help),
      placeholder: relabel(f.placeholder),
      values: f.values?.map((v) => ({ ...v, label: relabel(v.label) })),
    }));
    setFields((fs) => [...fs, ...copies]);
    shopify.toast.show(`Added ${tpl.name}`);
  };
  const duplicate = (ids) => {
    setFields((fs) => {
      const out = [];
      for (const f of fs) {
        out.push(f);
        if (ids.includes(f.id)) out.push(cloneFields([f], " (copy)")[0]);
      }
      return out;
    });
  };
  const remove = (ids) => {
    setFields((fs) =>
      fs
        .filter((f) => !ids.includes(f.id))
        .map((f) => {
          if (!f.condition) return f;
          const rules = f.condition.rules.filter((r) => !ids.includes(r.field));
          return { ...f, condition: rules.length ? { ...f.condition, rules } : null };
        }),
    );
    setSelected((cur) => cur.filter((id) => !ids.includes(id)));
    if (ids.includes(editingId)) setEditingId(null);
  };
  const setHidden = (ids, hidden) => setFields((fs) => fs.map((f) => (ids.includes(f.id) ? { ...f, hidden: hidden || undefined } : f)));
  const move = (id, delta) =>
    setFields((fs) => {
      const i = fs.findIndex((f) => f.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      const [x] = next.splice(i, 1);
      next.splice(j, 0, x);
      return next;
    });
  const dropOn = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setFields((fs) => {
      const from = fs.findIndex((f) => f.id === dragId);
      const to = fs.findIndex((f) => f.id === targetId);
      const next = [...fs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
    setDragId(null);
  };
  const allSelected = fields.length > 0 && selected.length === fields.length;

  // Add option picker: open from either button; a click outside closes it.
  const openMenu = (tab) => {
    if (menuOpen && menuTab === tab) return closeMenu();
    setMenuTab(tab);
    setMenuOpen(true);
    return undefined;
  };
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    addRef.current?.querySelector("s-button")?.focus?.();
  }, []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (addRef.current && !e.composedPath().includes(addRef.current)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  return (
    <form
      data-save-bar
      onSubmit={(e) => {
        e.preventDefault();
        submit("save");
      }}
      onReset={() => {
        setDraft(JSON.parse(savedJson));
        setEditingId(null);
      }}
    >
      <input ref={draftInput} type="text" name="draft" hidden aria-hidden="true" tabIndex={-1} defaultValue={savedJson} />
      {/* The heading becomes the app window's title bar. */}
      <s-page heading={draft.name || "New option set"} inlineSize="large"></s-page>

      <div className="ed">
        <div className="ed-bar">
          <ol className="ed-steps" aria-label="Steps">
            {[
              ["options", "1", "Add options"],
              ["products", "2", "Select products"],
            ].map(([key, n, label]) => (
              <li key={key}>
                <button type="button" className={`ed-step ${step === key ? "is-active" : ""}`} aria-current={step === key ? "step" : undefined} onClick={() => setStep(key)}>
                  <span className="ed-step__n">{n}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>

          <div className="ed-center">
            <div className="ed-name">
              <TextField label="Option set name" labelAccessibilityVisibility="exclusive" value={draft.name} maxLength={120} onValue={(name) => setDraft((cur) => ({ ...cur, name }))} />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              className={`ed-status ${active ? "is-on" : ""}`}
              onClick={toggleStatus}
              disabled={!!busyIntent || d.set.status === "archived"}
              title={active ? "Live on your store. Switch to draft to hide it." : "Draft. Switch on to show it on your store."}
            >
              <span className="ed-status__knob" aria-hidden="true" />
              {d.set.status === "archived" ? "Archived" : active ? "Active" : "Draft"}
            </button>
            <s-button type="button" variant="tertiary" icon="settings" accessibilityLabel="Option set settings" commandFor="set-menu"></s-button>
            <s-menu id="set-menu" accessibilityLabel="Option set settings">
              <s-button type="button" icon="duplicate" onClick={() => submit("duplicate")}>
                Duplicate
              </s-button>
              {d.set.status !== "archived" && (
                <s-button type="button" icon="archive" onClick={() => submit("archive")}>
                  Archive
                </s-button>
              )}
              <s-button type="button" icon="delete" tone="critical" commandFor="delete-set-modal" command="--show">
                Delete
              </s-button>
            </s-menu>
          </div>

          <div className="ed-actions">
            {d.set.number ? <span className="ed-id">ID {d.set.number}</span> : null}
            <s-button type="button" icon="view" href={d.viewUrl || undefined} target="_blank" disabled={!d.viewUrl || undefined}>
              View live
            </s-button>
            <s-button type="button" icon="save" accessibilityLabel={active ? "Save and update store" : "Save"} loading={busyIntent === "save" || undefined} onClick={() => submit("save")}></s-button>
          </div>
        </div>

        {step === "options" ? (
          <div className={`ed-split ${showPreview ? "" : "is-full"}`}>
            <div className="ed-left">
              {(d.welcome || params.get("welcome") === "1") && (
                <s-banner tone="info" dismissible>
                  Add options or start from a template, then select products and switch the set to Active.
                </s-banner>
              )}
              {problems.length > 0 && (
                <s-banner tone="critical" heading="Fix these first">
                  <s-unordered-list>
                    {problems.map((p) => (
                      <s-list-item key={p}>{p}</s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              )}

              {editing ? (
                <s-stack gap="base">
                  <div>
                    <s-button variant="tertiary" icon="arrow-left" type="button" onClick={() => setEditingId(null)}>
                      All options
                    </s-button>
                  </div>
                  <FieldEditor
                    key={editing.id}
                    field={editing}
                    fields={fields}
                    locale={locale}
                    locales={locales}
                    currency={currency}
                    onChange={(next) => setFields((fs) => fs.map((f) => (f.id === next.id ? next : f)))}
                    onDelete={() => remove([editing.id])}
                  />
                </s-stack>
              ) : (
                <>
                  <div className="ed-add" ref={addRef}>
                    <div className="ed-add__main">
                      <s-button icon="plus" type="button" inlineSize="fill" onClick={() => openMenu("options")}>
                        Add option
                      </s-button>
                      {menuOpen && (
                        <AddFieldMenu tab={menuTab} onTab={setMenuTab} onAddType={addType} onAddTemplate={addTemplate} onClose={closeMenu} />
                      )}
                    </div>
                    <s-button type="button" onClick={() => openMenu("templates")}>
                      Use template
                    </s-button>
                  </div>

                  <div className="ed-list">
                    <div className="ed-list__head">
                      <Checkbox
                        accessibilityLabel="Select all options"
                        checked={allSelected}
                        indeterminate={(selected.length > 0 && !allSelected) || undefined}
                        disabled={fields.length === 0}
                        onValue={(on) => setSelected(on ? fields.map((f) => f.id) : [])}
                      />
                      {selected.length > 0 && (
                        <div className="ed-bulk">
                          <span>{selected.length} selected</span>
                          <s-button type="button" variant="tertiary" onClick={() => setHidden(selected, true)}>
                            Hide
                          </s-button>
                          <s-button type="button" variant="tertiary" onClick={() => setHidden(selected, false)}>
                            Show
                          </s-button>
                          <s-button type="button" variant="tertiary" onClick={() => duplicate(selected)}>
                            Duplicate
                          </s-button>
                          <s-button type="button" variant="tertiary" tone="critical" onClick={() => remove(selected)}>
                            Delete
                          </s-button>
                        </div>
                      )}
                      {!showPreview && (
                        <span className="ed-list__end">
                          <s-button type="button" variant="tertiary" icon="maximize" accessibilityLabel="Show preview" onClick={() => setShowPreview(true)}></s-button>
                        </span>
                      )}
                    </div>
                    {fields.length === 0 && <div className="ed-empty">No options yet. Use Add option or start from a template.</div>}
                    {fields.map((f, idx) => {
                      const label = t(f.label, locale) || MENU_LABELS[f.type];
                      const inGroup = f.type !== "group" && fields.slice(0, idx).some((x) => x.type === "group");
                      return (
                        <div
                          key={f.id}
                          className={`ed-row ${dragId === f.id ? "is-dragging" : ""} ${f.hidden ? "is-hidden" : ""} ${f.type === "group" ? "is-group" : ""} ${inGroup ? "in-group" : ""}`}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => dropOn(f.id)}
                        >
                          <button
                            type="button"
                            className="ed-grip"
                            draggable
                            onDragStart={(e) => {
                              setDragId(f.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDragId(null)}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                e.preventDefault();
                                move(f.id, e.key === "ArrowUp" ? -1 : 1);
                              }
                            }}
                            aria-label={`Reorder ${label}. Drag, or press the up and down arrow keys.`}
                          >
                            <s-icon type="drag-handle" />
                          </button>
                          <Checkbox
                            accessibilityLabel={`Select ${label}`}
                            checked={selected.includes(f.id)}
                            onValue={(on) => setSelected((cur) => (on ? [...new Set([...cur, f.id])] : cur.filter((x) => x !== f.id)))}
                          />
                          <s-icon type={TYPE_ICONS[f.type]} />
                          <button type="button" className="ed-row__label" onClick={() => setEditingId(f.id)} title={`Edit ${label}`}>
                            {label}
                          </button>
                          <span className="ed-row__actions">
                            <s-button
                              type="button"
                              variant="tertiary"
                              icon={f.hidden ? "hide" : "view"}
                              accessibilityLabel={f.hidden ? `Show ${label} to shoppers` : `Hide ${label} from shoppers`}
                              onClick={() => setHidden([f.id], !f.hidden)}
                            ></s-button>
                            <s-button type="button" variant="tertiary" icon="duplicate" accessibilityLabel={`Duplicate ${label}`} onClick={() => duplicate([f.id])}></s-button>
                            <s-button type="button" variant="tertiary" tone="critical" icon="delete" accessibilityLabel={`Delete ${label}`} onClick={() => remove([f.id])}></s-button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {showPreview && (
              <div className="ed-right">
                <div className="ed-right__bar">
                  <span className="ed-icons">
                    <s-button
                      type="button"
                      variant={device === "desktop" ? "secondary" : "tertiary"}
                      icon="desktop"
                      accessibilityLabel="Desktop preview"
                      onClick={() => setDevice("desktop")}
                    ></s-button>
                    <s-button
                      type="button"
                      variant={device === "mobile" ? "secondary" : "tertiary"}
                      icon="mobile"
                      accessibilityLabel="Mobile preview"
                      onClick={() => setDevice("mobile")}
                    ></s-button>
                  </span>
                  <s-button type="button" variant="tertiary" icon="minimize" accessibilityLabel="Hide preview" onClick={() => setShowPreview(false)}></s-button>
                </div>
                <OptionsPreview fields={fields} locale={locale} currency={currency} device={device} />
              </div>
            )}
          </div>
        ) : (
          <div className="ed-products">
            <AssignPanel
              rules={draft.rules}
              onRules={(rules) => setDraft((cur) => ({ ...cur, rules }))}
              priority={draft.priority}
              onPriority={(priority) => setDraft((cur) => ({ ...cur, priority }))}
              status={d.set.status}
              preview={previewer.data?.preview || d.preview}
              previewing={previewer.state !== "idle"}
              others={d.others}
              check={checker.data?.check}
              onCheck={(productId) => checker.submit({ intent: "check", productId }, { method: "post" })}
            />
          </div>
        )}
      </div>

      <s-modal id="delete-set-modal" heading="Delete option set?">
        <s-paragraph>
          &quot;{draft.name}&quot; will be deleted and removed from every product that shows it. Orders already placed keep their choices. This can&apos;t be undone.
        </s-paragraph>
        <s-button slot="primary-action" type="button" variant="primary" tone="critical" commandFor="delete-set-modal" command="--hide" onClick={() => submit("delete")}>
          Delete
        </s-button>
        <s-button slot="secondary-actions" type="button" commandFor="delete-set-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
      <style>{EDITOR_CSS}</style>
    </form>
  );
}

const EDITOR_CSS = `
html,body{background:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"San Francisco","Segoe UI",Roboto,"Helvetica Neue",sans-serif}
.ed{min-height:100vh;display:grid;grid-template-rows:auto 1fr;background:#fff;color:#303030;font-family:inherit;font-size:14px}
.ed button,.ed input,.ed select,.ed textarea{font-family:inherit}
.ed-bar{display:grid;grid-template-columns:1fr minmax(320px,640px) 1fr;gap:16px;align-items:center;padding:8px 12px;border-bottom:1px solid #e3e3e3}
.ed-center{display:flex;gap:8px;align-items:center;min-width:0}
.ed-name{flex:1;min-width:0}
.ed-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.ed-id{color:#616161;font-size:12px;margin-right:4px}
@media (max-width: 1000px){.ed-bar{grid-template-columns:1fr}.ed-actions{justify-content:flex-start}}
.ed-steps{display:flex;list-style:none;margin:0;padding:0;gap:4px}
.ed-step{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:6px 20px 6px 10px;font-weight:600;font-size:13px;background:#f1f1f1;color:#303030;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%,10px 50%);min-height:22px}
.ed-steps li:first-child .ed-step{clip-path:polygon(0 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,0 100%);border-radius:6px 0 0 6px}
.ed-step.is-active{background:#005bd3;color:#fff}
.ed-step:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.ed-step__n{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:4px;background:#fff;color:#303030;font-size:11px}
.ed-step.is-active .ed-step__n{color:#005bd3}
.ed-status{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:#ebebeb;font-size:12px;color:#616161;white-space:nowrap}
.ed-status__knob{width:14px;height:14px;border-radius:4px;background:#4a4a4a}
.ed-status.is-on{background:#cdfee1;color:#0c5132}
.ed-status.is-on .ed-status__knob{background:#29845a}
.ed-status:disabled{cursor:default;opacity:.6}
.ed-status:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.ed-split{display:grid;grid-template-columns:minmax(0,2fr) minmax(340px,1fr);min-height:0}
.ed-split.is-full{grid-template-columns:1fr}
@media (max-width: 900px){.ed-split{grid-template-columns:1fr}}
.ed-left{padding:12px;display:grid;gap:12px;align-content:start;min-width:0}
.ed-right{border-left:6px solid #f1f1f1;padding:12px 24px 24px;display:grid;gap:16px;align-content:start;position:sticky;top:0;max-height:100vh;overflow:auto;box-sizing:border-box}
.ed-right__bar{display:flex;justify-content:space-between;align-items:center}
.ed-icons{display:inline-flex;gap:4px}
.ed-add{display:grid;grid-template-columns:1fr auto;gap:12px;position:relative;z-index:5}
.ed-add__main{position:relative}
.ed-list{border:1px solid #e3e3e3;border-radius:8px;overflow:hidden;background:#fff}
.ed-list__head{display:flex;gap:12px;align-items:center;padding:6px 12px 6px 40px;background:#f7f7f7;border-bottom:1px solid #e3e3e3;min-height:28px}
.ed-list__end{margin-left:auto}
.ed-bulk{display:flex;gap:4px;align-items:center;font-size:13px}
.ed-bulk span{margin-right:8px;font-weight:600}
.ed-empty{padding:24px;text-align:center;color:#616161}
.ed-row{display:grid;grid-template-columns:24px auto auto 1fr auto;gap:12px;align-items:center;padding:2px 8px 2px 4px;border-bottom:1px solid #f1f1f1;min-height:30px}
.ed-row:last-child{border-bottom:0}
.ed-row:hover{background:#fafafa}
.ed-row.is-dragging{opacity:.5}
.ed-row.is-hidden .ed-row__label{color:#8a8a8a}
.ed-row.is-group{background:#f7f7f7}
.ed-row.is-group .ed-row__label{font-weight:600}
.ed-row.in-group{padding-left:28px}
.ed-grip{all:unset;cursor:grab;display:grid;place-items:center;width:24px;height:28px;border-radius:4px;color:#8a8a8a}
.ed-grip:focus-visible{outline:2px solid #005bd3}
.ed-row__label{all:unset;cursor:pointer;padding:6px 0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ed-row__label:hover{text-decoration:underline}
.ed-row__label:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.ed-row__actions{display:inline-flex;gap:0}
.ed-products{padding:16px}
.ed-assign{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:16px;align-items:start}
.ed-assign__main,.ed-assign__side{display:grid;gap:16px;min-width:0}
@media (max-width: 900px){.ed-assign{grid-template-columns:1fr}}
`;

export default function Editor() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider embedded apiKey={apiKey}>
      <EditorScreen />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
