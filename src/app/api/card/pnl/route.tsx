import { ImageResponse } from "next/og";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { getPortfolio } from "@/lib/portfolio/portfolio";
import { tierOf } from "@/lib/sat/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

const isAddress = (s: string | null): s is `0x${string}` => !!s && /^0x[0-9a-fA-F]{40}$/.test(s);
const money = (n: number) => {
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e4 ? `${(abs / 1e3).toFixed(1)}K` : abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `$${s}`;
};

/**
 * A PnL card for one position, rendered from the wallet's on-chain history.
 * Numbers never come from the URL, so a card cannot be faked by editing a link.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const address = params.get("address");
  const token = params.get("token");
  if (!isAddress(address) || !isAddress(token)) return new Response("address and token are required", { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return new Response("Live chain data needed", { status: 501 });

  const [portfolio, tier] = await Promise.all([getPortfolio(provider, address, [token]).catch(() => null), tierOf(address)]);
  const h = portfolio?.holdings.find((x) => x.token.toLowerCase() === token.toLowerCase());
  const pnl = h ? (h.unrealizedUsd ?? 0) + h.realizedUsd : null;
  const pct = h && pnl !== null && h.costUsd > 0 ? (pnl / h.costUsd) * 100 : null;
  const up = (pnl ?? 0) >= 0;
  const accent = up ? "#00d40a" : "#ff4d2e";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "radial-gradient(1200px 600px at 85% 0%, rgba(204,255,0,0.16), transparent 60%), #07090c",
          color: "#eaf0f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 52, height: 52, borderRadius: 14, background: "#ccff00", color: "#000", fontSize: 26, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>
              S
            </div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>SAT</div>
            <div style={{ display: "flex", fontSize: 22, color: "#8593a4", marginLeft: 8 }}>Strategic Agentic Trading</div>
          </div>
          {tier.id !== "free" && (
            <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, border: "2px solid rgba(204,255,0,0.5)", color: "#ccff00", fontSize: 22, fontWeight: 700 }}>
              {tier.id === "whale" ? "WHALE" : "HOLDER"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 40, color: "#8593a4" }}>{h ? `${h.symbol} · ${h.venue === "pons" ? "Pons" : "Stock Token"}` : "Position not found"}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 28 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 800, letterSpacing: -6, color: accent }}>
              {pnl === null ? "—" : `${up ? "+" : "−"}${money(pnl)}`}
            </div>
            {pct !== null && <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: accent }}>{`${up ? "+" : ""}${pct.toFixed(1)}%`}</div>}
          </div>
          {h && (
            <div style={{ display: "flex", gap: 40, fontSize: 28, color: "#8593a4" }}>
              <div style={{ display: "flex" }}>{`Value ${money(h.valueUsd)}`}</div>
              {h.avgCostUsd !== null && <div style={{ display: "flex" }}>{`Avg cost $${h.avgCostUsd.toPrecision(4)}`}</div>}
              <div style={{ display: "flex" }}>{`Now $${h.priceUsd.toPrecision(4)}`}</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: "#5d6a7a" }}>
          <div style={{ display: "flex" }}>{`${address.slice(0, 6)}…${address.slice(-4)} · verified on-chain · Robinhood Chain`}</div>
          <div style={{ display: "flex", color: "#ccff00", fontWeight: 700 }}>sathood.xyz</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
