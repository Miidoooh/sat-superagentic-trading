"use client";

import { useState } from "react";

/** A stable hue per token so letter avatars stay the same colour everywhere. */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/**
 * Token logo over a coloured initial. The initial shows at once and the logo
 * fades in when it arrives, so a slow or broken image never leaves a blank.
 */
export function TokenAvatar({ src, symbol, seed, size = 22 }: { src?: string | null; symbol: string; seed: string; size?: number }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const hue = hueOf(seed.toLowerCase());
  return (
    <span
      className="tok-av tok-av-fallback"
      style={{ width: size, height: size, minWidth: size, fontSize: Math.round(size * 0.45), background: `hsl(${hue} 55% 22%)`, color: `hsl(${hue} 85% 72%)` }}
      aria-hidden
    >
      {(symbol.replace(/[^A-Za-z0-9]/g, "")[0] ?? "?").toUpperCase()}
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`tok-av-img ${state === "ready" ? "ready" : ""}`}
          src={src}
          alt=""
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
        />
      )}
    </span>
  );
}

export interface Socials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  farcaster?: string;
  website?: string;
}

const ICONS: Record<keyof Socials, { label: string; path: string }> = {
  twitter: {
    label: "X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  telegram: {
    label: "Telegram",
    path: "M9.78 15.17 9.6 19.3c.4 0 .58-.17.79-.38l1.9-1.82 3.94 2.88c.72.4 1.24.19 1.43-.67l2.6-12.18c.25-1.08-.4-1.5-1.1-1.25L3.9 11.6c-1.05.41-1.04 1-.18 1.27l3.9 1.22 9.04-5.7c.43-.28.82-.13.5.15z",
  },
  discord: {
    label: "Discord",
    path: "M19.6 5.3A16.9 16.9 0 0 0 15.4 4l-.5 1a15.6 15.6 0 0 0-5.8 0l-.5-1a16.9 16.9 0 0 0-4.2 1.3C1.8 9.3 1.1 13.2 1.4 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.1 12.1 0 0 0 11.2 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3-11.7zM8.7 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z",
  },
  farcaster: { label: "Farcaster", path: "M5 3h14v18h-3v-8a4 4 0 0 0-8 0v8H5z" },
  website: {
    label: "Website",
    path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.7 15.7 0 0 0 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.2 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z",
  },
};

/** Small icon links to a token's socials. Clicks never bubble into the card they sit on. */
export function SocialLinks({ socials, size = 14 }: { socials?: Socials | null; size?: number }) {
  if (!socials) return null;
  const entries = (Object.keys(ICONS) as (keyof Socials)[]).filter((k) => socials[k]);
  if (entries.length === 0) return null;
  return (
    <span className="socials">
      {entries.map((k) => (
        <a
          key={k}
          className={`social ${k}`}
          href={socials[k]}
          target="_blank"
          rel="noreferrer noopener nofollow"
          title={ICONS[k].label}
          aria-label={ICONS[k].label}
          onClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
            <path d={ICONS[k].path} fill="currentColor" />
          </svg>
        </a>
      ))}
    </span>
  );
}
