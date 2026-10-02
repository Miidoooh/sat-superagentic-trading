import Link from "next/link";
import { Chapters, Orbits, Reveal } from "@/components/brand/Landing";
import { TrendingTape } from "@/components/brand/LiveWidgets";
import OrbitHero from "@/components/brand/OrbitHero";
import Satellite from "@/components/brand/Satellite";
import Logo from "@/components/Logo";
import "./live.css";

export default function Landing() {
  return (
    <main className="sx">
      <header className="sx-nav">
        <Link href="/" className="brand">
          <Logo size={34} />
          <span className="brand-name">SAT</span>
        </Link>
        <nav>
          <Link href="/app?view=explore">Explore</Link>
          <Link href="/app?view=radar">Whales</Link>
          <Link href="/report">Daily report</Link>
          <Link href="#sat">$SAT</Link>
        </nav>
        <div className="spacer" />
        <a className="btn sm icon-only" href="https://x.com/sat_hood" target="_blank" rel="noreferrer noopener" aria-label="SAT on X" title="@sat_hood on X">
          <svg className="x-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <Link className="sx-btn primary" href="/app" style={{ height: 40, padding: "0 18px", fontSize: 14, borderRadius: 12 }}>
          Open SAT
        </Link>
      </header>

      <section className="sx-hero">
        <OrbitHero />
        <div className="sx-hero-copy sx-wrap">
          <span className="sx-chip">
            <b>LIVE</b> Robinhood Chain · watching now
          </span>
          <h1>
            Your satellite over <em>Robinhood Chain</em>
          </h1>
          <p className="sx-sub">Every launch, every pump and every whale on Pons and Uniswap. SAT watches Robinhood Chain for you and tells you what is running before the timeline does.</p>
          <div className="sx-cta">
            <Link className="sx-btn primary" href="/app">
              Open SAT →
            </Link>
            <Link className="sx-btn ghost" href="#sat">
              Get $SAT
            </Link>
          </div>
        </div>
      </section>

      <TrendingTape />
      <Chapters />
      <Orbits />

      <div className="sx-wrap">
        <Reveal>
          <section className="sx-final">
            <Satellite mood="pump" size={150} />
            <h2>Put a satellite on your side.</h2>
            <p>Free to use. Your keys never leave your wallet. You sign every trade yourself.</p>
            <div className="sx-cta">
              <Link className="sx-btn primary" href="/app">
                Open SAT →
              </Link>
              <Link className="sx-btn ghost" href="/report">
                Today&apos;s token report
              </Link>
            </div>
          </section>
        </Reveal>

        <footer className="sx-foot">
          <div className="sx-foot-top">
            <Logo size={26} />
            <span className="brand-name">SAT</span>
            <span className="dim">Your satellite over Robinhood Chain</span>
            <div className="spacer" style={{ flex: 1 }} />
            <Link href="/app">App</Link>
            <Link href="/report">Report</Link>
            <a href="https://x.com/sat_hood" target="_blank" rel="noreferrer noopener">
              X @sat_hood
            </a>
          </div>
          <p>
            Not investment advice. Indicators, scores and patterns are heuristics, not predictions. Stock Tokens are tokenised debt securities issued by Robinhood Assets (Jersey) Limited;
            they track an underlying security&apos;s economics but grant no ownership of it, and they are not available to US persons. Prices on a 24/7 on-chain market can diverge from
            the underlying equity. Always confirm contract addresses on the official explorer.
          </p>
        </footer>
      </div>
    </main>
  );
}
