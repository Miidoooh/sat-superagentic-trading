"use client";

import { useEffect, useRef } from "react";
import type { Candle, ChartAnalysis } from "@/lib/types";

interface Props {
  candles: Candle[];
  analysis: ChartAnalysis | null;
}

export default function ChartPanel({ candles, analysis }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || candles.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (disposed || !ref.current) return;
      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "#07090c" }, textColor: "#8593a4" },
        grid: { vertLines: { color: "#141a22" }, horzLines: { color: "#141a22" } },
        rightPriceScale: { borderColor: "#1e2731" },
        timeScale: { borderColor: "#1e2731", timeVisible: true },
        crosshair: { vertLine: { color: "#3a4654" }, horzLine: { color: "#3a4654" } },
      });

      // Price precision has to suit both $600 equities and sub-cent tokens.
      const minPrice = Math.min(...candles.map((c) => c.low));
      // Launchpad tokens trade far below a cent; keep about four significant digits.
      const precision =
        minPrice >= 1 ? 2 : minPrice >= 0.01 ? 4 : minPrice > 0 ? Math.min(14, Math.ceil(-Math.log10(minPrice)) + 3) : 8;
      const series = chart.addCandlestickSeries({
        upColor: "#00d40a", downColor: "#ff4d2e", borderVisible: false,
        wickUpColor: "#00d40a", wickDownColor: "#ff4d2e",
        priceFormat: { type: "price", precision, minMove: 10 ** -precision },
      });
      series.setData(candles.map((c) => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })));

      // Oracle-derived candles carry no volume; don't render an empty pane for them.
      if (candles.some((c) => c.volume > 0)) {
        const volume = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(
          candles.map((c) => ({
            time: c.time as never,
            value: c.volume,
            color: c.close >= c.open ? "rgba(0,212,10,0.35)" : "rgba(255,77,46,0.35)",
          })),
        );
      }

      for (const level of analysis?.levels ?? []) {
        series.createPriceLine({
          price: level.price,
          color: level.kind === "support" ? "#00d40a" : "#ff4d2e",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.kind === "support" ? "S" : "R"} x${level.touches}`,
        });
      }

      series.setMarkers(
        (analysis?.patterns ?? [])
          .filter((p) => candles[p.atIndex])
          .sort((a, b) => a.time - b.time)
          .map((p) => ({
            time: p.time as never,
            position: p.direction === "bearish" ? ("aboveBar" as const) : ("belowBar" as const),
            color: p.direction === "bullish" ? "#00d40a" : p.direction === "bearish" ? "#ff4d2e" : "#ffb020",
            shape: p.direction === "bearish" ? ("arrowDown" as const) : ("arrowUp" as const),
            text: p.name,
          })),
      );

      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [candles, analysis]);

  return <div className="chart" ref={ref} />;
}
