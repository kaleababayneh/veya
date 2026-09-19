import { config } from "./config";

export type TokenInfo = { address: string; symbol: string; decimals: number; name: string };

export const TOKENS: TokenInfo[] = [
  { address: config.xlmSac, symbol: "XLM", decimals: 7, name: "Stellar Lumens (native)" },
  { address: config.usdcSac, symbol: "USDC", decimals: 7, name: "USD Coin (Circle testnet)" },
].filter((t) => t.address);

export const tokenByAddress = (addr: string): TokenInfo =>
  TOKENS.find((t) => t.address === addr) ?? { address: addr, symbol: addr.slice(0, 4) + "…", decimals: 7, name: addr };
