import OpenAI from "openai";
import { getConfig, type SatConfig } from "../config";

export interface Llm {
  client: OpenAI;
  model: string;
  provider: "kimi" | "openai";
  /** Provider-specific request fields. Kimi K3 fixes temperature and takes a reasoning effort instead. */
  params: Record<string, unknown>;
}

/** The model the agent thinks with: Kimi when its key is set, otherwise OpenAI, otherwise none. */
export function getLlm(effort: "low" | "high" = "high", cfg: SatConfig = getConfig()): Llm | null {
  if (cfg.MOONSHOT_API_KEY) {
    return {
      client: new OpenAI({ apiKey: cfg.MOONSHOT_API_KEY, baseURL: cfg.MOONSHOT_BASE_URL }),
      model: cfg.MOONSHOT_MODEL,
      provider: "kimi",
      params: { reasoning_effort: effort },
    };
  }
  if (cfg.OPENAI_API_KEY) {
    return { client: new OpenAI({ apiKey: cfg.OPENAI_API_KEY }), model: cfg.OPENAI_MODEL, provider: "openai", params: { temperature: 0.2 } };
  }
  return null;
}

export const agentAvailable = (cfg: SatConfig = getConfig()) => Boolean(cfg.MOONSHOT_API_KEY || cfg.OPENAI_API_KEY);

/** One system + user turn that must come back as a JSON object. */
export async function jsonCompletion(llm: Llm, system: string, user: string): Promise<unknown> {
  const completion = await llm.client.chat.completions.create({
    model: llm.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...llm.params,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const text = completion.choices[0]?.message?.content ?? "{}";
  // Some models wrap JSON in a code fence even in JSON mode.
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

export const isAuthError = (err: unknown) => err instanceof OpenAI.APIError && (err.status === 401 || err.status === 403);
