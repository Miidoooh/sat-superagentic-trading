import Image from "next/image";
import Link from "next/link";
import LandingStats from "@/components/LandingStats";
import Logo from "@/components/Logo";
import PonsTicker from "@/components/PonsTicker";
import Ticker from "@/components/Ticker";
import { ROBINHOOD_MAINNET } from "@/lib/chain/constants";

const FEATURES = [
  {
    icon: "◈",
    title: "Deep chart analysis",
    body: "RSI, MACD, moving averages, Bollinger bands and ATR computed on real oracle price history, with support and resistance clustered from swing pivots.",
  },
  {
    icon: "◇",
    title: "Pattern detection",
    body: "Breakouts, moving-average and MACD crosses, double tops and bottoms, RSI divergence and volatility squeezes, each scored and marked on the chart.",
  },
  {
    icon: "⌗",
    title: "Criteria scanning",
    body: "Describe what you are looking for in plain language. The agent turns it into explicit filters over liquidity, momentum, trend, RSI and patterns.",
  },
  {
    icon: "⛓",
    title: "On-chain analytics",
    body: "Swap volume with a buy and sell split, transfer flow, mints and burns, whale transfers and the largest net accumulators, read straight from logs.",
  },
  {
    icon: "⇄",
    title: "Trade proposals",
    body: "The agent proposes swaps through Uniswap v3 and never holds a key. Size, slippage and price-impact limits are enforced before you ever see a prompt.",
  },
  {
    icon: "◎",
    title: "Oracle cross-check",
    body: "Every pool price sits next to its Chainlink reference price, so you can see when the 24/7 on-chain market has drifted from the underlying equity.",
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
        <Link className="btn sm" href="/app">
          Enter App
        </Link>
      </nav>

      <section className="hero">
        <div className="wrap">
          <span className="hero-mark">
            <Image src="/logo.png" alt="" width={176} height={176} priority />
          </span>
          <span className="pill accent">Agentic trading for Robinhood Chain</span>
          <h1>
            Your agent reads the <em>whole chain</em> before you read one chart
          </h1>
          <p className="sub">
            SAT runs deep technical analysis, surfaces chart patterns, and scans every tokenised equity on
            Robinhood Chain against the exact criteria you describe. Prices come from Uniswap v3 pools and
            Chainlink feeds on chain {ROBINHOOD_MAINNET.chainId}.
          </p>
          <div className="cta">
            <Link className="btn primary lg" href="/app">
              Enter App →
            </Link>
            <a
              className="btn lg"
              href="https://docs.robinhood.com/chain/"
              target="_blank"
              rel="noreferrer noopener"
            >
              Robinhood Chain docs
            </a>
          </div>
          <p className="fine">Read-only by default. Trading stays disabled until you turn it on.</p>
        </div>
      </section>

      <Ticker />
      <PonsTicker />

      <div className="wrap">
        <LandingStats />

        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="ico">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>

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
            <span className="pill">Flow &amp; volume</span>
            Swap and Transfer event logs
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
