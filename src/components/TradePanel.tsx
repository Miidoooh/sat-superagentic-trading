"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { ponsTokenUrl } from "@/lib/chain/constants";
import { fmtUsd } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";
import { executeTrade } from "./tradeExec";
import { useSat } from "./sat";
import { TRADED_EVENT, useWallet } from "./wallet";

interface Quote {
  venue?: "uniswap-v3" | "uniswap-v4" | "pons";
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  slippageBps: number;
  notionalUsd: number;
  priceImpactPct: number | null;
  exact: boolean;
  needsApproval: boolean;
  warnings: string[];
  feeBps: number;
  feeUsd: number;
}

interface QuoteResponse {
  ok: boolean;
  errors: string[];
  executionEnabled: boolean;
  quote: Quote | null;
}

interface Props {
  market: TokenMarket | null;
  executionEnabled: boolean;
  maxTradeNative: number;
  maxSlippageBps: number;
  nativeSymbol: string;
}

const SLIPPAGES = [50, 100, 300, 500, 1000];
const QUOTE_DEBOUNCE_MS = 450;

export default function TradePanel({ market, executionEnabled, maxTradeNative, maxSlippageBps, nativeSymbol }: Props) {
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(Math.min(100, maxSlippageBps));
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; href?: string; tone?: "ok" | "bad" }[]>([]);
  const [balances, setBalances] = useState<{ native: number | null; token: number | null }>({ native: null, token: null });

  const { market: sat } = useSat();
  const isSat = !!market && !!sat && market.token.address.toLowerCase() === sat.address.toLowerCase();
  // Live curves are paid in their pair asset; SAT's v4 route and stocks take native ETH.
  const payAsset = market?.venue === "pons" && !market.graduated ? market.quoteSymbol : nativeSymbol;
  const payIsNative = payAsset === nativeSymbol;
  const token = market?.token;
  const slippages = SLIPPAGES.filter((s) => s <= maxSlippageBps);

  // Reset the ticket when the token changes.
  useEffect(() => {
    setAmount("");
    setQuote(null);
    setLog([]);
  }, [token?.address]);

  const refreshBalances = useCallback(async () => {
    if (!wallet.address || !token) {
      setBalances({ native: null, token: null });
      return;
    }
    try {
      const [native, held] = await Promise.all([
        wallet.reader.getBalance({ address: wallet.address }),
        wallet.reader.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
      ]);
      setBalances({ native: Number(formatUnits(native, 18)), token: Number(formatUnits(held, token.decimals)) });
    } catch {
      /* balances are a convenience; the server re-checks them */
    }
  }, [wallet.address, wallet.reader, token]);

  useEffect(() => {
    void refreshBalances();
    window.addEventListener(TRADED_EVENT, refreshBalances);
    return () => window.removeEventListener(TRADED_EVENT, refreshBalances);
  }, [refreshBalances]);

  const value = Number(amount);
  const validAmount = Number.isFinite(value) && value > 0;

  useEffect(() => {
    if (!token || !validAmount) {
      setQuote(null);
      return;
    }
    let alive = true;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/trade/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intent: { side, token: token.address, amount: value, slippageBps: slippage }, wallet: wallet.address }),
        });
        const body = (await res.json()) as QuoteResponse | { error: string };
        if (!alive) return;
        setQuote("error" in body ? { ok: false, errors: [body.error], executionEnabled, quote: null } : body);
      } catch (e) {
        if (alive) setQuote({ ok: false, errors: [(e as Error).message], executionEnabled, quote: null });
      } finally {
        if (alive) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [token, side, value, validAmount, slippage, wallet.address, executionEnabled]);

  const presets = useMemo(() => {
    if (side === "sell") return [25, 50, 100].map((p) => ({ label: `${p}%`, pct: p }));
    const base = payIsNative ? [0.005, 0.01, 0.025, 0.05, 0.1].filter((v) => v <= maxTradeNative) : [5, 10, 25, 50];
    return base.map((v) => ({ label: `${v}`, value: v }));
  }, [side, payIsNative, maxTradeNative]);

  const applyPreset = (p: { pct?: number; value?: number }) => {
    if (p.value !== undefined) setAmount(String(p.value));
    else if (p.pct !== undefined && balances.token) {
      const raw = (balances.token * p.pct) / 100;
      // Round down so a 100% sell never asks for more than the balance.
      const decimals = Math.min(6, token?.decimals ?? 6);
      setAmount((Math.floor(raw * 10 ** decimals) / 10 ** decimals).toString());
    }
  };

  async function submit() {
    if (!token || !validAmount) return;
    setBusy(true);
    setLog([]);
    try {
      const built = await executeTrade(
        { side, token: token.address, amount: value, slippageBps: slippage },
        wallet,
        (text, href) => setLog((l) => [...l, { text, href }]),
      );
      setLog((l) => [...l, { text: `${side === "buy" ? "Bought" : "Sold"} ${built.symbol}. Received at least ${built.minOut}.`, tone: "ok" }]);
      setAmount("");
      void refreshBalances();
    } catch (e) {
      const msg = (e as Error).message;
      setLog((l) => [...l, { text: /user rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg, tone: "bad" }]);
    } finally {
      setBusy(false);
    }
  }

  if (!market || !token) return null;

  if (market.graduated && !isSat) {
    return (
      <div className="trade-panel trade-graduated">
        <div className="trade-tabs">
          <strong>{token.symbol}</strong>
          <div className="spacer" />
          <span className="dim trade-venue">Uniswap v4</span>
        </div>
        <p className="muted">
          {token.symbol} graduated from its Pons curve and now trades in a Uniswap v4 pool. Trading v4 pools directly from SAT is coming next; until
          then, trade it on Pons.
        </p>
        <a className="btn primary trade-cta" href={ponsTokenUrl(token.address)} target="_blank" rel="noreferrer noopener">
          Trade {token.symbol} on Pons ↗
        </a>
      </div>
    );
  }

  const q = quote?.quote ?? null;
  const blocked = quote && !quote.ok ? quote.errors : [];
  const canSubmit = executionEnabled && validAmount && !quoting && !busy && quote?.ok === true;
  const cta = !wallet.address
    ? "Connect wallet"
    : !executionEnabled
      ? "Trading is off on this deployment"
      : busy
        ? "Waiting on wallet…"
        : `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}`;

  return (
    <div className="trade-panel">
      <div className="trade-tabs">
        <button className={`trade-tab buy ${side === "buy" ? "active" : ""}`} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button className={`trade-tab sell ${side === "sell" ? "active" : ""}`} onClick={() => setSide("sell")}>
          Sell
        </button>
        <div className="spacer" />
        <span className="dim trade-venue">{market.graduated ? "Uniswap v4 · via Pons router" : market.venue === "pons" ? "Pons curve" : "Uniswap v3"}</span>
      </div>

      <label className="trade-input">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
        />
        <span className="trade-asset">{side === "buy" ? payAsset : token.symbol}</span>
      </label>
      <div className="trade-meta">
        <div className="trade-presets">
          {presets.map((p) => (
            <button key={p.label} className="chip" onClick={() => applyPreset(p)} disabled={"pct" in p && !balances.token}>
              {p.label}
            </button>
          ))}
        </div>
        {wallet.address && (
          <span className="dim mono">
            {side === "buy"
              ? payIsNative && balances.native !== null
                ? `${balances.native.toFixed(4)} ${nativeSymbol}`
                : ""
              : balances.token !== null
                ? `${balances.token.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${token.symbol}`
                : ""}
          </span>
        )}
      </div>

      {validAmount && (
        <div className={`trade-quote ${quoting ? "is-stale" : ""}`}>
          {q ? (
            <>
              <div className="kv">
                <span className="k">You receive</span>
                <span className="mono">≈ {q.estimatedOut}</span>
              </div>
              <div className="kv">
                <span className="k">Minimum</span>
                <span className="mono">{q.minOut}</span>
              </div>
              <div className="kv">
                <span className="k">Value</span>
                <span className="mono">{fmtUsd(q.notionalUsd)}</span>
              </div>
              {q.priceImpactPct !== null && (
                <div className="kv">
                  {/* SAT's figure already includes the router fee and pool tax (~4% normally). */}
                  <span className="k">{q.venue === "uniswap-v4" ? "Cost incl. fees" : "Price impact"}</span>
                  <span className={`mono ${q.priceImpactPct > (q.venue === "uniswap-v4" ? 6 : 3) ? "down" : ""}`}>{q.priceImpactPct.toFixed(2)}%</span>
                </div>
              )}
              {q.feeBps > 0 && (
                <div className="kv">
                  <span className="k">SAT fee ({q.feeBps / 100}%)</span>
                  <span className="mono dim">{fmtUsd(q.feeUsd)}</span>
                </div>
              )}
              {q.needsApproval && <div className="dim">First confirms an exact approval, then the trade.</div>}
              {q.warnings.map((w) => (
                <div key={w} className="dim">
                  {w}
                </div>
              ))}
            </>
          ) : quoting ? (
            <div className="dim is-loading">Quoting against live contracts…</div>
          ) : null}
          {blocked.map((e) => (
            <div key={e} className="down">
              {e}
            </div>
          ))}
        </div>
      )}

      <div className="trade-slip">
        <span className="dim">Max slippage</span>
        <div className="tfs">
          {slippages.map((s) => (
            <button key={s} className={`tf ${slippage === s ? "active" : ""}`} onClick={() => setSlippage(s)}>
              {s / 100}%
            </button>
          ))}
        </div>
      </div>

      <button
        className={`btn trade-cta ${side}`}
        disabled={wallet.address ? !canSubmit : wallet.connecting}
        onClick={() => (wallet.address ? void submit() : void wallet.connect())}
      >
        {wallet.connecting ? "Connecting…" : cta}
      </button>

      {log.length > 0 && (
        <div className="steps">
          {log.map((l, i) => (
            <div className={`step ${l.tone === "ok" ? "up" : l.tone === "bad" ? "down" : ""}`} key={i}>
              {l.href ? (
                <a href={l.href} target="_blank" rel="noreferrer noopener" className="link-sym">
                  {l.text} ↗
                </a>
              ) : (
                l.text
              )}
            </div>
          ))}
        </div>
      )}
      <div className="dim trade-foot">You sign every transaction in your own wallet. SAT never holds keys.</div>
    </div>
  );
}
