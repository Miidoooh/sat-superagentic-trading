"use client";

import { ConnectButton as RainbowConnect } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./wallet";

/** RainbowKit's connect flow in SAT's own top-bar style. */
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

  return (
    <RainbowConnect.Custom>
      {({ account, chain, openConnectModal, openChainModal, openAccountModal, mounted, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        if (!ready) return <div className="wallet-menu" aria-hidden style={{ opacity: 0, pointerEvents: "none" }} />;
        if (!account || !chain) {
          return (
            <button className="btn sm primary" onClick={openConnectModal}>
              Connect wallet
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button className="pill warn wallet-pill" onClick={openChainModal}>
              <span className="dot" />
              Switch to Robinhood Chain
            </button>
          );
        }
        return (
          <div className="wallet-menu" ref={ref}>
            <button className="pill ok wallet-pill" onClick={() => setOpen((o) => !o)}>
              {account.ensAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="wallet-avatar" src={account.ensAvatar} alt="" />
              ) : (
                <span className="dot" />
              )}
              {account.displayName}
              {account.displayBalance && <span className="dim">{account.displayBalance}</span>}
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
                    setOpen(false);
                    openAccountModal();
                  }}
                >
                  Wallet details
                </button>
                <button
                  className="wallet-opt"
                  onClick={() => {
                    void navigator.clipboard.writeText(account.address).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a className="wallet-opt" href={`${wallet.chain.explorer}/address/${account.address}`} target="_blank" rel="noreferrer noopener">
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
      }}
    </RainbowConnect.Custom>
  );
}
