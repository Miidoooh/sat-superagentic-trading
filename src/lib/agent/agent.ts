import OpenAI from "openai";
import { z } from "zod";
import { getConfig } from "../config";
import { getProvider } from "../data/provider";
import { runTool, toolDefinitions, type Artifact } from "./tools";

export const ChatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .min(1)
    .max(40),
});

export interface AgentResponse {
  reply: string;
  artifacts: Artifact[];
  toolCalls: { name: string; args: string; ok: boolean }[];
  source: string;
}

const MAX_STEPS = 8;

function systemPrompt(source: string): string {
  return `You are SAT (Superagentic Trading), an analyst agent for Robinhood Chain, an Ethereum L2 for tokenized assets.
You run deep chart analysis, surface chart patterns, scan tokens against the user's exact criteria, read on-chain activity, and propose trades.

Rules:
- Use tools for every factual claim about prices, indicators, patterns or on-chain data. Never invent numbers.
- Current market data source: "${source}". ${source === "synthetic" ? "This is SYNTHETIC development data, not real markets. Say so clearly in every answer that cites market data." : "Data comes from a Robinhood Chain indexer."}
- For live money flow, whale buys and sells, or "what is the market doing right now", call whale_radar. For new launches, memecoins or what is about to graduate on Pons, call pons_trenches. For top traders, smart money or one wallet's activity, call smart_money. Pons tokens have real candles from their curve trades, so analyze_chart works on them too (5m to 4h).
- To answer a screening request, translate it into scan_tokens filters. Explain which filters you used and any you could not express.
- You can only PROPOSE trades with propose_trade. You cannot sign or execute; the user approves in their own wallet. If guardrails reject a trade, report the reasons; do not try to work around them.
- Be concise. Lead with the conclusion, then key evidence (levels, indicators, patterns). Use plain text with short lists.
- Patterns and indicators are heuristics, not predictions. This is not financial advice; note risk (liquidity, volatility) briefly when proposing trades.`;
}

export async function runAgent(input: z.infer<typeof ChatRequestSchema>): Promise<AgentResponse> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY });
  const source = getProvider().source;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(source) },
    ...input.messages,
  ];
  const artifacts: Artifact[] = [];
  const toolCalls: AgentResponse["toolCalls"] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await client.chat.completions.create({
      model: cfg.OPENAI_MODEL,
      messages,
      tools: toolDefinitions,
      temperature: 0.2,
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { reply: msg.content ?? "", artifacts, toolCalls, source };
    }

    const outcomes = await Promise.all(
      msg.tool_calls.map(async (call) => {
        if (call.type !== "function") return { call, outcome: { result: { error: "Unsupported tool call type" } } };
        return { call, outcome: await runTool(call.function.name, call.function.arguments) };
      }),
    );
    for (const { call, outcome } of outcomes) {
      if (call.type !== "function") continue;
      const failed = typeof outcome.result === "object" && outcome.result !== null && "error" in outcome.result;
      toolCalls.push({ name: call.function.name, args: call.function.arguments, ok: !failed });
      if (outcome.artifact) artifacts.push(outcome.artifact);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome.result).slice(0, 24_000) });
    }
  }
  return {
    reply: "I hit my step limit before finishing. Try a narrower request.",
    artifacts,
    toolCalls,
    source,
  };
}
