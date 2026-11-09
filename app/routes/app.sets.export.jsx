import { authenticate } from "../shopify.server";
import { exportSetsCsv } from "../services/csv.server";
import { getSettings } from "../services/settings.server";
import { planFor } from "../services/plans";

// GET /app/sets/export[?ids=a,b] -> CSV download (fetched by the client with App Bridge auth).
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  if (!planFor(settings.plan).csv) return new Response("CSV export is on the Growth plan and up.", { status: 403 });
  const ids = new URL(request.url).searchParams.get("ids");
  const csv = await exportSetsCsv(session.shop, ids ? ids.split(",").filter(Boolean) : null);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="option-sets-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
