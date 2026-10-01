"use client";

import { useState } from "react";

interface Props {
  address: string;
  token: string;
  symbol: string;
  pnlUsd: number | null;
  onClose: () => void;
}

/** Preview and share a position's PnL card. The image is rendered from chain data. */
export default function ShareCard({ address, token, symbol, pnlUsd, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://sathood.xyz";
  const page = `${origin}/share/${address}/${token}`;
  const image = `/api/card/pnl?address=${address}&token=${token}`;
  const up = (pnlUsd ?? 0) >= 0;
  const text = up ? `My $${symbol} position, tracked live on @sat_hood 📈` : `Taking notes on $${symbol} with @sat_hood on Robinhood Chain`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${page}?ref=${address}`)}`;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="share-modal" role="dialog" aria-label="Share PnL card">
        <div className="alerts-row">
          <strong>Share your {symbol} PnL</strong>
          <div className="spacer" />
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={`share-preview ${loaded ? "" : "is-loading"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`${symbol} PnL card`} onLoad={() => setLoaded(true)} />
        </div>
        <div className="share-actions">
          <a className="btn primary" href={intent} target="_blank" rel="noreferrer noopener">
            Post on X
          </a>
          <button
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(page).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <a className="btn ghost" href={image} download={`sat-${symbol}-pnl.png`}>
            Download
          </a>
        </div>
        <div className="dim alerts-note">The card links back to SAT with your wallet as the referrer.</div>
      </div>
    </>
  );
}
