import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { tierOf } from "@/lib/sat/gate";
import { workerAlive } from "@/lib/store/snapshots";
import { formatAlert, getSubscription, markSent, sendMessage, telegramConfig } from "@/lib/telegram/telegram";

export const runtime = "nodejs";

const MAX_PER_CALL = 5;

const Body = z.object({
  token: z.string().regex(/^[0-9a-f]{48}$/),
  alerts: z
    .array(
      z.object({
        id: z.string().max(200),
        kind: z.enum(["whale", "graduation", "follow", "launch", "rule"]),
        title: z.string().max(200),
        body: z.string().max(400),
        token: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
        wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
        url: z.string().url().max(300).optional(),
      }),
    )
    .max(20),
});

/**
 * Forward alerts that fired in an open browser tab to the linked chat. When a
 * background worker is running it already sends everything, so this skips.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "tg-notify", 30);
  if (limited) return limited;
  const cfg = telegramConfig();
  if (!cfg) return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 501 });
  try {
    const { token, alerts } = Body.parse(await req.json());
    if (await workerAlive()) return NextResponse.json({ sent: 0, skipped: "worker" });
    const sub = await getSubscription(token);
    if (!sub) return NextResponse.json({ error: "This Telegram link is no longer active." }, { status: 404 });
    // Free-tier alerts wait behind holders, which only the worker can schedule.
    if ((await tierOf(sub.wallet)).telegramDelayMs > 0) return NextResponse.json({ sent: 0, skipped: "tier" });
    let sent = 0;
    for (const alert of alerts.slice(0, MAX_PER_CALL)) {
      if (!(await markSent(token, alert.id))) continue;
      await sendMessage(cfg, sub.chatId, formatAlert(alert, cfg.siteUrl));
      sent++;
    }
    return NextResponse.json({ sent });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    return errorResponse(err, 502);
  }
}
