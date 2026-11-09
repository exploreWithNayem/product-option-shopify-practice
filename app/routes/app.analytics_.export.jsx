import { authenticate } from "../shopify.server";
import { getAnalytics, rangeFrom } from "../services/analytics.server";
import { getSettings } from "../services/settings.server";
import { planFor } from "../services/plans";
import { fromMinor } from "../../shared/options-core.js";
import { toCsvGeneric } from "../services/csv-generic.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  if (!planFor(settings.plan).analytics) return new Response("Analytics export is on the Growth plan and up.", { status: 403 });
  const { from, to } = rangeFrom(request.url);
  const stats = await getAnalytics(session.shop, from, to);
  const cur = settings.currency;
  const csv = toCsvGeneric(
    ["option_set", "field", "value", "times_chosen", "items", `add_on_revenue_${cur.toLowerCase()}`],
    stats.byValue.map((v) => [v.set, v.field, v.value || "", v.choices, v.quantity, fromMinor(v.revenueMinor, cur)]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="add-on-revenue-${from}-to-${to}.csv"`,
    },
  });
};
