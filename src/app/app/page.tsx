"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentChat from "@/components/AgentChat";
import AlertsCenter from "@/components/AlertsCenter";
import ChartPanel from "@/components/ChartPanel";
import Logo from "@/components/Logo";
import PonsTokenPanel from "@/components/PonsTokenPanel";
import PonsTrenches from "@/components/PonsTrenches";
import TokenList from "@/components/TokenList";
import type { ChainInfo } from "@/components/TradeCard";
import WalletTracker from "@/components/WalletTracker";
import WhaleRadar from "@/components/WhaleRadar";
import { ponsTokenUrl, ROBINHOOD_MAINNET } from "@/lib/chain/constants";
import { fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { Candle, ChartAnalysis, ProviderCapabilities, Timeframe, TokenMarket } from "@/lib/types";
import "../live.css";
import "../smart.css";

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
/** Pons curves chart from their own trades, so they get finer timeframes than oracle history. */
const PONS_TF: Timeframe[] = ["5m", "15m", "1h", "4h"];
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

type View = "terminal" | "radar" | "trenches" | "wallets";
const VIEWS: { id: View; label: string; isNew?: boolean }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "radar", label: "Whale Radar" },
  { id: "trenches", label: "Pons Trenches" },
  { id: "wallets", label: "Smart Money", isNew: true },
];

