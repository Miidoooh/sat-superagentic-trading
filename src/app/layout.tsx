import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import "./polish.css";
import "./v2.css";
import "./v25.css";
import "./brand.css";
import { RefCapture } from "@/components/referral";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
/** Rounded, chunky display face for headlines; matches the SAT wordmark. */
const display = Unbounded({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SAT_SITE_URL || "https://sathood.xyz"),
  title: "SAT — Your satellite over Robinhood Chain",
  description: "SAT watches every trade, launch and whale on Robinhood Chain and tells you what matters first. Whale radar, launch safety scores, alerts and trading from your own wallet.",
  openGraph: {
    title: "SAT — Your satellite over Robinhood Chain",
    description: "Whales, hot launches and every move on Robinhood Chain, spotted first. Live now.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#070A14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <RefCapture />
        {children}
      </body>
    </html>
  );
}
