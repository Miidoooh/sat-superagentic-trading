import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import ReportView from "@/components/ReportView";
import "../live.css";

export const metadata: Metadata = {
  title: "Daily Robinhood Chain flow report | SAT",
  description: "The last 24 hours on Robinhood Chain: volume, where money is flowing, the biggest buys, smart money and new Pons launches. Read from chain by SAT.",
  openGraph: {
    title: "Daily Robinhood Chain flow report by SAT",
    description: "Volume, inflows, the biggest buys and new launches, read straight from chain.",
    images: [{ url: "/api/card/report", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/api/card/report"] },
};

/** Public daily report. No wallet needed; made to be shared. */
export default function ReportPage() {
  return (
    <main className="landing report-page">
      <nav className="lnav">
        <Link href="/" className="brand">
          <Logo />
          SAT
        </Link>
        <div className="spacer" />
        <Link className="btn sm ghost" href="/app?view=radar">
          Live whale radar
        </Link>
        <Link className="btn sm primary" href="/app">
          Open SAT
        </Link>
      </nav>
      <div className="wrap">
        <ReportView />
      </div>
    </main>
  );
}
