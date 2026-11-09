import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listSets, setStatus, duplicateSet, deleteSet, rulesSummary, createSet } from "../services/optionSets.server";
import { latestSyncJob, scheduleFullSync, isSyncRunning } from "../services/sync.server";
import { importSetsCsv } from "../services/csv.server";
import { getSettings } from "../services/settings.server";
import { themeLinks, themeStatus } from "../services/theme.server";
import { planFor } from "../services/plans";
import { Checkbox, SearchField, downloadFrom, useElementEvent } from "../components/wc";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [sets, job, settings, theme] = await Promise.all([listSets(shop), latestSyncJob(shop), getSettings(shop), themeStatus(admin)]);
  return {
    sets: sets.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name,
      status: s.status,
      fields: s.fields.length,
      appliedTo: rulesSummary(s.rules),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      hasUnpublishedChanges: s.status !== "draft" && s.hasUnpublishedChanges,
    })),
    sync: job ? { status: job.status, scanned: job.scanned, updated: job.updated, running: isSyncRunning(shop) } : null,
    csv: planFor(settings.plan).csv,
    embedOff: !theme.error && !theme.embedOn,
    embedLink: themeLinks(shop).embed,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const actor = session.email || "";
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = String(form.get("ids") || "")
    .split(",")
    .filter(Boolean);
  const plural = (n, word) => `${n} option ${word}${n === 1 ? "" : "s"}`;

  switch (intent) {
    case "create": {
      const row = await createSet(shop, { name: "New option set" }, actor);
      return { created: row.id };
    }
    case "duplicate":
      for (const id of ids) await duplicateSet(shop, id, actor);
      return { message: ids.length === 1 ? "Option set duplicated" : `${plural(ids.length, "set")} duplicated` };
    case "archive":
      for (const id of ids) await setStatus(shop, id, "archived", actor);
      await scheduleFullSync(shop, "sets archived");
      return { message: ids.length === 1 ? "Option set archived" : `${plural(ids.length, "set")} archived` };
    case "restore": {
      let anyActive = false;
      for (const id of ids) anyActive = (await setStatus(shop, id, "active", actor)) === "active" || anyActive;
      if (anyActive) await scheduleFullSync(shop, "sets restored");
      return { message: ids.length === 1 ? "Option set restored" : `${plural(ids.length, "set")} restored` };
    }
    case "delete":
      for (const id of ids) await deleteSet(shop, id, actor);
      await scheduleFullSync(shop, "sets deleted");
      return { message: ids.length === 1 ? "Option set deleted" : `${plural(ids.length, "set")} deleted`, deleted: ids };
    case "import": {
      const settings = await getSettings(shop);
      if (!planFor(settings.plan).csv) return { error: "CSV import is on the Growth plan and up." };
      const file = form.get("file");
      if (!file || typeof file === "string") return { error: "Choose a CSV file." };
      if (file.size > 5 * 1024 * 1024) return { error: "The file is over 5 MB." };
      const res = await importSetsCsv(shop, await file.text(), actor);
      if (res.errors.length) return { error: res.errors.slice(0, 5).join(" ") };
      return { message: `Imported: ${res.created} created, ${res.updated} updated. Publish them to go live.` };
    }
    default:
      return null;
  }
};

const STATUS = {
  active: { tone: "success", label: "Active" },
  draft: { tone: "info", label: "Draft" },
  archived: { tone: "neutral", label: "Archived" },
};

const SORTS = [
  { key: "created-desc", label: "Created (newest first)" },
  { key: "created-asc", label: "Created (oldest first)" },
  { key: "updated-desc", label: "Last edited" },
  { key: "name-asc", label: "Option set name A–Z" },
  { key: "name-desc", label: "Option set name Z–A" },
];