export default function Terminal() {
  const [view, setView] = useState<View>("terminal");
  const [wallet, setWallet] = useState("");
  const [market, setMarket] = useState<MarketResponse | null>(null);
  /** Pons launches opened from a live view that are not in the market list. */
  const [extraTokens, setExtraTokens] = useState<TokenMarket[]>([]);
  const [selected, setSelected] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [chart, setChart] = useState<CandleResponse | null>(null);
  const [chartError, setChartError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (v === "radar" || v === "trenches" || v === "wallets") setView(v);
    const w = params.get("wallet");
    if (w && isAddress(w)) setWallet(w);
  }, []);

  const switchView = useCallback((next: View, walletParam?: string) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "terminal") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (walletParam) url.searchParams.set("wallet", walletParam);
    else if (next !== "wallets") url.searchParams.delete("wallet");
    window.history.replaceState(null, "", url);
  }, []);

  const openWallet = useCallback(
    (address: string) => {
      if (!isAddress(address)) return;
      setWallet(address);
      switchView("wallets", address);
    },
    [switchView],
  );

  const allTokens = useMemo(() => [...(market?.tokens ?? []), ...extraTokens], [market, extraTokens]);

  /** Open a token from a live view in the terminal. Unlisted Pons launches are looked up on chain first. */
  const openToken = useCallback(
    async (address: string, fallbackUrl?: string) => {
      const listed = allTokens.find((t) => t.token.address.toLowerCase() === address.toLowerCase());
      if (listed) {
        setSelected(listed.token.address);
        switchView("terminal");
        return;
      }
      try {
        const r = await fetch(`/api/pons/token?address=${address}`);
        const d = await r.json();
        if (!r.ok || "error" in d) throw new Error(d.error);
        const m = d.market as TokenMarket;
        setExtraTokens((prev) => [...prev.filter((t) => t.token.address !== m.token.address), m]);
        setSelected(m.token.address);
        switchView("terminal");
      } catch {
        if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    },
    [allTokens, switchView],
  );

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
        const stocks = d.tokens.filter((t) => t.venue !== "pons");
        setSelected(
          stocks.find((t) => t.hasPriceHistory)?.token.address ??
            stocks[0]?.token.address ??
            d.tokens[0]?.token.address ??
            "",
        );
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

  const current = useMemo(() => allTokens.find((t) => t.token.address === selected) ?? null, [allTokens, selected]);
  const isPons = current?.venue === "pons";
  const timeframes = isPons ? PONS_TF : (market?.timeframes ?? []);

  useEffect(() => {
    if (!selected || !current) return;
    if (!timeframes.includes(timeframe)) {
      setTimeframe(isPons ? "15m" : timeframes.includes("4h") ? "4h" : timeframes[0]);
      return;
    }
    void loadChart(selected, timeframe);
    // Curve charts move with every trade; stock oracle history does not.
    if (!isPons) return;
    const t = setInterval(() => void loadChart(selected, timeframe), 20_000);
    return () => clearInterval(t);
  }, [selected, timeframe, loadChart, current, isPons, timeframes]);
  const analysis = chart?.analysis ?? null;
  const explorer = market?.chain.explorer ?? ROBINHOOD_MAINNET.explorerUrl;

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <Logo />
          <span className="brand-name">SAT</span>
        </Link>
        <span
          className={`pill chain-pill ${!market || market.source === "robinhood-chain" ? "ok" : "warn"}`}
          title={market && market.source !== "robinhood-chain" ? `Data source: ${market.source}` : "Live Robinhood Chain mainnet data"}
        >
          <span className={!market || market.source === "robinhood-chain" ? "dot live" : "dot"} />
          {market?.chain.name ?? "Robinhood Chain"}
        </span>
        <div className="tfs view-tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} className={`tf ${view === v.id ? "active" : ""}`} onClick={() => switchView(v.id)}>
              {v.label}
              {v.isNew && <span className="new-tag">NEW</span>}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <AlertsCenter onOpenToken={(token, url) => void openToken(token, url)} onOpenWallet={openWallet} />
        {market?.execution.enabled ? (
          <span className="pill ok">
            trading on · max {market.execution.maxTradeNative} {market.chain.symbol}
          </span>
        ) : (
          <span className="pill quiet" title="Trade execution is disabled; the agent only proposes trades">
            read-only
          </span>
        )}
        {market && (
          <a className="pill quiet" href={market.chain.explorer} target="_blank" rel="noreferrer noopener" title="Open the block explorer">
            explorer ↗
          </a>
        )}
      </header>

      {loadError && (
        <div className="banner error">
          <span>Could not load Robinhood Chain data: {loadError}</span>
        </div>
      )}

      {view === "radar" && (
        <WhaleRadar
          explorer={explorer}
          onOpenToken={(token, venue) => void openToken(token, venue === "pons" ? ponsTokenUrl(token) : undefined)}
          onWallet={openWallet}
        />
      )}
      {view === "trenches" && <PonsTrenches explorer={explorer} onOpenToken={(token, url) => void openToken(token, url)} />}
      {view === "wallets" && (
        <WalletTracker
          explorer={explorer}
          wallet={wallet}
          onWallet={openWallet}
          onOpenToken={(token, venue) => void openToken(token, venue === "pons" ? ponsTokenUrl(token) : undefined)}
        />
      )}

      <div className="grid" hidden={view !== "terminal"}>
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
                  disabled={!!market && !timeframes.includes(tf)}
                  title={
                    market && !timeframes.includes(tf)
                      ? isPons
                        ? "Curve launches are too young for daily candles"
                        : "Oracle price history is not dense enough for this timeframe"
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
            <div className={`chart-empty ${chartLoading ? "is-loading" : ""}`}>
              {chartLoading
                ? isPons
                  ? "Building candles from curve trades…"
                  : "Loading price history…"
                : chartError
                  ? "No chart available"
                  : "Select a token"}
            </div>
          )}

          {isPons && current && <PonsTokenPanel key={current.token.address} token={current.token.address} explorer={explorer} onWallet={openWallet} />}

          {analysis && !isPons && (
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
          </div>
          <AgentChat
            enabled={market?.agentEnabled ?? false}
            chain={market?.chain ?? null}
            executionEnabled={market?.execution.enabled ?? false}
            onSelectToken={(symbol) => {
              const matches = market?.tokens.filter((t) => t.token.symbol.toLowerCase() === symbol.toLowerCase()) ?? [];
              const pick = matches.find((t) => t.venue !== "pons") ?? matches[0];
              if (pick) setSelected(pick.token.address);
            }}
          />
        </section>
      </div>
    </div>
  );
}
