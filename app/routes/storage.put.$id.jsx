import db from "../db.server";
import { verifyLocalPut, writeLocal } from "../services/storage.server";

// Local storage driver only: the browser PUTs the file here through a signed,
// short-lived URL. (With S3/R2 the browser PUTs straight to the bucket.)
const cors = (request) => ({
  "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
});

export const loader = ({ request }) => new Response(null, { status: 204, headers: cors(request) });

export const action = async ({ request, params }) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers });
  const url = new URL(request.url);
  const exp = url.searchParams.get("exp");
  const max = url.searchParams.get("max");
  const sig = url.searchParams.get("sig");
  if (!verifyLocalPut(params.id, exp, max, sig)) return new Response("Forbidden", { status: 403, headers });
  const upload = await db.upload.findUnique({ where: { id: params.id } });
  if (!upload || upload.status !== "pending") return new Response("Not found", { status: 404, headers });
  if (!request.body) return new Response("Empty", { status: 400, headers });
  try {
    await writeLocal(upload.storageKey, request.body, Number(max));
  } catch (e) {
    const tooLarge = e?.code === "too_large";
    return new Response(tooLarge ? "Too large" : "Upload failed", { status: tooLarge ? 413 : 500, headers });
  }
  return new Response(null, { status: 200, headers });
};
