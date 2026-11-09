// Private file storage for shopper uploads.
//
// Drivers:
//  - "s3": any S3-compatible bucket (AWS S3, Cloudflare R2). Set S3_BUCKET,
//    S3_REGION (R2: "auto"), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and, for R2
//    or other providers, S3_ENDPOINT. The browser PUTs straight to the bucket
//    through a short-lived presigned URL (the bucket's CORS must allow PUT from
//    storefront origins). Files are read back through presigned GETs.
//  - "local" (default in development): files live under UPLOAD_DIR and the
//    browser PUTs to this app through a signed URL.
//
// Shoppers and merchants only ever see links of the form
//   {SHOPIFY_APP_URL}/files/{id}?sig={hmac}
// which this app verifies before streaming or redirecting.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const env = process.env;

export const driver = env.S3_BUCKET ? "s3" : "local";
const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR || "./storage/uploads");

function secret() {
  const s = env.FILE_LINK_SECRET || env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("FILE_LINK_SECRET or SHOPIFY_API_SECRET must be set");
  return s;
}

const appUrl = () => (env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

export function newUploadId() {
  return crypto.randomBytes(16).toString("hex");
}

export function hmac(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Permanent, unguessable link stored on the order. */
export function fileLink(id) {
  return `${appUrl()}/files/${id}?sig=${hmac(`file:${id}`)}`;
}

export function verifyFileLink(id, sig) {
  return /^[a-f0-9]{32}$/.test(id) && safeEqual(sig, hmac(`file:${id}`));
}

/** Pull the upload id out of a file link (used to link uploads to orders). */
export function uploadIdFromLink(url) {
  const m = /\/files\/([a-f0-9]{32})\b/.exec(String(url || ""));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// File type detection by content (never trust the name or the header).

const SIGNATURES = [
  { type: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "application/pdf", ext: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

export const ALLOWED_EXTENSIONS = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf" };

export function sniffType(buf) {
  for (const s of SIGNATURES) {
    if (buf.length >= s.bytes.length && s.bytes.every((b, i) => buf[i] === b)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// S3 SigV4 query presigning (no SDK dependency).

const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hmacRaw = (key, s) => crypto.createHmac("sha256", key).update(s).digest();

function s3Target(key) {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION || "us-east-1";
  const encodedKey = key.split("/").map(rfc3986).join("/");
  if (env.S3_ENDPOINT) {
    const u = new URL(env.S3_ENDPOINT);
    return { host: u.host, origin: `${u.protocol}//${u.host}`, uriPath: `/${rfc3986(bucket)}/${encodedKey}`, region };
  }
  const host = region === "us-east-1" ? `${bucket}.s3.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
  return { host, origin: `https://${host}`, uriPath: `/${encodedKey}`, region };
}

export function presignS3(method, key, expiresSeconds = 900, now = new Date()) {
  const { host, origin, uriPath, region } = s3Target(key);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.S3_ACCESS_KEY_ID}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
  const canonical = [method, uriPath, query, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  let k = hmacRaw(`AWS4${env.S3_SECRET_ACCESS_KEY}`, dateStamp);
  k = hmacRaw(k, region);
  k = hmacRaw(k, "s3");
  k = hmacRaw(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(toSign).digest("hex");
  return `${origin}${uriPath}?${query}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------------------
// Driver-neutral API

export function storageKey(shop, id) {
  return `${shop.replace(/[^a-z0-9.-]/gi, "_")}/${id}`;
}

/** Where the browser should PUT the bytes. */
export function uploadTarget(key, id, maxBytes, contentType) {
  if (driver === "s3") {
    return { uploadUrl: presignS3("PUT", key, 900), headers: { "Content-Type": contentType } };
  }
  const exp = Math.floor(Date.now() / 1000) + 900;
  const sig = hmac(`put:${id}:${exp}:${maxBytes}`);
  return {
    uploadUrl: `${appUrl()}/storage/put/${id}?exp=${exp}&max=${maxBytes}&sig=${sig}`,
    headers: { "Content-Type": contentType },
  };
}

export function verifyLocalPut(id, exp, max, sig) {
  if (!/^[a-f0-9]{32}$/.test(id)) return false;
  if (!(Number(exp) > Date.now() / 1000)) return false;
  return safeEqual(sig, hmac(`put:${id}:${exp}:${max}`));
}

function localPath(key) {
  const p = path.resolve(UPLOAD_DIR, key);
  if (!p.startsWith(UPLOAD_DIR + path.sep)) throw new Error("bad key");
  return p;
}

/** Stream a request body to local storage, stopping at maxBytes. */
export async function writeLocal(key, body, maxBytes) {
  const file = localPath(key);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(file);
  let size = 0;
  try {
    for await (const chunk of body) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error("too_large"), { code: "too_large" });
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (e) {
    out.destroy();
    await fsp.rm(file, { force: true });
    throw e;
  }
  return size;
}

/** First bytes + size of a stored object, or null if it isn't there. */
export async function inspect(key) {
  if (driver === "s3") {
    const res = await fetch(presignS3("GET", key, 120), { headers: { Range: "bytes=0-15" } });
    if (!res.ok) return null;
    const head = Buffer.from(await res.arrayBuffer());
    const range = res.headers.get("content-range"); // bytes 0-15/12345
    const size = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length")) || head.length;
    return { head, size };
  }
  try {
    const file = localPath(key);
    const stat = await fsp.stat(file);
    const fh = await fsp.open(file, "r");
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    await fh.close();
    return { head, size: stat.size };
  } catch {
    return null;
  }
}

export async function remove(key) {
  if (driver === "s3") {
    await fetch(presignS3("DELETE", key, 120), { method: "DELETE" }).catch(() => {});
    return;
  }
  await fsp.rm(localPath(key), { force: true }).catch(() => {});
}

/** A Response that serves the file (local) or redirects to a short-lived URL (S3). */
export async function serve(key, { contentType, fileName }) {
  const headers = {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${String(fileName).replace(/[^\w.\- ]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
  };
  if (driver === "s3") {
    return new Response(null, { status: 302, headers: { Location: presignS3("GET", key, 300), "Cache-Control": "no-store" } });
  }
  try {
    const file = localPath(key);
    const stat = await fsp.stat(file);
    const stream = fs.createReadStream(file);
    return new Response(/** @type {any} */ (ReadableStreamFrom(stream)), {
      headers: { ...headers, "Content-Length": String(stat.size) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function ReadableStreamFrom(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (c) => controller.enqueue(new Uint8Array(c)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (e) => controller.error(e));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

// ---------------------------------------------------------------------------
// Basic in-memory rate limiting for public endpoints.

const buckets = new Map();
export function rateLimit(key, limit = 30, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return b.count <= limit;
}

// ---------------------------------------------------------------------------
// Retention (PRD proposal): files are kept about 180 days after the order, then
// deleted. Uploads never attached to an order are removed after 7 days.
// Runs at most once a day per process, triggered from the admin loader.

let lastPurge = 0;
export async function purgeOldUploads(db, { retentionDays = 180, abandonedDays = 7 } = {}) {
  if (Date.now() - lastPurge < 24 * 60 * 60 * 1000) return 0;
  lastPurge = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const old = await db.upload.findMany({
    where: {
      OR: [
        { orderId: null, createdAt: { lt: new Date(Date.now() - abandonedDays * day) } },
        { orderId: { not: null }, createdAt: { lt: new Date(Date.now() - retentionDays * day) } },
      ],
    },
    take: 500,
  });
  for (const u of old) await remove(u.storageKey);
  if (old.length) await db.upload.deleteMany({ where: { id: { in: old.map((u) => u.id) } } });
  return old.length;
}
