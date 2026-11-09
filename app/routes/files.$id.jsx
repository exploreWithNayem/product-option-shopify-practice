import db from "../db.server";
import { serve, verifyFileLink } from "../services/storage.server";

// Private file link stored on the order: /files/:id?sig=...
export const loader = async ({ request, params }) => {
  const sig = new URL(request.url).searchParams.get("sig") || "";
  if (!verifyFileLink(params.id, sig)) return new Response("Not found", { status: 404 });
  const upload = await db.upload.findUnique({ where: { id: params.id } });
  if (!upload || upload.status !== "ready") return new Response("Not found", { status: 404 });
  return serve(upload.storageKey, { contentType: upload.contentType, fileName: upload.fileName });
};
