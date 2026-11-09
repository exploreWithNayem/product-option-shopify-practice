import { useNavigate, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getAnalytics, rangeFrom } from "../services/analytics.server";
import { getSettings } from "../services/settings.server";
import { planFor } from "../services/plans";
import { DateField, downloadFrom, money } from "../components/wc";

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const plan = planFor(settings.plan);
  const { from, to } = rangeFrom(request.url);
  const stats = await getAnalytics(session.shop, from, to);
  return { from, to, currency: settings.currency, allowed: plan.analytics, stats };
};

function Table({ heading, columns, rows }) {
  return (
    <s-section heading={heading} padding="none">
      {rows.length === 0 ? (
        <s-box padding="base">
          <s-text color="subdued">No add-on orders in this range yet.</s-text>
        </s-box>
      ) : (
        <s-table>
          <s-table-header-row>
            {columns.map((c, i) => (
              <s-table-header key={c.label} listSlot={i === 0 ? "primary" : "labeled"} format={c.numeric ? "numeric" : undefined}>
                {c.label}
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {rows.map((r, i) => (
              <s-table-row key={i}>
                {columns.map((c) => (
                  <s-table-cell key={c.label}>{c.render(r)}</s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}

export default function Analytics() {
  const { from, to, currency, allowed, stats } = useLoaderData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const days = params.get("days") || (params.get("from") ? "" : "30");
  const fmt = (m) => money(m, currency);
  const go = (q) => navigate(`/app/analytics?${new URLSearchParams(q)}`);

  const exportCsv = async () => {
    try {
      await downloadFrom(`/app/analytics/export?from=${from}&to=${to}`, "add-on-revenue.csv");
    } catch (e) {
      shopify.toast.show(e.message, { isError: true });
    }
  };

  const maxDay = Math.max(1, ...stats.byDay.map(([, v]) => v));

  return (
    <s-page heading="Add-on analytics">
      <s-button slot="primary-action" onClick={exportCsv} disabled={!allowed || undefined}>
        Export CSV
      </s-button>

      <s-section>
        <s-grid gridTemplateColumns="auto 1fr 1fr" gap="base" alignItems="end">
          <s-button-group>
            {RANGES.map((r) => (
              <s-button key={r.key} variant={days === r.key ? "primary" : "secondary"} onClick={() => go({ days: r.key })}>
                {r.label}
              </s-button>
            ))}
          </s-button-group>
          <DateField label="From" value={from} onValue={(v) => v && go({ from: v, to })} />
          <DateField label="To" value={to} onValue={(v) => v && go({ from, to: v })} />
        </s-grid>
      </s-section>

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Add-on revenue</s-text>
              <s-heading>{fmt(stats.revenueMinor)}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Orders with add-ons</s-text>
              <s-heading>{stats.orders}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Average add-on per order</s-text>
              <s-heading>{fmt(stats.orders ? Math.round(stats.revenueMinor / stats.orders) : 0)}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
        {stats.byDay.length > 1 && (
          <figure className="so-chart" aria-label={`Daily add-on revenue from ${from} to ${to}`}>
            <div className="so-bars">
              {stats.byDay.map(([d, v]) => (
                <div key={d} className="so-bar" style={{ height: `${Math.max(2, (v / maxDay) * 100)}%` }} title={`${d}: ${fmt(v)}`} />
              ))}
            </div>
            <figcaption className="so-axis">
              <span>{stats.byDay[0][0]}</span>
              <span>Daily add-on revenue ({currency}), peak {fmt(maxDay)}</span>
              <span>{stats.byDay[stats.byDay.length - 1][0]}</span>
            </figcaption>
          </figure>
        )}
      </s-section>

      {!allowed ? (
        <s-section heading="See what every option earns">
          <s-paragraph>
            Revenue by option set, field and value, the most chosen values and CSV export are on the Growth plan.
          </s-paragraph>
          <s-button variant="primary" href="/app/plan">
            See plans
          </s-button>
        </s-section>
      ) : (
        <>
          <Table
            heading="By option set"
            rows={stats.bySet}
            columns={[
              { label: "Option set", render: (r) => r.name },
              { label: "Choices", numeric: true, render: (r) => r.choices },
              { label: "Add-on revenue", numeric: true, render: (r) => fmt(r.revenueMinor) },
            ]}
          />
          <Table
            heading="By field"
            rows={stats.byField}
            columns={[
              { label: "Field", render: (r) => r.label },
              { label: "Option set", render: (r) => r.set },
              { label: "Choices", numeric: true, render: (r) => r.choices },
              { label: "Add-on revenue", numeric: true, render: (r) => fmt(r.revenueMinor) },
            ]}
          />
          <Table
            heading="By value"
            rows={stats.byValue}
            columns={[
              { label: "Value", render: (r) => `${r.field}: ${r.value || "filled in"}` },
              { label: "Option set", render: (r) => r.set },
              { label: "Times chosen", numeric: true, render: (r) => r.choices },
              { label: "Items", numeric: true, render: (r) => r.quantity },
              { label: "Add-on revenue", numeric: true, render: (r) => fmt(r.revenueMinor) },
            ]}
          />
        </>
      )}
      <style>{`
.so-chart{margin:16px 0 0}
.so-bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid #e3e3e3}
.so-bar{flex:1;background:#303030;border-radius:2px 2px 0 0;min-width:2px}
.so-axis{display:flex;justify-content:space-between;color:#616161;font-size:12px;margin-top:4px;gap:8px}
`}</style>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
