import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings } from "../services/settings.server";
import { planFor } from "../services/plans";
import {
  ALLOWED_EXTENSIONS,
  newUploadId,
  rateLimit,
  storageKey,
  uploadTarget,
} from "../services/storage.server";

// POST /apps/shine-options/uploads  (app proxy, HMAC-verified by Shopify)
// -> { id, uploadUrl, headers, fileUrl? }  then the browser PUTs the bytes to uploadUrl.
export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`upload:${shop}:${ip}`, 40)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const fileName = String(body.fileName || "upload").slice(0, 200);
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const contentType = ALLOWED_EXTENSIONS[ext];
  const size = Number(body.size) || 0;

  const settings = await getSettings(shop);
  const plan = planFor(settings.plan);
  const maxBytes = plan.maxUploadMb * 1024 * 1024;

  if (!contentType) return Response.json({ error: "wrong_type", allowed: Object.keys(ALLOWED_EXTENSIONS) }, { status: 400 });
  if (size <= 0) return Response.json({ error: "empty" }, { status: 400 });
  if (size > maxBytes) return Response.json({ error: "too_large", maxMb: plan.maxUploadMb }, { status: 413 });

  const id = newUploadId();
  const key = storageKey(shop, id);
  await db.upload.create({
    data: {
      id,
      shop,
      storageKey: key,
      fileName,
      contentType,
      size,
      productId: body.productId ? String(body.productId).slice(0, 80) : null,
      fieldId: body.fieldId ? String(body.fieldId).slice(0, 40) : null,
    },
  });
  const target = uploadTarget(key, id, maxBytes, contentType);
  return Response.json({ id, ...target, maxMb: plan.maxUploadMb });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
