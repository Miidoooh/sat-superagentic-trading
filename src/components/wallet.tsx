"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { useAccount, useConfig, useDisconnect } from "wagmi";
import { getAccount, sendTransaction, signMessage as wagmiSignMessage, switchChain } from "wagmi/actions";
import { ROBINHOOD_MAINNET } from "@/lib/chain/constants";
import type { TxStep } from "@/lib/trade/trade";
import { Web3Providers } from "./web3";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  symbol: string;
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  chain: ChainInfo;
  connecting: boolean;
  error: string;
  /** Opens the RainbowKit wallet picker; resolves with the account, or null if the user closes it. */
  connect: () => Promise<`0x${string}` | null>;
  disconnect: () => void;
  /** Send each step in order, waiting for it to confirm. Returns the tx hashes. */
  sendSteps: (
    steps: TxStep[],
    onStep?: (text: string, href?: string) => void,
    account?: `0x${string}`,
  ) => Promise<`0x${string}`[]>;
  /** personal_sign with the connected account. Free, moves no funds. */
  signMessage: (message: string) => Promise<`0x${string}`>;
  reader: PublicClient;
}

const TRADED_KEY = "sat:traded-tokens";
export const TRADED_EVENT = "sat:traded";

const DEFAULT_CHAIN: ChainInfo = {
  id: ROBINHOOD_MAINNET.chainId,
  name: ROBINHOOD_MAINNET.name,
  rpcUrl: ROBINHOOD_MAINNET.rpcUrl,
  explorer: ROBINHOOD_MAINNET.explorerUrl,
  symbol: ROBINHOOD_MAINNET.nativeSymbol,
};

const Ctx = createContext<WalletState | null>(null);

/** Tokens bought or sold through SAT, so the portfolio can include them. */
export function tradedTokens(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(TRADED_KEY) ?? "[]") as string[]).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  } catch {
    return [];
  }
}

export function rememberTraded(token: string): void {
  const next = [token.toLowerCase(), ...tradedTokens().filter((t) => t !== token.toLowerCase())].slice(0, 60);
  localStorage.setItem(TRADED_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(TRADED_EVENT));
}

export function WalletProvider({ chain, children }: { chain?: ChainInfo | null; children: React.ReactNode }) {
  return (
    <Web3Providers>
      <WalletBridge chain={chain ?? DEFAULT_CHAIN}>{children}</WalletBridge>
    </Web3Providers>
  );
}

/** Adapts wagmi + RainbowKit to the wallet API the rest of SAT uses. */
function WalletBridge({ chain, children }: { chain: ChainInfo; children: React.ReactNode }) {
  const config = useConfig();
  const account = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const [error, setError] = useState("");
  const pending = useRef<((a: `0x${string}` | null) => void) | null>(null);
  const wasOpen = useRef(false);
  const address = account.address ?? null;

  const reader = useMemo(
    () =>
      createPublicClient({
        chain: defineChain({
          id: chain.id,
          name: chain.name,
          nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
          rpcUrls: { default: { http: [chain.rpcUrl] } },
        }),
        transport: http(chain.rpcUrl, { batch: true }),
      }) as PublicClient,
    [chain],
  );

  // Settle a pending connect() once an account appears, or when the picker closes without one.
  useEffect(() => {
    if (address && pending.current) {
      pending.current(address);
      pending.current = null;
    }
  }, [address]);
  useEffect(() => {
    if (wasOpen.current && !connectModalOpen && !address && pending.current) {
      pending.current(null);
      pending.current = null;
    }
    wasOpen.current = connectModalOpen;
  }, [connectModalOpen, address]);

  const connect = useCallback(async () => {
    if (address) return address;
    if (!openConnectModal) {
      setError("The wallet picker is still loading. Try again in a moment.");
      return null;
    }
    setError("");
    pending.current?.(null);
    return new Promise<`0x${string}` | null>((resolve) => {
      pending.current = resolve;
      openConnectModal();
    });
  }, [address, openConnectModal]);

  const disconnect = useCallback(() => wagmiDisconnect(), [wagmiDisconnect]);

  const sendSteps = useCallback<WalletState["sendSteps"]>(
    async (steps, onStep, accountOverride) => {
      const from = accountOverride ?? address;
      if (!from) throw new Error("Connect a wallet first.");
      if (getAccount(config).chainId !== chain.id) {
        onStep?.(`Switch your wallet to ${chain.name}`);
        await switchChain(config, { chainId: chain.id });
      }
      const hashes: `0x${string}`[] = [];
      for (const step of steps) {
        onStep?.(`Confirm in wallet: ${step.label}`);
        const hash = await sendTransaction(config, {
          account: from,
          chainId: chain.id,
          to: step.to,
          data: step.data,
          value: BigInt(step.value),
        });
        const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
        onStep?.(`Confirmed ${hash.slice(0, 10)}…`, `${chain.explorer}/tx/${hash}`);
        hashes.push(hash);
      }
      return hashes;
    },
    [address, chain, config, reader],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address) throw new Error("Connect a wallet first.");
      return wagmiSignMessage(config, { account: address, message });
    },
    [address, config],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId: account.chainId ?? null,
      chain,
      connecting: account.isConnecting || account.isReconnecting,
      error,
      connect,
      disconnect,
      sendSteps,
      signMessage,
      reader,
    }),
    [address, account.chainId, account.isConnecting, account.isReconnecting, chain, error, connect, disconnect, sendSteps, signMessage, reader],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
