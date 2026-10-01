import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleUpdate, telegramConfig } from "@/lib/telegram/telegram";

export const runtime = "nodejs";

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Telegram bot webhook. Registered with scripts/telegram-webhook.ts. */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg?.webhookSecret) return NextResponse.json({ error: "Webhook not configured" }, { status: 404 });
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), cfg.webhookSecret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await handleUpdate(cfg, await req.json());
  } catch {
    // Always 200 so Telegram does not retry a message we cannot handle.
  }
  return NextResponse.json({ ok: true });
}
