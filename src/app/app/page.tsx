"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentChat from "@/components/AgentChat";
import AgentView from "@/components/agent/AgentView";
import AlertsCenter from "@/components/AlertsCenter";
import ChartPanel from "@/components/ChartPanel";
import ConnectButton from "@/components/ConnectButton";
import ExploreView from "@/components/ExploreView";
import { Flash } from "@/components/Flash";
import Logo from "@/components/Logo";
import PonsTokenPanel from "@/components/PonsTokenPanel";
import PonsTrenches from "@/components/PonsTrenches";
import PortfolioView from "@/components/PortfolioView";
import HomeView from "@/components/brand/HomeView";
import MascotStatus from "@/components/brand/MascotStatus";
import CommandPalette from "@/components/CommandPalette";
import { IconAgent, IconBolt, IconBrain, IconDiamond, IconExplore, IconFlame, IconHome, IconPie, IconRadar, IconReport, IconSearch, IconTerminal, IconWallet } from "@/components/icons";
import { SatPill, SatProvider, useSat } from "@/components/sat";
import SatView from "@/components/SatView";
import { SocialLinks, TokenAvatar } from "@/components/TokenAvatar";
import TokenList from "@/components/TokenList";
import TradePanel from "@/components/TradePanel";
import { useWallet, WalletProvider, type ChainInfo } from "@/components/wallet";
import WalletTracker from "@/components/WalletTracker";
import WhaleRadar from "@/components/WhaleRadar";
import { ponsTokenUrl, ROBINHOOD_MAINNET } from "@/lib/chain/constants";
import { fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { Candle, ChartAnalysis, ProviderCapabilities, Timeframe, TokenMarket } from "@/lib/types";
import "../live.css";
import "../smart.css";
import "../v2.css";
import "../v3.css";
import "../agent.css";

interface MarketResponse {
  source: string;
  timeframes: Timeframe[];
  capabilities: ProviderCapabilities;
  chain: ChainInfo;
  execution: { enabled: boolean; maxTradeNative: number; maxSlippageBps: number; feeBps: number; feeRecipient: string | null };
  agentEnabled: boolean;
  satToken: string;
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

type View = "home" | "terminal" | "explore" | "agent" | "radar" | "trenches" | "wallets" | "portfolio" | "sat";
const VIEWS: { id: View; label: string; short: string; icon: React.ReactNode; hint: string; isNew?: boolean; mobile?: boolean }[] = [
  { id: "home", label: "Home", short: "Home", icon: <IconHome />, hint: "What matters right now, in plain words", mobile: true },
  { id: "terminal", label: "Terminal", short: "Trade", icon: <IconTerminal />, hint: "Charts, analysis, trade and the agent", mobile: true },
  { id: "explore", label: "Explore", short: "Explore", icon: <IconExplore />, hint: "Every live Pons launch, GMGN style", mobile: true },
  { id: "agent", label: "Your Agent", short: "Agent", icon: <IconAgent />, hint: "Picks for your style, with exact buy and sell levels", isNew: true, mobile: true },
  { id: "radar", label: "Whale Radar", short: "Whales", icon: <IconRadar />, hint: "Big buys, sells and money flow", mobile: true },
  { id: "trenches", label: "Pons Trenches", short: "Trenches", icon: <IconFlame />, hint: "New, hot and graduating curves" },
  { id: "wallets", label: "Smart Money", short: "Wallets", icon: <IconBrain />, hint: "Top traders and what they buy" },
  { id: "portfolio", label: "Portfolio", short: "Portfolio", icon: <IconPie />, hint: "Your holdings and PnL" },
  { id: "sat", label: "Hold SAT", short: "SAT", icon: <IconDiamond />, hint: "SAT token, tiers and perks" },
];
const MODE_KEY = "sat:mode";
const isView = (v: string | null): v is View => VIEWS.some((x) => x.id === v);

/** The command palette, inside the wallet provider so it can offer wallet actions. */
function PaletteHost(props: { tokens: TokenMarket[]; officialToken?: string; onOpenToken: (address: string) => void; onView: (id: string) => void }) {
  const wallet = useWallet();
  const { market: sat } = useSat();
  const actions = useMemo(
    () => [
      ...(wallet.address
        ? [{ label: "My portfolio", hint: "Holdings and PnL for the connected wallet", icon: <IconPie />, run: () => props.onView("portfolio") }]
        : [{ label: "Connect wallet", hint: "MetaMask, Rabby, Coinbase and more", icon: <IconWallet />, run: () => void wallet.connect() }]),
      { label: "Buy SAT", hint: "Open the SAT pool on Pons", icon: <IconDiamond />, run: () => window.open(sat?.buyUrl ?? "/app?view=sat", "_blank", "noopener") },
      { label: "Daily flow report", hint: "The last 24h on Robinhood Chain", icon: <IconReport />, run: () => window.open("/report", "_blank", "noopener") },
      { label: "Trending launches", hint: "Most traded Pons curves right now", icon: <IconBolt />, run: () => props.onView("explore") },
    ],
    [wallet, sat, props],
  );
  return (
    <CommandPalette
      tokens={props.tokens}
      officialToken={props.officialToken}
      views={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, hint: v.hint }))}
      onOpenToken={props.onOpenToken}
      onView={props.onView}
      actions={actions}
    />
  );
}

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
  /** A token to open once markets load, from a ?token= link (Telegram alerts use these). */
  const [linkedToken, setLinkedToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (isView(v)) setView(v);
    // Newcomers start in Simple mode; anyone who picked Pro keeps the terminal.
    else if (!params.get("token") && !params.get("wallet") && localStorage.getItem(MODE_KEY) !== "pro") setView("home");
    const w = params.get("wallet");
    if (w && isAddress(w)) setWallet(w);
    const t = params.get("token");
    if (t && isAddress(t)) setLinkedToken(t);
  }, []);

  const switchView = useCallback((next: View, walletParam?: string) => {
    setView(next);
    if (next === "home") localStorage.setItem(MODE_KEY, "simple");
    if (next === "terminal") localStorage.setItem(MODE_KEY, "pro");
    const url = new URL(window.location.href);
    if (next === "terminal") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (walletParam) url.searchParams.set("wallet", walletParam);
    else if (next !== "wallets") url.searchParams.delete("wallet");
    url.searchParams.delete("token");
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

  useEffect(() => {
    if (!market || !linkedToken) return;
    setLinkedToken(null);
    void openToken(linkedToken);
  }, [market, linkedToken, openToken]);

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
    <WalletProvider chain={market?.chain}>
    <SatProvider>
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <Logo size={30} />
          <span className="brand-name">SAT</span>
        </Link>
        <MascotStatus />
        <div className="mode-switch" role="group" aria-label="Simple or Pro mode">
          <button className={view === "home" ? "active" : ""} onClick={() => switchView("home")}>
            Simple
          </button>
          <button className={view !== "home" ? "active" : ""} onClick={() => switchView(view === "home" ? "terminal" : view)}>
            Pro
          </button>
        </div>
        <span
          className={`pill chain-pill ${!market || market.source === "robinhood-chain" ? "ok" : "warn"}`}
          title={market && market.source !== "robinhood-chain" ? `Data source: ${market.source}` : "Live Robinhood Chain mainnet data"}
        >
          <span className={!market || market.source === "robinhood-chain" ? "dot live" : "dot"} />
          {market?.chain.name ?? "Robinhood Chain"}
        </span>
        <nav className="tfs view-tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} className={`tf ${view === v.id ? "active" : ""}`} onClick={() => switchView(v.id)} title={v.hint}>
              {v.icon}
              <span className="view-label">{v.label}</span>
              {v.isNew && <span className="new-tag">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button className="cmdk-trigger" onClick={() => window.dispatchEvent(new Event("sat:palette"))} title="Search tokens, views and actions">
          <IconSearch />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <SatPill onOpen={() => switchView("sat")} />
        <AlertsCenter
          onOpenToken={(token, url) => void openToken(token, url)}
          onOpenWallet={openWallet}
          onOpenSat={() => switchView("sat")}
          agentEnabled={market?.agentEnabled ?? false}
        />
        <ConnectButton onPortfolio={() => switchView("portfolio")} />
      </header>

      <PaletteHost
        tokens={allTokens}
        officialToken={market?.satToken}
        onOpenToken={(address) => void openToken(address)}
        onView={(id) => isView(id) && switchView(id)}
      />
      <nav className="mobile-nav" aria-label="Views">
        {VIEWS.filter((v) => v.mobile).map((v) => (
          <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => switchView(v.id)}>
            {v.icon}
            <span>{v.short}</span>
          </button>
        ))}
      </nav>

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
      {view === "home" && (
        <HomeView onOpenToken={(token) => void openToken(token)} onExplore={() => switchView("explore")} onRadar={() => switchView("radar")} />
      )}
      {view === "explore" && <ExploreView onOpenToken={(token, url) => void openToken(token, url)} />}
      {view === "agent" && <AgentView agentEnabled={market?.agentEnabled ?? false} onOpenToken={(token) => void openToken(token)} />}
      {view === "portfolio" && <PortfolioView explorer={explorer} onOpenToken={(token) => void openToken(token)} />}
      {view === "sat" && <SatView explorer={explorer} feeWallet={market?.execution.feeRecipient ?? null} />}

      <div className="grid" hidden={view !== "terminal"}>
        <section className="col markets">
          <div className="col-head">
            Markets
            <div className="spacer" />
            {market && <span className="dim">{market.tokens.length}</span>}
          </div>
          <TokenList
            tokens={market?.tokens ?? []}
            selected={selected}
            onSelect={setSelected}
            onOpenAddress={(address) => void openToken(address)}
            onExplore={() => switchView("explore")}
            officialToken={market?.satToken}
          />
        </section>

        <section className="col">
          <div className="toolbar">
            <div className="title">
              {current && <TokenAvatar src={current.token.logoUrl} symbol={current.token.symbol} seed={current.token.address} size={28} />}
              <span className="sym">{current?.token.symbol ?? selected ?? "—"}</span>
              {current && market?.satToken && current.token.address.toLowerCase() === market.satToken.toLowerCase() && (
                <span className="official" title="The official SAT token">✓</span>
              )}
              <span className="muted">{current?.token.name}</span>
              {current && (
                <>
                  <Flash value={current.priceUsd} className="tb-price mono">
                    ${fmtPrice(current.priceUsd)}
                  </Flash>
                  {current.priceChange24hPct !== null && (
                    <span className={`tb-chg mono ${current.priceChange24hPct >= 0 ? "up" : "down"}`}>{fmtPct(current.priceChange24hPct)}</span>
                  )}
                </>
              )}
              {current?.graduated && <span className="pill quiet">graduated · Uniswap v4</span>}
              <SocialLinks socials={current?.profile?.socials} size={14} />
              {current && (
                <button
                  className="pill quiet share-link"
                  title="Copy a shareable link to this token"
                  onClick={(e) => {
                    const el = e.currentTarget;
                    void navigator.clipboard.writeText(`${window.location.origin}/token/${current.token.address}`).then(() => {
                      el.textContent = "link copied";
                      setTimeout(() => (el.textContent = "share"), 1500);
                    });
                  }}
                >
                  share
                </button>
              )}
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

        <section className="col side">
          <TradePanel
            market={current}
            executionEnabled={market?.execution.enabled ?? false}
            maxTradeNative={market?.execution.maxTradeNative ?? 0}
            maxSlippageBps={market?.execution.maxSlippageBps ?? 100}
            nativeSymbol={market?.chain.symbol ?? "ETH"}
          />
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
    </SatProvider>
    </WalletProvider>
  );
}
