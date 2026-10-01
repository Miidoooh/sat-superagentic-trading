"use client";

import { useEffect, useRef, useState } from "react";
import { shortAddr } from "./follows";
import { useWallet } from "./wallet";

export default function ConnectButton({ onPortfolio }: { onPortfolio: () => void }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const wrongChain = wallet.address && wallet.chainId !== null && wallet.chainId !== wallet.chain.id;

  if (!wallet.address) {
    const many = wallet.options.length > 1;
    return (
      <div className="wallet-menu" ref={ref}>
        <button
          className="btn sm primary"
          disabled={wallet.connecting}
          onClick={() => (many ? setOpen((o) => !o) : void wallet.connect())}
        >
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {open && (
          <div className="wallet-pop">
            {wallet.options.map((o) => (
              <button
                key={o.id}
                className="wallet-opt"
                onClick={() => {
                  setOpen(false);
                  void wallet.connect(o.id);
                }}
              >
                {o.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.icon} alt="" />
                )}
                {o.name}
              </button>
            ))}
          </div>
        )}
        {wallet.error && !open && <div className="wallet-error">{wallet.error}</div>}
      </div>
    );
  }

  return (
    <div className="wallet-menu" ref={ref}>
      <button className={`pill wallet-pill ${wrongChain ? "warn" : "ok"}`} onClick={() => setOpen((o) => !o)}>
        <span className="dot" />
        {shortAddr(wallet.address)}
        {wrongChain && " · switch network"}
      </button>
      {open && (
        <div className="wallet-pop">
          <button
            className="wallet-opt"
            onClick={() => {
              setOpen(false);
              onPortfolio();
            }}
          >
            My portfolio
          </button>
          <button
            className="wallet-opt"
            onClick={() => {
              void navigator.clipboard.writeText(wallet.address!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <a className="wallet-opt" href={`${wallet.chain.explorer}/address/${wallet.address}`} target="_blank" rel="noreferrer noopener">
            View on explorer ↗
          </a>
          <button
            className="wallet-opt"
            onClick={() => {
              setOpen(false);
              wallet.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
