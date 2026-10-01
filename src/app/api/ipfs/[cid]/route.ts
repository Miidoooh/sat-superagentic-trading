export const runtime = "nodejs";

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,100})$/;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
/** Pons resizes its own uploads; public gateways are the fallback. */
const SOURCES = [
  (cid: string) => `https://www.ponsfamily.com/api/ipfs/content/${cid}?variant=card`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
  (cid: string) => `https://dweb.link/ipfs/${cid}`,
];

/**
 * Token logos stored on IPFS. Content-addressed, so a fetched image never
 * changes and is cached for a year. Only image bytes are passed through.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!CID.test(cid)) return new Response("Bad CID", { status: 400 });
  for (const source of SOURCES) {
    try {
      const res = await fetch(source(cid), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/*" } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/^image\/(png|jpe?g|gif|webp|avif|svg\+xml)/.test(type)) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) continue;
      return new Response(body, {
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=31536000, immutable",
          // SVGs can carry script; never let one run as a document from our origin.
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      /* try the next source */
    }
  }
  return new Response("Image unavailable", { status: 404, headers: { "cache-control": "public, max-age=300" } });
}
