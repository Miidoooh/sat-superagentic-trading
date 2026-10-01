import { NextResponse } from "next/server";
import { errorResponse, rateLimit } from "@/lib/http";
import { workerAlive } from "@/lib/store/snapshots";
import { getKv } from "@/lib/store/kv";
import { checkLinkCode, createLinkCode, pollUpdates, telegramConfig } from "@/lib/telegram/telegram";

export const runtime = "nodejs";

/** Is Telegram set up on this deployment, and is a worker sending alerts 24/7? */
export async function GET(req: Request) {
  const cfg = telegramConfig();
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    return NextResponse.json({
      configured: cfg !== null,
      bot: cfg?.username ?? null,
      worker: await workerAlive(),
      sharedStore: getKv().shared,
    });
  }
  if (!cfg) return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 501 });
  if (!/^[0-9a-f]{18}$/.test(code)) return NextResponse.json({ error: "Bad code" }, { status: 400 });
  const limited = rateLimit(req, "tg-link-check", 60);
  if (limited) return limited;
  try {
    await pollUpdates(cfg);
    const token = await checkLinkCode(code);
    return NextResponse.json({ linked: token !== null, token });
  } catch (err) {
    return errorResponse(err, 410);
  }
}

/** Start linking: returns the t.me deep link the user opens. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "tg-link", 10);
  if (limited) return limited;
  const cfg = telegramConfig();
  if (!cfg) return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 501 });
  try {
    const code = await createLinkCode();
    return NextResponse.json({ code, url: `https://t.me/${cfg.username}?start=${code}` });
  } catch (err) {
    return errorResponse(err);
  }
}