const dateFmt = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function OptionSets() {
  const { sets, sync, csv, embedOff, embedLink } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState("created-desc");
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(0);
  const [pendingDelete, setPendingDelete] = useState([]);
  const fileRef = useRef(null);
  const tableRef = useRef(null);
  const windowRef = useRef(null);
  const [params, setParams] = useSearchParams();

  // The editor opens full screen in an App Bridge app window (<s-app-window>).
  const openEditor = (id, opts = {}) => {
    const el = windowRef.current;
    if (!el) return;
    const sp = new URLSearchParams({ shop: shopify.config.shop || "", host: shopify.config.host || "", embedded: "1" });
    if (opts.step) sp.set("step", opts.step);
    if (opts.welcome) sp.set("welcome", "1");
    el.src = `/editor/${id}?${sp}`;
    el.show?.();
  };
  // Refresh the list whenever the editor window closes, and live while it saves.
  useElementEvent(windowRef, "hide", () => revalidator.revalidate());
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const ch = new BroadcastChannel("shine-options-editor");
    ch.onmessage = (e) => {
      if (e.data?.type === "deleted") windowRef.current?.hide?.();
      revalidator.revalidate();
    };
    return () => ch.close();
  }, [revalidator]);
  // ?open=<id> (from the welcome screen) opens that set straight away.
  useEffect(() => {
    const id = params.get("open");
    if (!id) return;
    const welcome = params.get("welcome") === "1";
    Promise.resolve(shopify.ready).then(() => openEditor(id, { welcome }));
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (fetcher.data?.created) openEditor(fetcher.data.created, { welcome: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data?.created]);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
    if (fetcher.data?.deleted) setSelected((cur) => cur.filter((id) => !fetcher.data.deleted.includes(id)));
  }, [fetcher.data, shopify]);

  // Poll while a product sync runs.
  useEffect(() => {
    if (!sync?.running) return undefined;
    const t = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [sync?.running, revalidator]);

  const hasArchived = sets.some((s) => s.status === "archived");
  const tabs = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "draft", label: "Draft" },
    ...(hasArchived ? [{ key: "archived", label: "Archived" }] : []),
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = sets.filter(
      (s) =>
        (tab === "all" ? s.status !== "archived" : s.status === tab) &&
        (!q || s.name.toLowerCase().includes(q) || String(s.number).includes(q)),
    );
    const by = {
      "created-desc": (a, b) => b.createdAt.localeCompare(a.createdAt),
      "created-asc": (a, b) => a.createdAt.localeCompare(b.createdAt),
      "updated-desc": (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      "name-asc": (a, b) => a.name.localeCompare(b.name),
      "name-desc": (a, b) => b.name.localeCompare(a.name),
    }[sort];
    return [...rows].sort(by);
  }, [sets, tab, query, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  useEffect(() => setPage(0), [tab, query, sort]);
  useElementEvent(tableRef, "nextpage", () => setPage((p) => Math.min(p + 1, pages - 1)));
  useElementEvent(tableRef, "previouspage", () => setPage((p) => Math.max(p - 1, 0)));

  const visibleIds = rows.map((r) => r.id);
  const selectedVisible = selected.filter((id) => visibleIds.includes(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const toggleAll = (on) => setSelected(on ? visibleIds : []);
  const toggleRow = (id, on) => setSelected((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));

  const act = (intent, ids) => fetcher.submit({ intent, ids: ids.join(",") }, { method: "post" });
  // The delete buttons open the modal declaratively (commandFor); this only records the target.
  const askDelete = (ids) => setPendingDelete(ids);
  const exportCsv = async (ids) => {
    if (!csv) {
      shopify.toast.show("CSV export is on the Growth plan and up.", { isError: true });
      return;
    }
    try {
      await downloadFrom(`/app/sets/export${ids ? `?ids=${ids.join(",")}` : ""}`, "option-sets.csv");
    } catch (err) {
      shopify.toast.show(err.message, { isError: true });
    }
  };
  const onImport = (e) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("intent", "import");
    fd.append("file", file);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
    e.currentTarget.value = "";
  };

  const deleteNames = sets.filter((s) => pendingDelete.includes(s.id)).map((s) => s.name);

  return (
    <s-page heading="Option sets">
      <s-button slot="primary-action" variant="primary" loading={(fetcher.state !== "idle" && fetcher.formData?.get("intent") === "create") || undefined} onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}>
        Create option set
      </s-button>
      <s-button slot="secondary-actions" onClick={() => exportCsv(null)}>
        Export
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => (csv ? fileRef.current?.click() : shopify.toast.show("CSV import is on the Growth plan and up.", { isError: true }))}
      >
        Import
      </s-button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} aria-label="Import option sets from CSV" />

      {embedOff && (
        <s-banner tone="warning" heading="Enable app embed" dismissible>
          <s-paragraph>The app embed isn&apos;t enabled on your live theme. Please enable it to display options on your storefront.</s-paragraph>
          <s-button slot="secondary-actions" href={embedLink} target="_blank">
            Open theme editor
          </s-button>
        </s-banner>
      )}
      {sync?.running && (
        <s-banner tone="info" heading="Updating products">
          Applying option sets to your products: {sync.scanned} checked, {sync.updated} updated so far. Your store keeps working while this runs.
        </s-banner>
      )}
      {sync && sync.status === "failed" && !sync.running && (
        <s-banner tone="critical" heading="Product update failed">
          Some products may show an older option set. Open Settings and run &quot;Re-apply option sets&quot;.
        </s-banner>
      )}

      <s-section padding="none" accessibilityLabel="Option sets">
        <s-table ref={tableRef} paginate={pages > 1 || undefined} hasPreviousPage={current > 0 || undefined} hasNextPage={current < pages - 1 || undefined}>
          {selectedVisible.length > 0 ? (
            <s-grid slot="filters" gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
              <s-text type="strong">{selectedVisible.length} selected</s-text>
              <s-button-group>
                <s-button onClick={() => exportCsv(selectedVisible)}>Export</s-button>
                {tab === "archived" ? (
                  <s-button onClick={() => act("restore", selectedVisible)}>Restore</s-button>
                ) : (
                  <s-button onClick={() => act("archive", selectedVisible)}>Archive</s-button>
                )}
                <s-button tone="critical" commandFor="delete-sets-modal" command="--show" onClick={() => askDelete(selectedVisible)}>
                  Delete
                </s-button>
              </s-button-group>
            </s-grid>
          ) : (
            <s-stack slot="filters" gap="small-200">
              <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                <s-stack direction="inline" gap="small-100">
                  {tabs.map((t) => (
                    <s-button key={t.key} variant={tab === t.key ? "secondary" : "tertiary"} onClick={() => setTab(t.key)}>
                      {t.label}
                    </s-button>
                  ))}
                </s-stack>
                <s-stack direction="inline" gap="small-100">
                  <s-button
                    icon="search"
                    variant="secondary"
                    accessibilityLabel={searching ? "Close search" : "Search option sets"}
                    onClick={() => {
                      if (searching) setQuery("");
                      setSearching(!searching);
                    }}
                  ></s-button>
                  <s-button icon="sort" variant="secondary" accessibilityLabel="Sort" commandFor="sets-sort" command="--toggle"></s-button>
                  <s-popover id="sets-sort">
                    <s-box padding="small-200">
                      <s-stack gap="none">
                        {SORTS.map((o) => (
                          <s-button
                            key={o.key}
                            variant="tertiary"
                            icon={sort === o.key ? "check" : "blank"}
                            commandFor="sets-sort"
                            command="--hide"
                            onClick={() => setSort(o.key)}
                          >
                            {o.label}
                          </s-button>
                        ))}
                      </s-stack>
                    </s-box>
                  </s-popover>
                </s-stack>
              </s-grid>
              {searching && (
                <SearchField label="Search option sets" labelAccessibilityVisibility="exclusive" placeholder="Search by name or ID" value={query} onValue={setQuery} />
              )}
            </s-stack>
          )}

          <s-table-header-row>
            <s-table-header listSlot="secondary">
              <Checkbox
                accessibilityLabel="Select all option sets"
                checked={allSelected}
                indeterminate={someSelected || undefined}
                disabled={rows.length === 0}
                onValue={toggleAll}
              />
            </s-table-header>
            <s-table-header listSlot="labeled">ID</s-table-header>
            <s-table-header listSlot="primary">Option set</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="labeled">Applied to</s-table-header>
            <s-table-header>Actions</s-table-header>
            <s-table-header listSlot="labeled">Created at</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((s) => (
              <s-table-row key={s.id}>
                <s-table-cell>
                  <Checkbox accessibilityLabel={`Select ${s.name}`} checked={selected.includes(s.id)} onValue={(on) => toggleRow(s.id, on)} />
                </s-table-cell>
                <s-table-cell>{s.number || "—"}</s-table-cell>
                <s-table-cell>
                  <s-stack gap="small-100">
                    <s-clickable onClick={() => openEditor(s.id)} accessibilityLabel={`Edit ${s.name}`}>
                      <s-text type="strong">{s.name}</s-text>
                    </s-clickable>
                    {s.hasUnpublishedChanges && <s-text color="subdued">Unpublished changes</s-text>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-clickable onClick={() => openEditor(s.id, { step: "products" })} accessibilityLabel={`Change products for ${s.name}`}>
                    <s-text>{s.appliedTo}</s-text>
                  </s-clickable>
                </s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-100">
                    <s-button icon="duplicate" variant="secondary" accessibilityLabel={`Duplicate ${s.name}`} onClick={() => act("duplicate", [s.id])}></s-button>
                    <s-button icon="edit" variant="secondary" accessibilityLabel={`Edit ${s.name}`} onClick={() => openEditor(s.id)}></s-button>
                    <s-button icon="export" variant="secondary" accessibilityLabel={`Export ${s.name} to CSV`} onClick={() => exportCsv([s.id])}></s-button>
                    <s-button
                      icon="delete"
                      variant="secondary"
                      tone="critical"
                      accessibilityLabel={`Delete ${s.name}`}
                      commandFor="delete-sets-modal"
                      command="--show"
                      onClick={() => askDelete([s.id])}
                    ></s-button>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{dateFmt(s.createdAt)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>

        {rows.length === 0 && (
          <s-box padding="large">
            <s-stack gap="base" alignItems="center">
              <s-heading>{sets.length === 0 ? "No option sets yet" : "No option sets match"}</s-heading>
              <s-paragraph>
                {sets.length === 0
                  ? "Start from a template like Engraving or Gift wrap and have it live in minutes."
                  : "Try another search or tab."}
              </s-paragraph>
              {sets.length === 0 && (
                <s-button variant="primary" onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}>
                  Create option set
                </s-button>
              )}
            </s-stack>
          </s-box>
        )}
      </s-section>

      <s-app-window id="option-set-editor" ref={windowRef}></s-app-window>

      <s-modal id="delete-sets-modal" heading={pendingDelete.length === 1 ? "Delete option set?" : `Delete ${pendingDelete.length} option sets?`}>
        <s-paragraph>
          {deleteNames.length === 1 ? `"${deleteNames[0]}"` : `${deleteNames.length} option sets`} will be deleted and removed from every product
          that shows {deleteNames.length === 1 ? "it" : "them"}. Orders already placed keep their choices. This can&apos;t be undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="delete-sets-modal"
          command="--hide"
          onClick={() => act("delete", pendingDelete)}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-sets-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
