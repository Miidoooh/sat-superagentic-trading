import { NextResponse } from "next/server";
import { z } from "zod";
import { getLlm, isAuthError, jsonCompletion } from "@/lib/agent/llm";
import { describePlan, planFor, STYLE_PRESETS, StrategySchema } from "@/lib/agent/strategy";
import { errorResponse, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(5).max(600) });

const SYSTEM = `You turn a memecoin trader's description of their style into a JSON strategy for SAT, an agent on Robinhood Chain.
Tokens launch on Pons bonding curves (fixed 1B supply) and graduate to Uniswap v4 pools at 100% bonded.
The strategy only finds tokens and says when to buy and sell. The trader signs every trade.

Reply with {"basedOn": "...", "strategy": {...}, "summary": "..."} and nothing else.
basedOn: the closest preset: "sniper" (fresh launches, tiny mcap), "momentum" (rising volume and buyers), "graduation" (curves close to 100%), "whale" (big net buying).
strategy fields, all optional, numbers only:
- name (short, max 40 chars)
- stage: "curve" | "graduated" | "any"
- mcapMin, mcapMax (USD market cap)
- maxAgeMin (minutes since launch)
- minProgressPct, maxProgressPct (bonding curve progress 0-100)
- minVol30mUsd, minNet30mUsd (net buying in the last 30 minutes), minBuyers30m (wallets trading in 30 minutes)
- requireSocials (true if they want an X/Telegram/website)
- minSafety (0-100 safety score; "safe", "no rugs" means 65)
- buyUsd (USD per buy)
- takeProfits: [{"atX": 2, "sellPct": 50}] where atX is the market cap multiple and sellPct the share of the bag; sellPct must sum to 100 or less
- stopLossPct ("-30%" or "stop at 30%" means 30), trailingPct, maxHoldHours
Read "10k" as 10000 and "1.5m" as 1500000. Leave out anything they did not say; SAT fills it from the preset.
summary: one plain sentence describing the style back to them.`;

const Draft = z.object({
  basedOn: z.enum(["sniper", "momentum", "graduation", "whale"]).catch("momentum"),
  strategy: z.record(z.string(), z.unknown()).default({}),
  summary: z.string().max(400).optional(),
});

/** Turn a description of how someone trades into an explicit, editable strategy. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "agent-style", 15);
  if (limited) return limited;
  const llm = getLlm("low");
  if (!llm) return NextResponse.json({ error: "Describing a style needs the agent (MOONSHOT_API_KEY or OPENAI_API_KEY)." }, { status: 501 });
  try {
    const { text } = Body.parse(await req.json());
    const draft = Draft.parse(await jsonCompletion(llm, SYSTEM, text));
    const base = STYLE_PRESETS[draft.basedOn];
    const merged = StrategySchema.safeParse({ ...base, ...draft.strategy, style: "custom", name: (draft.strategy.name as string | undefined) || "My style" });
    if (!merged.success) {
      return NextResponse.json({ error: `Could not use part of that: ${merged.error.issues[0]?.path.join(".")} ${merged.error.issues[0]?.message}` }, { status: 400 });
    }
    const strategy = merged.data;
    const sold = strategy.takeProfits.reduce((s, t) => s + t.sellPct, 0);
    if (sold > 100) strategy.takeProfits = strategy.takeProfits.map((t) => ({ ...t, sellPct: Math.round((t.sellPct / sold) * 100) }));
    return NextResponse.json({
      strategy,
      basedOn: draft.basedOn,
      summary: draft.summary ?? "",
      example: describePlan(planFor(strategy, Math.max(strategy.mcapMin, 10_000), 0.00001)),
      model: llm.provider,
    });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: "The agent is unavailable right now." }, { status: 503 });
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      return NextResponse.json({ error: "Could not turn that into a style. Try naming a market cap range, when you take profit and where you cut losses." }, { status: 400 });
    }
    return errorResponse(err, 502);
  }
}
