export function fmtUsd(value: number | null, opts: { compact?: boolean } = {}): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    if (abs >= 100) return `$${value.toFixed(0)}`;
    // Dollar amounts, unlike prices, never need sub-cent precision.
    return `$${value.toFixed(2)}`;
  }
  return `$${fmtPrice(value)}`;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Prices people can read. Tiny launch prices collapse their run of zeros into
 * a subscript count, the way trading terminals show them: 0.00000394 → 0.0₅394.
 */
export function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0.00";
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  if (abs >= 0.0001) return value.toPrecision(3);
  // Zeros between the decimal point and the first significant digit.
  const zeros = Math.floor(-Math.log10(abs));
  const digits = Math.round(abs * 10 ** (zeros + 4))
    .toString()
    .slice(0, 4)
    .replace(/0+$/, "");
  const sub = String(zeros)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
  return `${value < 0 ? "-" : ""}0.0${sub}${digits || "0"}`;
}

export function fmtPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function fmtNum(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** Sort comparator that always pushes missing values to the end. */
export function byDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Elapsed time since a unix timestamp, with second resolution for live feeds. */
export function fmtAgo(timestamp: number, nowSec = Date.now() / 1000): string {
  const secs = Math.max(0, Math.floor(nowSec - timestamp));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86_400)}d`;
}

export function fmtAge(seconds: number | null): string {
  if (seconds === null) return "—";
  const mins = Math.floor((Date.now() / 1000 - seconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
