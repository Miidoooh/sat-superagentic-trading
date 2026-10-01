import { ImageResponse } from "next/og";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { getFlowReport } from "@/lib/report/flow";

export const runtime = "nodejs";
export const maxDuration = 120;

const money = (n: number) => {
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(1)}K` : abs.toFixed(0);
  return `${n < 0 ? "−" : ""}$${s}`;
};

/** Image card for the daily Robinhood Chain flow report. */
export async function GET() {
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return new Response("Live chain data needed", { status: 501 });
  const r = await getFlowReport(provider);
  const day = new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  const box = { display: "flex", flexDirection: "column" as const, gap: 10, padding: "22px 26px", borderRadius: 20, border: "1px solid #1e2731", background: "rgba(15,20,26,0.85)" };
  const label = { display: "flex", fontSize: 18, letterSpacing: 2, color: "#8593a4" };
  const row = { display: "flex", justifyContent: "space-between", fontSize: 26 };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          padding: "48px 56px",
          background: "radial-gradient(1000px 500px at 90% -10%, rgba(204,255,0,0.16), transparent 60%), #07090c",
          color: "#eaf0f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", width: 46, height: 46, borderRadius: 12, background: "#ccff00", color: "#000", fontSize: 24, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>S</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800 }}>Robinhood Chain flow report</div>
              <div style={{ display: "flex", fontSize: 20, color: "#8593a4" }}>{`Last 24 hours · ${day} · by SAT`}</div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#ccff00", fontWeight: 700 }}>sathood.xyz/report</div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {[
            ["VOLUME", money(r.totals.volumeUsd)],
            ["TRADES", r.totals.trades.toLocaleString("en-US")],
            ["WALLETS", r.totals.wallets.toLocaleString("en-US")],
            ["PONS LAUNCHES", String(r.pons.launches)],
          ].map(([k, v]) => (
            <div key={k} style={{ ...box, flex: 1, padding: "18px 22px" }}>
              <div style={label}>{k}</div>
              <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, flex: 1 }}>
          <div style={{ ...box, flex: 1 }}>
            <div style={label}>MONEY FLOWING IN</div>
            {r.inflows.slice(0, 4).map((f) => (
              <div key={f.token} style={row}>
                <div style={{ display: "flex" }}>{f.symbol}</div>
                <div style={{ display: "flex", color: "#00d40a", fontWeight: 700 }}>{`+${money(f.netUsd)}`}</div>
              </div>
            ))}
          </div>
          <div style={{ ...box, flex: 1 }}>
            <div style={label}>BIGGEST BUYS</div>
            {r.biggestBuys.slice(0, 4).map((t) => (
              <div key={t.tx} style={row}>
                <div style={{ display: "flex" }}>{t.symbol}</div>
                <div style={{ display: "flex", color: "#ccff00", fontWeight: 700 }}>{money(t.usd)}</div>
              </div>
            ))}
          </div>
          <div style={{ ...box, flex: 1 }}>
            <div style={label}>MONEY FLOWING OUT</div>
            {r.outflows.slice(0, 4).map((f) => (
              <div key={f.token} style={row}>
                <div style={{ display: "flex" }}>{f.symbol}</div>
                <div style={{ display: "flex", color: "#ff4d2e", fontWeight: 700 }}>{money(f.netUsd)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}
