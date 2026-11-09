import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings } from "../services/settings.server";
import { planFor } from "../services/plans";
import { fileLink, inspect, remove, sniffType } from "../services/storage.server";

// POST /apps/shine-options/uploads/:id/complete
// Checks the real file type from its first bytes and the stored size, then returns the private link.
export const action = async ({ request, params }) => {
  await authenticate.public.appProxy(request);
  const shop = new URL(request.url).searchParams.get("shop");
  const upload = await db.upload.findFirst({ where: { id: params.id, shop } });
  if (!upload) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  if (upload.status === "ready") return Response.json({ ok: true, fileUrl: fileLink(upload.id) });

  const info = await inspect(upload.storageKey);
  if (!info) return Response.json({ ok: false, error: "missing" }, { status: 409 });

  const settings = await getSettings(shop);
  const maxBytes = planFor(settings.plan).maxUploadMb * 1024 * 1024;
  const sniffed = sniffType(info.head);
  const reject = async (error) => {
    await remove(upload.storageKey);
    await db.upload.update({ where: { id: upload.id }, data: { status: "rejected" } });
    return Response.json({ ok: false, error }, { status: 400 });
  };
  if (!sniffed) return reject("wrong_type");
  if (info.size > maxBytes) return reject("too_large");

  // Malware scanning hook: plug a scanner (e.g. ClamAV) in here before marking ready.
  await db.upload.update({
    where: { id: upload.id },
    data: { status: "ready", contentType: sniffed.type, size: info.size },
  });
  return Response.json({ ok: true, fileUrl: fileLink(upload.id) });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
