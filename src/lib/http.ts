import { NextResponse } from "next/server";

const buckets = new Map<string, number[]>();

/** Tiny in-memory sliding-window limiter. Replace with a shared store when deploying multi-instance. */
export function rateLimit(req: Request, key: string, max: number, windowMs = 60_000): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const id = `${key}:${ip}`;
  const now = Date.now();
  const hits = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  hits.push(now);
  buckets.set(id, hits);
  return null;
}

export function errorResponse(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}
