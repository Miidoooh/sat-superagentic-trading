"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentChat from "@/components/AgentChat";
import ChartPanel from "@/components/ChartPanel";
import Logo from "@/components/Logo";
import TokenList from "@/components/TokenList";
import type { ChainInfo } from "@/components/TradeCard";
import { fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { Candle, ChartAnalysis, ProviderCapabilities, Timeframe, TokenMarket } from "@/lib/types";

interface MarketResponse {
  source: string;
  timeframes: Timeframe[];
  capabilities: ProviderCapabilities;
  chain: ChainInfo;
  execution: { enabled: boolean; maxTradeNative: number; maxSlippageBps: number };
  agentEnabled: boolean;
  tokens: TokenMarket[];
}

interface CandleResponse {
  candles: Candle[];
  analysis: ChartAnalysis | null;
}

const ALL_TF: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

export default function Terminal() {
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [chart, setChart] = useState<CandleResponse | null>(null);
  const [chartError, setChartError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    fetch("/api/market")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || "error" in d) throw new Error(d.error ?? "Failed to load markets");
        return d as MarketResponse;
      })
      .then((d) => {
        setMarket(d);
        setTimeframe(d.timeframes.includes("4h") ? "4h" : d.timeframes[0]);
        setSelected(d.tokens.find((t) => t.hasPriceHistory)?.token.symbol ?? d.tokens[0]?.token.symbol ?? "");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const loadChart = useCallback(async (token: string, tf: Timeframe) => {
    if (!token) return;
    setChartLoading(true);
    try {
      const r = await fetch(`/api/candles?token=${encodeURIComponent(token)}&timeframe=${tf}`);
      const d = await r.json();
      if (!r.ok || "error" in d) throw new Error(d.error ?? "Failed to load chart");
      setChart(d as CandleResponse);
      setChartError("");
    } catch (e) {
      setChart(null);
      setChartError((e as Error).message);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChart(selected, timeframe);
  }, [selected, timeframe, loadChart]);

  const current = useMemo(
    () => market?.tokens.find((t) => t.token.symbol === selected) ?? null,
    [market, selected],
  );
  const analysis = chart?.analysis ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <Logo />
          SUPERAGENTIC TRADING
        </Link>
        <span className="pill">{market?.chain.name ?? "Robinhood Chain"}</span>
        {market && (
          <span className={`pill ${market.source === "robinhood-chain" ? "ok" : "warn"}`}>
            <span className={market.source === "robinhood-chain" ? "dot live" : "dot"} />
            {market.source === "robinhood-chain" ? "live mainnet" : market.source}
          </span>
        )}
        <div className="spacer" />
        {market && !market.capabilities.volume24h && (
          <span className="pill">volume: per-token only</span>
        )}
        <span className={`pill ${market?.execution.enabled ? "ok" : ""}`}>
          {market?.execution.enabled
            ? `trading on · max ${market.execution.maxTradeNative} ${market.chain.symbol}`
            : "trading off"}
        </span>
        {market && (
          <a className="pill" href={market.chain.explorer} target="_blank" rel="noreferrer noopener">
            explorer ↗
          </a>
        )}
      </header>

      {loadError && (
        <div className="banner error">
          <span>Could not load Robinhood Chain data: {loadError}</span>
        </div>
      )}

      <div className="grid">
        <section className="col markets">
          <div className="col-head">
            Markets
            <div className="spacer" />
            {market && <span className="dim">{market.tokens.length}</span>}
          </div>
          <TokenList tokens={market?.tokens ?? []} selected={selected} onSelect={setSelected} />
        </section>

        <section className="col">
          <div className="toolbar">
            <div className="title">
              {current?.token.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="logo" src={current.token.logoUrl} alt="" />
              )}
              <span className="sym">{current?.token.symbol ?? selected ?? "—"}</span>
              <span className="muted">{current?.token.name}</span>
            </div>
            <div className="spacer" />
            <div className="tfs">
              {ALL_TF.map((tf) => (
                <button
                  key={tf}
                  className={`tf ${tf === timeframe ? "active" : ""}`}
                  disabled={!!market && !market.timeframes.includes(tf)}
                  title={
                    market && !market.timeframes.includes(tf)
                      ? "Oracle price history is not dense enough for this timeframe"
                      : undefined
                  }
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {current && (
            <div className="quote-strip">
              <div className="quote">
                <span className="k">Pool price</span>
                <span className="v mono">${fmtPrice(current.priceUsd)}</span>
              </div>
              <div className="quote">
                <span className="k">Oracle</span>
                <span className="v mono">
                  {current.oraclePriceUsd === null ? "—" : `$${fmtPrice(current.oraclePriceUsd)}`}
                  {current.oracleStale && <span className="pill warn" style={{ marginLeft: 6 }}>stale</span>}
                </span>
              </div>
              <div className="quote">
                <span className="k">Basis</span>
                <span className={`v mono ${(current.oracleBasisPct ?? 0) >= 0 ? "up" : "down"}`}>
                  {fmtPct(current.oracleBasisPct)}
                </span>
              </div>
              <div className="quote">
                <span className="k">24h</span>
                <span className={`v mono ${(current.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}`}>
                  {fmtPct(current.priceChange24hPct)}
                </span>
              </div>
              <div className="quote">
                <span className="k">Liquidity</span>
                <span className="v mono">{fmtUsd(current.liquidityUsd, { compact: true })}</span>
              </div>
              <div className="quote">
                <span className="k">Pool</span>
                <span className="v">
                  {current.quoteSymbol} · {(current.feeTier / 10_000).toFixed(2)}%
                </span>
              </div>
              <div className="quote">
                <span className="k">Oracle age</span>
                <span className="v">{fmtAge(current.oracleUpdatedAt)}</span>
              </div>
            </div>
          )}

          {chartError && <div className="banner">{chartError}</div>}

          {chart && chart.candles.length > 0 ? (
            <ChartPanel candles={chart.candles} analysis={analysis} />
          ) : (
            <div className="chart-empty">
              {chartLoading ? "Loading price history…" : chartError ? "No chart available" : "Select a token"}
            </div>
          )}

          {analysis && (
            <div className="insights">
              <div className="summary">{analysis.summary}</div>
              <div className="ind-grid">
                <div className="ind">
                  <div className="k">Trend</div>
                  <div className={`v ${analysis.trend.direction === "bullish" ? "up" : analysis.trend.direction === "bearish" ? "down" : ""}`}>
                    {analysis.trend.direction}
                  </div>
                </div>
                <div className="ind">
                  <div className="k">RSI 14</div>
                  <div className="v mono">{fmtNum(analysis.indicators.rsi14)}</div>
                </div>
                <div className="ind">
                  <div className="k">SMA 20</div>
                  <div className="v mono">{fmtPrice(analysis.indicators.sma20)}</div>
                </div>
                <div className="ind">
                  <div className="k">SMA 50</div>
                  <div className="v mono">{fmtPrice(analysis.indicators.sma50)}</div>
                </div>
                <div className="ind">
                  <div className="k">ATR 14</div>
                  <div className="v mono">{fmtPrice(analysis.indicators.atr14)}</div>
                </div>
                <div className="ind">
                  <div className="k">Candles</div>
                  <div className="v mono">{analysis.candles}</div>
                </div>
              </div>
              <div className="chips">
                {analysis.patterns.length === 0 && <span className="dim">No recent pattern signals</span>}
                {analysis.patterns.map((p, i) => (
                  <span key={i} className={`chip ${p.direction}`} title={p.description}>
                    {p.name}
                    <b className="mono">{p.confidence}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="col">
          <div className="col-head">
            Agent
            <div className="spacer" />
            {market && !market.agentEnabled && <span className="pill warn">offline</span>}
          </div>
          <AgentChat
            enabled={market?.agentEnabled ?? false}
            chain={market?.chain ?? null}
            executionEnabled={market?.execution.enabled ?? false}
            onSelectToken={setSelected}
          />
        </section>
      </div>
    </div>
  );
}
