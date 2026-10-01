import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Logo from "@/components/Logo";
import OpenInApp from "@/components/OpenInApp";
import { getPonsProfiles } from "@/lib/data/ponsProfile";
import { getTokenMeta } from "@/lib/data/tokenMeta";

interface Params {
  params: Promise<{ address: string }>;
}

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/** Previews only need identity, read straight from the token contract: two quick calls, no market scan. */
async function identity(address: `0x${string}`) {
  const [meta, profiles] = await Promise.all([
    getTokenMeta([address]).catch(() => new Map()),
    getPonsProfiles([address]).catch(() => new Map()),
  ]);
  const m = meta.get(address.toLowerCase());
  return m ? { ...m, profile: profiles.get(address.toLowerCase()) ?? null } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address)) return {};
  const t = await identity(address as `0x${string}`);
  if (!t) return { title: "Token on SAT" };
  const title = `${t.symbol} · ${t.name} | SAT`;
  const description = t.profile?.description?.slice(0, 180) || `${t.name} ($${t.symbol}) on Robinhood Chain. Live chart, holders and safety score on SAT.`;
  const image = t.profile?.logoUrl ?? "/logo.png";
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary", title, description, images: [image] } };
}

/** A shareable link for any token. People land in the terminal with it open. */
export default async function TokenPage({ params }: Params) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <main className="share">
      <Link href="/" className="brand share-brand">
        <Logo />
        <span className="brand-name">SAT</span>
      </Link>
      <OpenInApp href={`/app?token=${address}`} />
    </main>
  );
}
