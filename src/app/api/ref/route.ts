import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { getKv } from "@/lib/store/kv";

export const runtime = "nodejs";

const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase());
const Body = z.object({ ref: ADDR, wallet: ADDR });

/** How many wallets this address has referred. */
export async function GET(req: Request) {
  const parsed = ADDR.safeParse(new URL(req.url).searchParams.get("address"));
  if (!parsed.success) return NextResponse.json({ error: "Bad address" }, { status: 400 });
  try {
    return NextResponse.json({ count: (await getKv().smembers(`ref:${parsed.data}`)).length });
  } catch (err) {
    return errorResponse(err, 503);
  }
}

/** Record that a wallet arrived through a referral link. A wallet is only ever credited once. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "ref", 10);
  if (limited) return limited;
  try {
    const { ref, wallet } = Body.parse(await req.json());
    if (ref === wallet) return NextResponse.json({ ok: false });
    const kv = getKv();
    if (await kv.get(`ref:by:${wallet}`)) return NextResponse.json({ ok: false, already: true });
    await kv.set(`ref:by:${wallet}`, ref);
    await kv.sadd(`ref:${ref}`, wallet);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    return errorResponse(err);
  }
}
