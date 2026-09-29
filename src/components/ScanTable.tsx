"use client";

import type { ScanResult } from "@/lib/scanner/scan";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

export default function ScanTable({ result, onSelect }: { result: ScanResult; onSelect: (symbol: string) => void }) {
  return (
    <div className="artifact">
      <div className="artifact-head">
        <span className="pill accent">scan</span>
        <span className="muted">
          {result.matches.length} of {result.scanned} tokens matched
        </span>
      </div>
      {result.matches.length === 0 ? (
        <div className="artifact-body dim">Nothing matched these criteria.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>24h</th>
              <th>RSI</th>
              <th>Liquidity</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {result.matches.map((m) => (
              <tr key={m.market.token.address}>
                <td>
                  <button className="link-sym" onClick={() => onSelect(m.market.token.symbol)}>
                    {m.market.token.symbol}
                  </button>
                </td>
                <td className={`mono ${(m.market.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}`}>
                  {fmtPct(m.market.priceChange24hPct, 1)}
                </td>
                <td className="mono">{fmtNum(m.analysis?.indicators.rsi14 ?? null, 0)}</td>
                <td className="mono">{fmtUsd(m.market.liquidityUsd, { compact: true })}</td>
                <td className="dim">{m.reasons.slice(0, 3).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.notes.length > 0 && (
        <div className="artifact-body dim">
          {result.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}
