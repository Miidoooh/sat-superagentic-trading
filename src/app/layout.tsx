import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
