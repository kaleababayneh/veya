export const config = {
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  explorer: process.env.NEXT_PUBLIC_EXPLORER ?? "https://stellar.expert/explorer/testnet",
  escrowId: process.env.NEXT_PUBLIC_ESCROW_ID ?? "",
  verifierId: process.env.NEXT_PUBLIC_VERIFIER_ID ?? "",
  xlmSac: process.env.NEXT_PUBLIC_XLM_SAC ?? "",
  usdcSac: process.env.NEXT_PUBLIC_USDC_SAC ?? "",
  proverUrl: (process.env.NEXT_PUBLIC_PROVER_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  /** shared token the prover requires on POST /jobs (public in the bundle; it only deters drive-by abuse) */
  proverToken: process.env.NEXT_PUBLIC_PROVER_TOKEN ?? "",
  /** Google OAuth client id (Web application) for the browser-side Gmail fetch of the e-dekont; empty = manual upload only */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  /** minutes left on a lock below which the UI refuses to let the buyer start a bank payment */
  minMinutesToPay: 15,
};

export const txUrl = (hash: string) => `${config.explorer}/tx/${hash}`;
export const contractUrl = (id: string) => `${config.explorer}/contract/${id}`;
export const accountUrl = (id: string) => `${config.explorer}/account/${id}`;
