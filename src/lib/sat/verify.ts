import { z } from "zod";
import { getPublicClient } from "../chain/client";
import { verifyMessage } from "./tiers";

const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_SKEW_MS = 2 * 60 * 1000;

export const ProofSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuedAt: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000),
});

export type HolderProof = z.infer<typeof ProofSchema>;

/**
 * Check that a recent signature of the SAT holder message came from the wallet
 * it names. Uses the chain client so smart-contract wallets (ERC-1271) work too.
 */
export async function verifyHolderProof(proof: HolderProof, now = Date.now()): Promise<`0x${string}`> {
  if (proof.issuedAt > now + MAX_SKEW_MS || now - proof.issuedAt > MAX_AGE_MS) throw new Error("This signature expired. Sign again.");
  const wallet = proof.wallet as `0x${string}`;
  const ok = await getPublicClient().verifyMessage({
    address: wallet,
    message: verifyMessage(wallet, proof.issuedAt),
    signature: proof.signature as `0x${string}`,
  });
  if (!ok) throw new Error("The signature does not match this wallet.");
  return wallet;
}
