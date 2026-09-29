import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatRequestSchema, runAgent } from "@/lib/agent/agent";
import { errorResponse, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = rateLimit(req, "agent", 10);
  if (limited) return limited;
  try {
    const body = ChatRequestSchema.parse(await req.json());
    return NextResponse.json(await runAgent(body));
  } catch (err) {
    if (err instanceof z.ZodError) return errorResponse(new Error("Invalid request body"), 400);
    return errorResponse(err);
  }
}
