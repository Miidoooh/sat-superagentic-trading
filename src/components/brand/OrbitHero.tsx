"use client";

import { useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import type { RadarSnapshot, WhaleTrade } from "@/lib/radar/whales";
import { usePoll } from "../usePoll";
import Satellite, { type SatMood } from "./Satellite";

/** Trades at least this big make SAT turn and call them out. */
const WHALE_USD = 5_000;
const BUBBLE_MS = 4_500;

interface Ping {
  x: number;
  y: number;
  born: number;
  buy: boolean;
  size: number;
}

/** Same token, same spot on the planet: each token gets its own "city". */
function spotFor(token: string, w: number, h: number, planet: { cx: number; cy: number; r: number }) {
  let hash = 0;
  for (let i = 2; i < token.length; i++) hash = (hash * 33 + token.charCodeAt(i)) >>> 0;
  const a = (Math.PI * (1.12 + ((hash % 1000) / 1000) * 0.76));
  const depth = 0.08 + (((hash >>> 10) % 1000) / 1000) * 0.22;
  const r = planet.r * (1 - depth);
  return { x: planet.cx + Math.cos(a) * r, y: Math.max(h * 0.62, planet.cy + Math.sin(a) * r) };
}

/**
 * The homepage hero: Robinhood Chain as a living planet. Every real trade
 * pings on its surface; SAT orbits above and calls out the whales as they land.
 */
export default function OrbitHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbiterRef = useRef<HTMLDivElement>(null);
  const pings = useRef<Ping[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const layout = useRef({ w: 0, h: 0, planet: { cx: 0, cy: 0, r: 0 } });
  const satPos = useRef({ x: 0, y: 0 });
  const [mood, setMood] = useState<SatMood>("watching");
  const [bubble, setBubble] = useState<(WhaleTrade & { left: boolean }) | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data } = usePoll<RadarSnapshot>("/api/whales?minUsd=250&venue=all&limit=80", 8_000);

  // Draw: stars, the planet, its atmosphere, and the live pings.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let stars: { x: number; y: number; r: number; t: number }[] = [];
    let cities: { x: number; y: number; a: number }[] = [];
    let raf = 0;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = Math.max(w * 0.78, h * 1.05);
      layout.current = { w, h, planet: { cx: w / 2, cy: h + r * 0.7, r } };
      stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({ x: Math.random() * w, y: Math.random() * h * 0.8, r: Math.random() * 1.3 + 0.2, t: Math.random() * Math.PI * 2 }));
      const p = layout.current.planet;
      cities = Array.from({ length: 160 }, () => {
        const a = Math.PI * (1.08 + Math.random() * 0.84);
        const d = p.r * (1 - (0.02 + Math.random() * 0.35));
        return { x: p.cx + Math.cos(a) * d, y: p.cy + Math.sin(a) * d, a: Math.random() * 0.5 + 0.15 };
      }).filter((c) => c.y < h + 4);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      const { w, h, planet } = layout.current;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = reduced ? 0.6 : 0.35 + 0.35 * Math.sin(t / 900 + s.t);
        ctx.fillStyle = `rgba(210,215,255,${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Atmosphere glow.
      const glow = ctx.createRadialGradient(planet.cx, planet.cy, planet.r * 0.96, planet.cx, planet.cy, planet.r * 1.12);
      glow.addColorStop(0, "rgba(109,91,255,0.35)");
      glow.addColorStop(0.4, "rgba(109,91,255,0.12)");
      glow.addColorStop(1, "rgba(109,91,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(planet.cx, planet.cy, planet.r * 1.12, 0, Math.PI * 2);
      ctx.fill();
      // The planet.
      const body = ctx.createRadialGradient(planet.cx - planet.r * 0.3, planet.cy - planet.r * 0.9, planet.r * 0.1, planet.cx, planet.cy, planet.r);
      body.addColorStop(0, "#2d2f94");
      body.addColorStop(0.35, "#161a5c");
      body.addColorStop(1, "#070a1f");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(planet.cx, planet.cy, planet.r, 0, Math.PI * 2);
      ctx.fill();
      // Rim light.
      ctx.strokeStyle = "rgba(204,255,0,0.55)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(204,255,0,0.8)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(planet.cx, planet.cy, planet.r, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Latitude lines.
      ctx.strokeStyle = "rgba(160,170,255,0.07)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.arc(planet.cx, planet.cy, planet.r * (1 - i * 0.07), Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      }
      // Quiet city lights.
      for (const c of cities) {
        ctx.fillStyle = `rgba(204,255,0,${c.a * (reduced ? 0.6 : 0.5 + 0.5 * Math.sin(t / 1400 + c.x))})`;
        ctx.fillRect(c.x, c.y, 1.6, 1.6);
      }
      // Live pings.
      const now = performance.now();
      pings.current = pings.current.filter((p) => now - p.born < 2600);
      for (const p of pings.current) {
        const age = (now - p.born) / 2600;
        const color = p.buy ? "204,255,0" : "255,77,46";
        ctx.strokeStyle = `rgba(${color},${(1 - age) * 0.9})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + age * p.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${color},${1 - age})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // The orbit, and SAT on it.
      // The orbit runs in the open band between the call to action and the planet.
      const ox = w / 2;
      const oy = h * 0.72;
      const rx = Math.min(w * 0.44, 680);
      const ry = h * 0.1;
      ctx.strokeStyle = "rgba(204,255,0,0.12)";
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const angle = reduced ? -0.6 : t / 9000 - 0.6;
      const x = ox + Math.cos(angle) * rx;
      const y = oy + Math.sin(angle) * ry;
      satPos.current = { x, y };
      const scale = 0.82 + 0.22 * ((Math.sin(angle) + 1) / 2);
      if (orbiterRef.current) orbiterRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Feed real trades into the planet and let SAT react to the big ones.
  useEffect(() => {
    if (!data) return;
    const first = seen.current === null;
    if (first) seen.current = new Set();
    const fresh = data.trades.filter((t) => !seen.current!.has(t.id));
    for (const t of fresh) seen.current!.add(t.id);
    // On first load, replay the latest trades so the planet is alive immediately.
    const batch = first ? fresh.slice(0, 18).reverse() : fresh.reverse();
    batch.forEach((t, i) => {
      setTimeout(() => {
        const { w, h, planet } = layout.current;
        const spot = spotFor(t.token, w, h, planet);
        pings.current.push({ ...spot, born: performance.now(), buy: t.side === "buy", size: 14 + Math.min(46, Math.log10(Math.max(10, t.usd)) * 9) });
      }, i * (first ? 260 : 400));
    });
    const whale = (first ? fresh.slice(0, 18) : fresh).filter((t) => t.usd >= (first ? 2_000 : WHALE_USD)).sort((a, b) => b.usd - a.usd)[0];
    if (whale) {
      setTimeout(
        () => {
          setMood("whale");
          setBubble({ ...whale, left: satPos.current.x > layout.current.w / 2 });
          if (moodTimer.current) clearTimeout(moodTimer.current);
          moodTimer.current = setTimeout(() => {
            setBubble(null);
            setMood(whale.side === "buy" && whale.usd >= 10_000 ? "pump" : "watching");
            moodTimer.current = setTimeout(() => setMood("watching"), 2_500);
          }, BUBBLE_MS);
        },
        first ? 1_800 : 300,
      );
    }
  }, [data]);

  // Between whales, SAT sweeps the chain now and then.
  useEffect(() => {
    const t = setInterval(() => {
      setMood((m) => {
        if (m !== "watching") return m;
        setTimeout(() => setMood((cur) => (cur === "scanning" ? "watching" : cur)), 3_000);
        return "scanning";
      });
    }, 11_000);
    return () => clearInterval(t);
  }, []);

  const totals = data?.totals;
  const bought = totals ? totals.stock.buyUsd + totals.pons.buyUsd : null;
  const sold = totals ? totals.stock.sellUsd + totals.pons.sellUsd : null;
  const trades = totals ? totals.stock.trades + totals.pons.trades : null;
  const whales = data ? data.trades.filter((t) => t.usd >= 10_000).length : null;

  return (
    <>
      <canvas ref={canvasRef} className="sx-canvas" aria-hidden />
      <div ref={orbiterRef} className="sx-orbiter">
        <Satellite mood={mood} size={150} />
        {bubble && (
          <div className={`sx-bubble ${bubble.side === "sell" ? "sell" : ""}`} style={bubble.left ? { right: "88%", top: "-30%" } : { left: "88%", top: "-30%" }}>
            <div className="sx-bubble-k">🐋 WHALE SPOTTED</div>
            <div className="sx-bubble-v">
              {bubble.side === "buy" ? "+" : "−"}
              {fmtUsd(bubble.usd, { compact: true })} {bubble.side === "buy" ? "into" : "out of"} {bubble.symbol}
            </div>
            <div className="sx-bubble-s">just now · live on Robinhood Chain</div>
          </div>
        )}
      </div>
      <div className="sx-live">
        <div className="sx-stat">
          <span className="v mono">{trades !== null ? trades.toLocaleString("en-US") : "···"}</span>
          <span className="k">Trades · 30 min</span>
        </div>
        <div className="sx-stat">
          <span className="v mono up">{bought !== null ? fmtUsd(bought, { compact: true }) : "···"}</span>
          <span className="k">Bought</span>
        </div>
        <div className="sx-stat">
          <span className="v mono down">{sold !== null ? fmtUsd(sold, { compact: true }) : "···"}</span>
          <span className="k">Sold</span>
        </div>
        <div className="sx-stat">
          <span className="v mono">{whales !== null ? `${whales} 🐋` : "···"}</span>
          <span className="k">Whales · $10K+</span>
        </div>
      </div>
    </>
  );
}
