"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type EIP1193Provider,
  type PublicClient,
} from "viem";
import { ROBINHOOD_MAINNET } from "@/lib/chain/constants";
import type { TxStep } from "@/lib/trade/trade";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  symbol: string;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  chain: ChainInfo;
  options: WalletOption[];
  connecting: boolean;
  error: string;
  connect: (optionId?: string) => Promise<`0x${string}` | null>;
  disconnect: () => void;
  /** Send each step in order, waiting for it to confirm. Returns the tx hashes. */
  sendSteps: (
    steps: TxStep[],
    onStep?: (text: string, href?: string) => void,
    account?: `0x${string}`,
  ) => Promise<`0x${string}`[]>;
  reader: PublicClient;
}

const KEY = "sat:wallet";
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

function toViemChain(chain: ChainInfo) {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: chain.explorer } },
  });
}

interface Announce {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: EIP1193Provider;
}

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

export function WalletProvider({ chain: chainProp, children }: { chain?: ChainInfo | null; children: React.ReactNode }) {
  const chain = chainProp ?? DEFAULT_CHAIN;
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<WalletOption | null>(null);

  const reader = useMemo(
    () => createPublicClient({ chain: toViemChain(chain), transport: http(chain.rpcUrl, { batch: true }) }) as PublicClient,
    [chain],
  );

  // EIP-6963 lets several installed wallets announce themselves.
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent<Announce>).detail;
      found.set(info.rdns ?? info.uuid, { id: info.rdns ?? info.uuid, name: info.name, icon: info.icon, provider });
      setOptions([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = setTimeout(() => {
      const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (found.size === 0 && injected) {
        found.set("injected", { id: "injected", name: "Browser wallet", provider: injected });
        setOptions([...found.values()]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(legacy);
    };
  }, []);

  const attach = useCallback((option: WalletOption) => {
    const prev = active.current?.provider as (EIP1193Provider & { removeListener?: EIP1193Provider["removeListener"] }) | undefined;
    if (prev && prev !== option.provider) {
      prev.removeListener?.("accountsChanged", onAccounts);
      prev.removeListener?.("chainChanged", onChain);
    }
    active.current = option;
    option.provider.on?.("accountsChanged", onAccounts);
    option.provider.on?.("chainChanged", onChain);
    function onAccounts(accounts: string[]) {
      const next = (accounts[0] as `0x${string}` | undefined) ?? null;
      setAddress(next);
      if (!next) localStorage.removeItem(KEY);
    }
    function onChain(id: string) {
      setChainId(Number.parseInt(id, 16));
    }
  }, []);

  // Reconnect silently to the wallet used last time.
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (!saved || address) return;
    const option = options.find((o) => o.id === saved);
    if (!option) return;
    void (async () => {
      const accounts = (await option.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (!accounts[0]) return;
      attach(option);
      setAddress(accounts[0] as `0x${string}`);
      const id = (await option.provider.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
      if (id) setChainId(Number.parseInt(id, 16));
    })();
  }, [options, address, attach]);

  const connect = useCallback(
    async (optionId?: string) => {
      const option = options.find((o) => o.id === optionId) ?? options[0];
      if (!option) {
        setError("No browser wallet found. Install MetaMask, Rabby or another EVM wallet.");
        return null;
      }
      setConnecting(true);
      setError("");
      try {
        const accounts = (await option.provider.request({ method: "eth_requestAccounts" })) as string[];
        const next = (accounts[0] as `0x${string}` | undefined) ?? null;
        if (!next) throw new Error("The wallet did not share an account.");
        attach(option);
        setAddress(next);
        localStorage.setItem(KEY, option.id);
        const id = (await option.provider.request({ method: "eth_chainId" })) as string;
        setChainId(Number.parseInt(id, 16));
        return next;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [options, attach],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(KEY);
    setAddress(null);
    setChainId(null);
    active.current = null;
  }, []);

  const sendSteps = useCallback<WalletState["sendSteps"]>(
    async (steps, onStep, accountOverride) => {
      const option = active.current;
      const account = accountOverride ?? address;
      if (!option || !account) throw new Error("Connect a wallet first.");
      const viemChain = toViemChain(chain);
      const wallet = createWalletClient({ account, chain: viemChain, transport: custom(option.provider) });
      const current = Number.parseInt((await option.provider.request({ method: "eth_chainId" })) as string, 16);
      if (current !== chain.id) {
        try {
          await wallet.switchChain({ id: chain.id });
        } catch {
          await wallet.addChain({ chain: viemChain });
          await wallet.switchChain({ id: chain.id });
        }
        setChainId(chain.id);
      }
      const hashes: `0x${string}`[] = [];
      for (const step of steps) {
        onStep?.(`Confirm in wallet: ${step.label}`);
        const hash = await wallet.sendTransaction({
          account,
          chain: viemChain,
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
    [address, chain, reader],
  );

  const value = useMemo<WalletState>(
    () => ({ address, chainId, chain, options, connecting, error, connect, disconnect, sendSteps, reader }),
    [address, chainId, chain, options, connecting, error, connect, disconnect, sendSteps, reader],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
