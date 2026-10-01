import { parseAbi } from "viem";
import { getPublicClient } from "../chain/client";
import { multicallStrict } from "../chain/multicall";

/**
 * Pons tokens carry their own profile on chain: logo (an ipfs:// link),
 * description and up to five social links. Profiles never change after launch,
 * so each is read once per process.
 */

export interface PonsSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  farcaster?: string;
  website?: string;
}

export interface PonsProfile {
  /** Same-origin image URL, served through /api/ipfs. */
  logoUrl: string | null;
  description: string;
  socials: PonsSocials;
}

const profileAbi = parseAbi([
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string, string, string, string, string)",
]);

const known = new Map<string, PonsProfile | null>();
const PER_CALL = 150;
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,100})$/;

/** ipfs://CID → /api/ipfs/CID. Anything else that is plain https is passed through. */
export function logoUrlOf(raw: string): string | null {
  const s = raw.trim();
  const cid = s.replace(/^ipfs:\/\//, "").replace(/^\/?ipfs\//, "").split(/[/?#]/)[0];
  if (CID.test(cid)) return `/api/ipfs/${cid}`;
  if (/^https:\/\/[^\s"'<>]{4,300}$/.test(s)) return s;
  return null;
}

const safeUrl = (s: string) => {
  const t = s.trim();
  if (!t) return undefined;
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** The slot order is not documented, so links are classified by where they point. */
export function classifySocials(links: readonly string[]): PonsSocials {
  const out: PonsSocials = {};
  for (const raw of links) {
    const url = safeUrl(raw);
    if (!url) continue;
    const host = new URL(url).hostname.replace(/^www\./, "");
    if ((host === "x.com" || host === "twitter.com") && !out.twitter) out.twitter = url;
    else if ((host === "t.me" || host.endsWith("telegram.org")) && !out.telegram) out.telegram = url;
    else if ((host.includes("discord.gg") || host.includes("discord.com")) && !out.discord) out.discord = url;
    else if ((host.includes("warpcast") || host.includes("farcaster")) && !out.farcaster) out.farcaster = url;
    else if (!out.website) out.website = url;
  }
  return out;
}

export async function getPonsProfiles(tokens: readonly `0x${string}`[]): Promise<Map<string, PonsProfile>> {
  const missing = [...new Set(tokens.map((t) => t.toLowerCase()))].filter((t) => !known.has(t)) as `0x${string}`[];
  const client = getPublicClient();
  for (let i = 0; i < missing.length; i += PER_CALL) {
    const slice = missing.slice(i, i + PER_CALL);
    const results = await multicallStrict(
      client,
      slice.flatMap((address) => [
        { address, abi: profileAbi, functionName: "logo" as const },
        { address, abi: profileAbi, functionName: "description" as const },
        { address, abi: profileAbi, functionName: "socials" as const },
      ]),
    ).catch(() => null);
    if (!results) continue;
    slice.forEach((address, j) => {
      const [logo, description, socials] = results.slice(j * 3, j * 3 + 3);
      if (logo.status !== "success" && description.status !== "success") {
        known.set(address, null);
        return;
      }
      known.set(address, {
        logoUrl: logo.status === "success" ? logoUrlOf(String(logo.result)) : null,
        description: description.status === "success" ? String(description.result).slice(0, 500) : "",
        socials: socials.status === "success" ? classifySocials(socials.result as readonly string[]) : {},
      });
    });
  }
  const out = new Map<string, PonsProfile>();
  for (const t of tokens) {
    const p = known.get(t.toLowerCase());
    if (p) out.set(t.toLowerCase(), p);
  }
  return out;
}
