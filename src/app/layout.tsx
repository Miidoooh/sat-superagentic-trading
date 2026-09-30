import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./polish.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "SAT - Superagentic Trading | Robinhood Chain",
  description:
    "Agentic chart analysis, pattern detection and token scanning for tokenised equities on Robinhood Chain.",
  openGraph: {
    title: "SAT - Superagentic Trading",
    description: "Agentic chart analysis and token scanning for Robinhood Chain.",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
