import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Logo from "@/components/Logo";

interface Params {
  params: Promise<{ address: string; token: string }>;
}

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

function cardUrl(address: string, token: string) {
  return `/api/card/pnl?address=${address}&token=${token}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address, token } = await params;
  if (!isAddress(address) || !isAddress(token)) return {};
  const image = { url: cardUrl(address, token), width: 1200, height: 630 };
  const title = "A trade tracked on SAT";
  const description = "Real PnL, read from Robinhood Chain. Watch the whales and trade from your own wallet on SAT.";
  return {
    title,
    description,
    openGraph: { title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/** Public page behind a shared PnL card. The card is the preview X shows. */
export default async function SharePage({ params }: Params) {
  const { address, token } = await params;
  if (!isAddress(address) || !isAddress(token)) notFound();
  return (
    <main className="share">
      <Link href={`/?ref=${address}`} className="brand share-brand">
        <Logo />
        <span className="brand-name">SAT</span>
      </Link>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="share-card" src={cardUrl(address, token)} alt="PnL card" width={1200} height={630} />
      <div className="share-cta">
        <Link className="btn primary lg" href={`/app?ref=${address}&token=${token}`}>
          Open SAT
        </Link>
        <Link className="btn lg ghost" href={`/app?ref=${address}&view=portfolio`}>
          Track my own PnL
        </Link>
      </div>
      <p className="dim">Every number on this card is read from the wallet&apos;s on-chain trades.</p>
    </main>
  );
}
