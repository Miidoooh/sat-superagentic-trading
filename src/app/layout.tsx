import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./polish.css";
import "./v2.css";
import "./v25.css";
import { RefCapture } from "@/components/referral";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SAT_SITE_URL || "https://sathood.xyz"),
  title: "SAT - The eyes and brain for Robinhood Chain",
  description: "Whale radar, Pons launch safety scores, autopilot alerts and one-click trading on Robinhood Chain. Hold SAT to get the edge first.",
  openGraph: {
    title: "SAT - Strategic Agentic Trading",
    description: "Watch the whales, score every launch, trade from your own wallet. Live on Robinhood Chain.",
    images: ["/logo.png"],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <RefCapture />
        {children}
      </body>
    </html>
  );
}
