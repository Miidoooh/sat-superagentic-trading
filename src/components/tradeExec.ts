import type { BuiltTrade, TradeIntent } from "@/lib/trade/trade";
import { rememberTraded, type useWallet } from "./wallet";

type Wallet = ReturnType<typeof useWallet>;
type Log = (text: string, href?: string) => void;

/**
 * Connect if needed, have the server build the trade for this wallet, and sign
 * each step. ERC-20 approvals come back on their own first; once confirmed the
 * trade is rebuilt so the minimum-out comes from a simulation of the real wallet.
 */
export async function executeTrade(intent: TradeIntent, wallet: Wallet, log: Log): Promise<BuiltTrade> {
  const account = wallet.address ?? (await wallet.connect());
  if (!account) throw new Error("Wallet connection was cancelled, or no browser wallet was found.");
  for (let round = 0; round < 2; round++) {
    log(round === 0 ? "Checking the trade against live contracts…" : "Approval confirmed. Re-quoting from your wallet…");
    const res = await fetch("/api/trade/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, wallet: account }),
    });
    const built = (await res.json()) as BuiltTrade | { error: string };
    if (!res.ok || "error" in built) throw new Error("error" in built ? built.error : "Could not build this trade");
    await wallet.sendSteps(built.steps, log, account);
    if (!built.needsRebuild) {
      rememberTraded(intent.token);
      return built;
    }
  }
  throw new Error("The approval did not take effect. Try again.");
}
