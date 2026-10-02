"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { SatMarket } from "@/lib/sat/token";
import { LiveLaunches, LiveScan, LiveTrending, LiveWhales } from "./LiveWidgets";
import Satellite, { type SatMood } from "./Satellite";

const openToken = (token: string) => {
  window.location.href = `/app?token=${token}`;
};

/** Fades a block in the first time it scrolls into view. */
export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`sx-reveal ${shown ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const CHAPTERS: { mood: SatMood; tag: string; title: string; lead: string; widget: React.ReactNode }[] = [
  {
    mood: "watching",
    tag: "WATCHING",
    title: "It never blinks.",
    lead: "Every Pons launch and every Uniswap pool on Robinhood Chain, read straight from the chain around the clock. New tokens show up here seconds after they are deployed.",
    widget: <LiveLaunches onOpen={openToken} />,
  },
  {
    mood: "whale",
    tag: "WHALE SPOTTED",
    title: "Whales can't hide.",
    lead: "The second a big wallet buys or sells, SAT sees it and tells you, on the site or straight to your Telegram.",
    widget: <LiveWhales onOpen={openToken} />,
  },
  {
    mood: "pump",
    tag: "PUMP",
    title: "Catch it before the timeline.",
    lead: "Thousands of launches, ranked live by the real money flowing in. See what is running while it is still early.",
    widget: <LiveTrending onOpen={openToken} />,
  },
  {
    mood: "scanning",
    tag: "SCANNING",
    title: "Red flags, spotted first.",
    lead: "Every launch gets a safety score from its own on-chain history: who holds it, who is selling and how fast it is filling.",
    widget: <LiveScan onOpen={openToken} />,
  },
];

export function Chapters() {
  return (
    <section className="sx-chapters" id="features">
      <div className="sx-wrap">
        {CHAPTERS.map((c, i) => (
          <div key={c.tag} className={`sx-chapter ${i % 2 ? "flip" : ""}`}>
            <Reveal>
              <div className="sx-chapter-art">
                <Satellite mood={c.mood} size={300} />
              </div>
            </Reveal>
            <Reveal delay={120}>
              <span className="sx-mood">
                <span className="dot live" /> {c.tag}
              </span>
              <h2>{c.title}</h2>
              <p className="lead">{c.lead}</p>
              {c.widget}
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  );
}

interface SatInfo {
  market: SatMarket;
  thresholds: { holderUsd: number; whaleUsd: number };
}

/** Holder tiers as orbits around the chain. */
export function Orbits() {
  const [sat, setSat] = useState<SatInfo | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/sat")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && !("error" in d) && setSat(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const m = sat?.market;
  const holder = sat?.thresholds.holderUsd ?? 50;
  const whale = sat?.thresholds.whaleUsd ?? 500;
  return (
    <section className="sx-orbits" id="sat">
      <div className="sx-wrap">
        <Reveal>
          <span className="sx-mood">$SAT</span>
          <h2>
            Pick your orbit.
          </h2>
          <p className="lead">Hold $SAT and SAT works harder for you: alerts first, more autopilot rules, 24/7 delivery. Your orbit is read live from your wallet. No signup, no staking.</p>
        </Reveal>
        <div className="sx-rings" aria-hidden>
          <span className="core" />
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="ring r3" />
        </div>
        <div className="sx-tiers">
          <Reveal className="sx-tier">
            <span className="k">LOW ORBIT</span>
            <h3>Free</h3>
            <span className="need">Everyone</span>
            <ul>
              <li>Full terminal, radar and Explore</li>
              <li>3 autopilot rules</li>
              <li>Telegram alerts, 60s behind holders</li>
              <li>Launch safety scores</li>
            </ul>
          </Reveal>
          <Reveal className="sx-tier mid" delay={100}>
            <span className="k">MID ORBIT</span>
            <h3>Holder</h3>
            <span className="need">${holder.toLocaleString("en-US")}+ in $SAT</span>
            <ul>
              <li>Instant alerts, 24/7</li>
              <li>15 autopilot rules</li>
              <li>Holder badge on PnL cards</li>
              <li>Everything in Free</li>
            </ul>
          </Reveal>
          <Reveal className="sx-tier deep" delay={200}>
            <span className="k">DEEP SPACE</span>
            <h3>Whale</h3>
            <span className="need">${whale.toLocaleString("en-US")}+ in $SAT</span>
            <ul>
              <li>30 autopilot rules</li>
              <li>Whale badge on PnL cards</li>
              <li>First look at new features</li>
              <li>Everything in Holder</li>
            </ul>
          </Reveal>
        </div>
        <div className="sx-price">
          <span className="dim">$SAT</span>
          <b>{m ? `$${fmtPrice(m.priceUsd)}` : "···"}</b>
          {m?.change24hPct != null && <span className={m.change24hPct >= 0 ? "up" : "down"}>{fmtPct(m.change24hPct)}</span>}
          <span className="dim">mcap {m ? fmtUsd(m.marketCapUsd, { compact: true }) : "···"}</span>
        </div>
        <div className="sx-cta">
          <Link className="sx-btn primary" href={m ? `/app?token=${m.address}` : "/app?view=sat"}>
            Buy $SAT on SAT
          </Link>
          <Link className="sx-btn ghost" href="/app?view=sat">
            Check my orbit
          </Link>
        </div>
      </div>
    </section>
  );
}
