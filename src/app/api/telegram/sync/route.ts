import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { tierOf } from "@/lib/sat/gate";
import { ProofSchema, verifyHolderProof } from "@/lib/sat/verify";
import { getSubscription, removeSubscription, saveSubscription, SubscriptionSchema, telegramConfig } from "@/lib/telegram/telegram";

export const runtime = "nodejs";

const TOKEN = z.string().regex(/^[0-9a-f]{48}$/, "Bad token");
const PutBody = SubscriptionSchema.extend({
  token: TOKEN,
  /** Prove a wallet once to unlock its tier. */
  proof: ProofSchema.optional(),
  /** Drop the proven wallet. */
  forgetWallet: z.boolean().optional(),
});
const DeleteBody = z.object({ token: TOKEN });

/** Store this browser's alert settings, follows and rules against its Telegram chat. */
export async function PUT(req: Request) {
  const limited = rateLimit(req, "tg-sync", 60);
  if (limited) return limited;
  if (!telegramConfig()) return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 501 });
  try {
    const { token, proof, forgetWallet, ...patch } = PutBody.parse(await req.json());
    const current = await getSubscription(token);
    if (!current) return NextResponse.json({ error: "This Telegram link is no longer active." }, { status: 404 });
    const wallet = forgetWallet ? null : proof ? await verifyHolderProof(proof) : current.wallet;
    const tier = await tierOf(wallet);
    const sub = await saveSubscription(token, { ...patch, rules: patch.rules.slice(0, tier.maxRules), wallet });
    return NextResponse.json({
      ok: true,
      username: sub.username ?? null,
      wallet: sub.wallet ?? null,
      tier: tier.id,
      rules: sub.rules.length,
      droppedRules: Math.max(0, patch.rules.length - sub.rules.length),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    return errorResponse(err, 400);
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
