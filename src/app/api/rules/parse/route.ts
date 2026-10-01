import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { describeRule, RuleSchema, type Rule } from "@/lib/alerts/rules";
import { getConfig } from "@/lib/config";
import { getProvider } from "@/lib/data/provider";
import { errorResponse, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ text: z.string().trim().min(3).max(300) });

const SYSTEM = `You turn a trader's plain-language alert request into JSON rules for SAT, a Robinhood Chain market terminal.
Markets: Stock Tokens (tokenised equities like NVDA, TSLA on Uniswap v3) and Pons launches (new tokens on bonding curves that "graduate" at 100%).
Rules only send alerts. They never trade. If the user asks to buy or sell automatically, make the closest alert instead.

Reply with {"rules":[...]} and nothing else. Each rule has "kind" and only the fields it needs:
- kind "trade": a trade happens. Fields: side ("buy"|"sell"), minUsd (number), venue ("stock"|"pons"), tokenSymbol or token (0x address), wallet (0x address), netFlowUsd.
- kind "curve": a Pons curve gets close to graduating. Fields: progressPct (1-100, default 90), tokenSymbol or token, netFlowUsd.
- kind "launch": a new Pons launch. Fields: wallet (deployer) if they name one.
- kind "price": a token's price. Needs tokenSymbol or token, and priceAbove and/or priceBelow (USD) and/or change1hPct.
"netFlowUsd" means "whales/smart money are buying": net buying in the last 30 minutes. If they say whales are buying without a number, use 5000.
"whale" without a number means minUsd 10000. Use numbers, not strings. Keep tokenSymbol uppercase.`;

const Draft = z.object({
  rules: z
    .array(
      z
        .object({
          kind: z.enum(["trade", "curve", "launch", "price"]),
          tokenSymbol: z.string().max(32).optional(),
          token: z.string().optional(),
        })
        .passthrough(),
    )
    .min(1)
    .max(3),
});

/** Turn a sentence into one or more explicit alert rules. The browser stores them. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "rules-parse", 20);
  if (limited) return limited;
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) return NextResponse.json({ error: "Plain-language rules need the agent (OPENAI_API_KEY)." }, { status: 501 });
  try {
    const { text } = Body.parse(await req.json());
    const client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: cfg.OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    });
    const draft = Draft.parse(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));

    const provider = getProvider();
    const rules: Rule[] = [];
    for (const [i, d] of draft.rules.entries()) {
      const candidate: Record<string, unknown> = { ...d, id: `r${Date.now().toString(36)}${i}`, text, enabled: true };
      const query = typeof d.token === "string" && /^0x[0-9a-fA-F]{40}$/.test(d.token) ? d.token : d.tokenSymbol;
      if (query) {
        const market = await provider.findToken(query);
        if (!market) return NextResponse.json({ error: `Could not find a token called ${query} on Robinhood Chain.` }, { status: 400 });
        candidate.token = market.token.address;
        candidate.tokenSymbol = market.token.symbol;
      } else {
        delete candidate.token;
      }
      const parsed = RuleSchema.safeParse(candidate);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Could not understand that rule" }, { status: 400 });
      rules.push(parsed.data);
    }
    return NextResponse.json({ rules: rules.map((r) => ({ ...r, summary: describeRule(r) })) });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ error: "The agent is unavailable right now, so rules cannot be created." }, { status: 503 });
    }
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      return NextResponse.json({ error: "Could not turn that into a rule. Try naming a token, a size or a percentage." }, { status: 400 });
    }
    return errorResponse(err, 502);
  }
}
