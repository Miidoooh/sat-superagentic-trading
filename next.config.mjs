/** Optional imports inside wallet SDKs that are not installed and never run in SAT. */
const EMPTY = "./config/empty-module.js";
const x402 = [
  "core/client",
  "core/schemas",
  "core/server",
  "evm",
  "evm/auth-capture/client",
  "evm/batch-settlement/client",
  "evm/exact/client",
  "evm/exact/server",
  "evm/exact/v1/client",
  "evm/upto/client",
  "evm/upto/server",
  "express",
  "extensions/bazaar",
  "extensions/builder-code",
  "fetch",
  "svm/exact/client",
  "svm/exact/server",
  "svm/exact/v1/client",
  "svm/upto/client",
  "svm/upto/server",
].map((m) => `@x402/${m}`);
const optionalWalletDeps = [...x402, "@react-native-async-storage/async-storage", "pino-pretty"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    // A stray package-lock.json in the user folder would otherwise be taken as the workspace root.
    root: import.meta.dirname,
    resolveAlias: Object.fromEntries(optionalWalletDeps.map((m) => [m, EMPTY])),
  },
};

export default nextConfig;
