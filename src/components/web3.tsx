"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { connectorsForWallets, darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider } from "wagmi";
import { ROBINHOOD_MAINNET } from "@/lib/chain/constants";

export const robinhoodChain = defineChain({
  id: ROBINHOOD_MAINNET.chainId,
  name: ROBINHOOD_MAINNET.name,
  nativeCurrency: { name: "Ether", symbol: ROBINHOOD_MAINNET.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_MAINNET.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_MAINNET.explorerUrl } },
});

/**
 * WalletConnect (mobile wallets, QR codes) needs a free project id from
 * cloud.reown.com. Without one, only wallets installed in the browser are listed.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = connectorsForWallets(
  projectId
    ? [
        { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet] },
        { groupName: "More", wallets: [trustWallet, walletConnectWallet, injectedWallet] },
      ]
    : [{ groupName: "Browser wallets", wallets: [injectedWallet, rabbyWallet, coinbaseWallet] }],
  { appName: "SAT", projectId: projectId ?? "sat-browser-wallets-only" },
);

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors,
  transports: { [robinhoodChain.id]: http(ROBINHOOD_MAINNET.rpcUrl) },
  ssr: true,
});

const theme = darkTheme({
  accentColor: "#ccff00",
  accentColorForeground: "#000000",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});
theme.colors.modalBackground = "#0c1015";
theme.colors.modalBorder = "#1e2731";
theme.colors.profileForeground = "#0f141a";
theme.colors.connectButtonBackground = "#141a22";

export function Web3Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" initialChain={robinhoodChain} appInfo={{ appName: "SAT", learnMoreUrl: "https://sathood.xyz" }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
