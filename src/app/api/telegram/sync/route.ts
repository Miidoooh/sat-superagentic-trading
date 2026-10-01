import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { removeSubscription, saveSubscription, SubscriptionSchema, telegramConfig } from "@/lib/telegram/telegram";

export const runtime = "nodejs";

const TOKEN = z.string().regex(/^[0-9a-f]{48}$/, "Bad token");
const PutBody = SubscriptionSchema.extend({ token: TOKEN });
const DeleteBody = z.object({ token: TOKEN });

/** Store this browser's alert settings, follows and rules against its Telegram chat. */
export async function PUT(req: Request) {
  const limited = rateLimit(req, "tg-sync", 60);
  if (limited) return limited;
  if (!telegramConfig()) return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 501 });
  try {
    const { token, ...patch } = PutBody.parse(await req.json());
    const sub = await saveSubscription(token, patch);
    return NextResponse.json({ ok: true, username: sub.username ?? null, rules: sub.rules.length });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    return errorResponse(err, 404);
  }
}

export async function DELETE(req: Request) {
  const limited = rateLimit(req, "tg-sync", 60);
  if (limited) return limited;
  try {
    const { token } = DeleteBody.parse(await req.json());
    await removeSubscription(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    return errorResponse(err);
  }
}
