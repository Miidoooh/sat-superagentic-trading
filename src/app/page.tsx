import Image from "next/image";
import Link from "next/link";
import HeroPreview from "@/components/HeroPreview";
import HeroPulse from "@/components/HeroPulse";
import LandingStats from "@/components/LandingStats";
import Logo from "@/components/Logo";
import PonsTicker from "@/components/PonsTicker";
import SatTokenSection from "@/components/SatTokenSection";
import Ticker from "@/components/Ticker";
import { ROBINHOOD_MAINNET } from "@/lib/chain/constants";
import "./live.css";
import "./v2.css";

interface Pillar {
  step: string;
  title: string;
  lead: string;
  items: { name: string; text: string; href: string }[];
}

const PILLARS: Pillar[] = [
  {
    step: "01",
    title: "Watch",
    lead: "See where the money is moving, the moment it moves.",
    items: [
      { name: "Whale Radar", text: "The biggest buys and sells, live.", href: "/app?view=radar" },
      { name: "Pons Trenches", text: "New launches and curves about to graduate.", href: "/app?view=trenches" },
      { name: "Smart Money", text: "Top wallets, and what they are buying.", href: "/app?view=wallets" },
    ],
  },
  {
    step: "02",
    title: "Understand",
    lead: "Charts and signals, explained in plain words.",
    items: [
      { name: "Launch safety score", text: "Every Pons launch scored: deployer, holders, sells.", href: "/app?view=trenches" },
      { name: "Chart analysis", text: "Trend, RSI, MACD, support and resistance.", href: "/app" },
      { name: "Ask the agent", text: "Describe what you want; it scans every token.", href: "/app" },
    ],
  },
  {
    step: "03",
    title: "Act",
    lead: "Stay ahead without staring at a screen.",
    items: [
      { name: "One-click trading", text: "Live quotes, guardrails, your own wallet signs.", href: "/app" },
      { name: "Autopilot alerts", text: "Rules in plain words, sent to Telegram 24/7.", href: "/app" },
      { name: "PnL cards", text: "Share real, on-chain-verified wins in one click.", href: "/app?view=portfolio" },
    ],
  },
];

export default function Landing() {
  return (
    <main className="landing">
      <nav className="lnav">
        <div className="brand">
          <Logo />
          Strategic Agentic Trading
        </div>
        <div className="spacer" />
        <span className="pill ok">
          <span className="dot live" />
          Mainnet
        </span>
        <a
          className="btn sm icon-only"
          href="https://x.com/sat_hood"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="SAT on X"
          title="@sat_hood on X"
        >
          <svg className="x-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <Link className="btn sm" href="/app">
          Enter App
        </Link>
      </nav>

      <section className="hero hero-split">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="hero-mark">
              <Image src="/logo.png" alt="" width={176} height={176} priority />
            </span>
            <Link className="pill accent new-pill" href="/app?view=sat">
              <b>v2.5</b> Hold SAT, launch safety scores and PnL cards →
            </Link>
            <h1>
              The eyes and brain for <em>Robinhood Chain</em>
            </h1>
            <p className="sub">
              SAT watches every stock-token trade, every Pons launch and every whale on chain {ROBINHOOD_MAINNET.chainId}, then tells you what
              matters in plain words. For traders, and for the agents they run.
            </p>
            <div className="cta">
              <Link className="btn primary lg" href="/app">
                Enter App →
              </Link>
              <Link className="btn lg ghost" href="/app?view=trenches">
                Explore launches
              </Link>
            </div>
            <p className="fine">Free to use. Your keys never leave your wallet; you sign every trade yourself.</p>
            <HeroPulse />
          </div>
          <HeroPreview />
        </div>
      </section>

      <Ticker />
      <PonsTicker />

      <div className="wrap">
        <LandingStats />

        <section className="pillars">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.title}>
              <div className="pillar-step mono">{p.step}</div>
              <h3>{p.title}</h3>
              <p className="pillar-lead">{p.lead}</p>
              <ul>
                {p.items.map((item) => (
                  <li key={item.name}>
                    <Link href={item.href}>
                      <strong>{item.name}</strong>
                      <span>{item.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <SatTokenSection />

        <section className="closer">
          <h2>Start with one question</h2>
          <p>Open the app and ask the agent anything, like “where are whales buying right now?”</p>
          <Link className="btn primary lg" href="/app">
            Open SAT →
          </Link>
        </section>

        <h2 className="section-label">Where the numbers come from</h2>
        <div className="sources">
          <div className="source">
            <span className="pill">Universe</span>
            Robinhood&apos;s public Stock Token asset list
            <code>api.robinhood.com/rhj/assets</code>
          </div>
          <div className="source">
            <span className="pill">Spot price &amp; liquidity</span>
            Uniswap v3 pools, read over JSON-RPC
            <code>{ROBINHOOD_MAINNET.rpcUrl.replace("https://", "")}</code>
          </div>
          <div className="source">
            <span className="pill">Reference price &amp; history</span>
            Chainlink data feeds on Robinhood Chain
            <code>AggregatorV3Interface</code>
          </div>
          <div className="source">
            <span className="pill">Flow &amp; launches</span>
            Swap, curve and Transfer event logs
            <code>eth_getLogs</code>
          </div>
        </div>
      </div>

      <footer className="lfoot">
        <div className="wrap">
          <p>
            Not investment advice. Indicators and patterns are heuristics, not predictions. Stock Tokens are
            tokenised debt securities issued by Robinhood Assets (Jersey) Limited; they track an underlying
            security&apos;s economics but grant no ownership of it, and they are not available to US persons.
          </p>
          <p>
            Prices on a 24/7 on-chain market can diverge from the underlying equity, especially while
            traditional markets are closed. Always confirm contract addresses on the official explorer.
          </p>
        </div>
      </footer>
    </main>
  );
}
