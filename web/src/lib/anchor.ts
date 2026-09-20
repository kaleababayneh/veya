/**
 * SEP client for the Turkish anchor (default: DevRel's tr-mock-anchor.fly.dev; a real anchor is the same code with
 * another home domain). Everything runs in the browser with the connected wallet:
 *   SEP-1  discovery of the endpoints from the home domain's stellar.toml
 *   SEP-10 login: the wallet signs the anchor's challenge transaction → JWT (kept in sessionStorage per account)
 *   SEP-38 quotes: USD/TRY-derived USDC price with the anchor's spread
 *   SEP-6  deposit (TRY → USDC: bank instructions, then the anchor pays USDC) and withdraw (USDC → TRY: send USDC
 *          with a memo, the anchor pays TRY), plus transaction status
 * The sandbox has no bank: `simulateBankTransfer` plays it. On a real anchor that step is the actual FAST transfer.
 */
import { Asset, BASE_FEE, Horizon, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "./config";

export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC_SEP38 = `stellar:USDC:${USDC_ISSUER}`;
export const TRY_SEP38 = "iso4217:TRY";

export type AnchorToml = {
  homeDomain: string;
  WEB_AUTH_ENDPOINT: string;
  TRANSFER_SERVER: string;
  KYC_SERVER?: string;
  ANCHOR_QUOTE_SERVER?: string;
  SIGNING_KEY: string;
  NETWORK_PASSPHRASE: string;
  usdcIssuer: string;
};

export type Signer = (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string }>;

export const anchorConfigured = () => !!config.anchorHomeDomain;

let tomlCache: AnchorToml | null = null;

/** SEP-1: read the anchor's stellar.toml once. */
export async function discover(): Promise<AnchorToml> {
  if (tomlCache) return tomlCache;
  const homeDomain = config.anchorHomeDomain;
  if (!homeDomain) throw new Error("no anchor configured (NEXT_PUBLIC_ANCHOR_HOME_DOMAIN)");
  const res = await fetch(`https://${homeDomain}/.well-known/stellar.toml`, { cache: "no-store" });
  if (!res.ok) throw new Error(`stellar.toml: ${res.status}`);
  const text = await res.text();
  const get = (key: string) => new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m").exec(text)?.[1];
  const issuer = /\[\[CURRENCIES\]\][\s\S]*?code\s*=\s*"USDC"[\s\S]*?issuer\s*=\s*"([A-Z0-9]{56})"/m.exec(text)?.[1] ?? USDC_ISSUER;
  const t: AnchorToml = {
    homeDomain,
    WEB_AUTH_ENDPOINT: get("WEB_AUTH_ENDPOINT") ?? "",
    TRANSFER_SERVER: get("TRANSFER_SERVER") ?? "",
    KYC_SERVER: get("KYC_SERVER"),
    ANCHOR_QUOTE_SERVER: get("ANCHOR_QUOTE_SERVER"),
    SIGNING_KEY: get("SIGNING_KEY") ?? "",
    NETWORK_PASSPHRASE: get("NETWORK_PASSPHRASE") ?? config.networkPassphrase,
    usdcIssuer: issuer,
  };
  if (!t.WEB_AUTH_ENDPOINT || !t.TRANSFER_SERVER) throw new Error("stellar.toml lacks WEB_AUTH_ENDPOINT / TRANSFER_SERVER");
  tomlCache = t;
  return t;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const jwtExp = (token: string): number => {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return p.exp ?? 0;
  } catch {
    return 0;
  }
};

/** SEP-10: a session token for `address`; the wallet signs the challenge once, then the token is reused until it expires. */
export async function login(address: string, sign: Signer): Promise<string> {
  const t = await discover();
  const key = `zkotc-anchor-jwt-${t.homeDomain}-${address}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached && jwtExp(cached) > Date.now() / 1000 + 60) return cached;
  } catch {
    /* no storage */
  }
  const ch = await j<{ transaction: string; network_passphrase?: string }>(`${t.WEB_AUTH_ENDPOINT}?account=${encodeURIComponent(address)}`);
  const { signedTxXdr } = await sign(ch.transaction, { networkPassphrase: ch.network_passphrase ?? t.NETWORK_PASSPHRASE, address });
  const { token } = await j<{ token: string }>(t.WEB_AUTH_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transaction: signedTxXdr }) });
  try {
    sessionStorage.setItem(key, token);
  } catch {
    /* ignore */
  }
  return token;
}

export const forgetLogin = (address: string) => {
  try {
    if (tomlCache) sessionStorage.removeItem(`zkotc-anchor-jwt-${tomlCache.homeDomain}-${address}`);
  } catch {
    /* ignore */
  }
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// ───────────────────────────── SEP-38 ─────────────────────────────

export type Indicative = { price: string; buyAmountApprox: string };

/** Indicative USDC price in TRY (buying USDC with TRY) or TRY per USDC (selling USDC), no login needed. */
export async function indicativePrice(side: "buy" | "sell", amount: string): Promise<Indicative> {
  const t = await discover();
  if (!t.ANCHOR_QUOTE_SERVER) throw new Error("anchor has no quote server");
  const sell = side === "buy" ? TRY_SEP38 : USDC_SEP38;
  const r = await j<{ buy_assets: { asset: string; price: string }[] }>(`${t.ANCHOR_QUOTE_SERVER}/prices?sell_asset=${encodeURIComponent(sell)}&sell_amount=${encodeURIComponent(amount)}`);
  const want = side === "buy" ? USDC_SEP38 : TRY_SEP38;
  const hit = r.buy_assets.find((b) => b.asset === want) ?? r.buy_assets[0];
  if (!hit) throw new Error("no price for this pair");
  // SEP-38 prices are "units of sell_asset per one unit of buy_asset": TRY per USDC when buying USDC,
  // USDC per TRY when selling it — normalise both to TRY per USDC for display
  const raw = Number(hit.price);
  const tryPerUsdc = side === "buy" ? raw : 1 / raw;
  const approx = side === "buy" ? Number(amount) / raw : Number(amount) / raw;
  return { price: tryPerUsdc.toFixed(7), buyAmountApprox: approx.toFixed(side === "buy" ? 7 : 2) };
}

export type PriceResp = { total_price: string; price: string; sell_amount: string; buy_amount: string; fee?: { total: string; asset: string } };

/** Firm price for a sell amount (SEP-38 /price, needs login). */
export async function firmPrice(token: string, side: "buy" | "sell", sellAmount: string): Promise<PriceResp> {
  const t = await discover();
  const sell = side === "buy" ? TRY_SEP38 : USDC_SEP38;
  const buy = side === "buy" ? USDC_SEP38 : TRY_SEP38;
  return j<PriceResp>(`${t.ANCHOR_QUOTE_SERVER}/price?sell_asset=${encodeURIComponent(sell)}&buy_asset=${encodeURIComponent(buy)}&sell_amount=${encodeURIComponent(sellAmount)}&context=sep6`, { headers: bearer(token) });
}

// ───────────────────────────── SEP-12 ─────────────────────────────

/** Sandbox KYC: any PUT is accepted. A real anchor would ask for fields here. */
export async function kyc(token: string, account: string): Promise<void> {
  const t = await discover();
  if (!t.KYC_SERVER) return;
  await j(`${t.KYC_SERVER}/customer`, { method: "PUT", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ account }) }).catch(() => {});
}

// ───────────────────────────── SEP-6 ─────────────────────────────

export type Sep6Info = { deposit: Record<string, { enabled: boolean; min_amount?: number; max_amount?: number; fee_percent?: number }>; withdraw: Record<string, { enabled: boolean; min_amount?: number; max_amount?: number; fee_percent?: number }> };
export const info = async () => j<Sep6Info>(`${(await discover()).TRANSFER_SERVER}/info`);

export type DepositResp = {
  id: string;
  how?: string;
  eta?: number;
  instructions?: Record<string, { value: string; description?: string }>;
  extra_info?: { message?: string };
};

/** Start a TRY → USDC deposit; the anchor answers with the IBAN and the reference to write in the açıklama. */
export async function deposit(token: string, account: string, amountTry: string): Promise<DepositResp> {
  const t = await discover();
  const q = new URLSearchParams({ asset_code: "USDC", account, amount: amountTry, funding_method: "bank_account", type: "bank_account" });
  return j<DepositResp>(`${t.TRANSFER_SERVER}/deposit?${q}`, { headers: bearer(token) });
}

/** Sandbox only: play the bank. */
export async function simulateBankTransfer(id: string, amountTry: string): Promise<void> {
  const t = await discover();
  await j(`${t.TRANSFER_SERVER}/tx/${encodeURIComponent(id)}/simulate-bank-transfer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: amountTry }) });
}

export type WithdrawResp = { id: string; account_id: string; memo?: string; memo_type?: string; eta?: number; min_amount?: number; max_amount?: number; fee_percent?: number; extra_info?: { message?: string } };

/** Start a USDC → TRY withdrawal; the anchor answers with where to send the USDC and which memo to attach. */
export async function withdraw(token: string, amountUsdc: string): Promise<WithdrawResp> {
  const t = await discover();
  const q = new URLSearchParams({ asset_code: "USDC", type: "bank_account", amount: amountUsdc });
  return j<WithdrawResp>(`${t.TRANSFER_SERVER}/withdraw?${q}`, { headers: bearer(token) });
}

export type Sep6Tx = {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  status_eta?: number | null;
  message?: string | null;
  more_info_url?: string;
  amount_in?: string;
  amount_in_asset?: string;
  amount_out?: string;
  amount_out_asset?: string;
  amount_fee?: string;
  stellar_transaction_id?: string | null;
  started_at?: string;
  completed_at?: string | null;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
};

export async function transaction(token: string, id: string): Promise<Sep6Tx> {
  const t = await discover();
  const r = await j<{ transaction: Sep6Tx }>(`${t.TRANSFER_SERVER}/transaction?id=${encodeURIComponent(id)}`, { headers: bearer(token) });
  return r.transaction;
}

export async function transactions(token: string, limit = 10): Promise<Sep6Tx[]> {
  const t = await discover();
  const r = await j<{ transactions: Sep6Tx[] }>(`${t.TRANSFER_SERVER}/transactions?asset_code=USDC&limit=${limit}`, { headers: bearer(token) });
  return r.transactions;
}

export const FINAL = new Set(["completed", "error", "expired", "refunded", "no_market", "too_small", "too_large"]);

// ───────────────────────────── Stellar side (Horizon, classic ops) ─────────────────────────────

const horizon = () => new Horizon.Server(config.horizonUrl);
const usdcAsset = () => new Asset("USDC", USDC_ISSUER);

/** USDC balance of `address`, or null when there is no trustline (account missing counts as no trustline). */
export async function usdcBalance(address: string): Promise<string | null> {
  try {
    const a = await horizon().loadAccount(address);
    const b = a.balances.find((x) => "asset_code" in x && x.asset_code === "USDC" && "asset_issuer" in x && x.asset_issuer === USDC_ISSUER);
    return b ? b.balance : null;
  } catch {
    return null;
  }
}

async function submitSigned(address: string, sign: Signer, build: (b: TransactionBuilder) => TransactionBuilder): Promise<string> {
  const h = horizon();
  const acct = await h.loadAccount(address);
  const tx = build(new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })).setTimeout(120).build();
  const { signedTxXdr } = await sign(tx.toXDR(), { networkPassphrase: config.networkPassphrase, address });
  const res = await h.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase));
  return res.hash;
}

/** Add the USDC trustline (needed once before the anchor can pay USDC to the account). */
export const addUsdcTrustline = (address: string, sign: Signer) => submitSigned(address, sign, (b) => b.addOperation(Operation.changeTrust({ asset: usdcAsset() })));

/** Send USDC to the anchor with the withdrawal memo. */
export const sendUsdc = (address: string, sign: Signer, destination: string, amount: string, memo: string, memoType = "id") =>
  submitSigned(address, sign, (b) => {
    const m = memoType === "id" ? Memo.id(memo) : memoType === "hash" ? Memo.hash(memo) : Memo.text(memo);
    return b.addOperation(Operation.payment({ destination, asset: usdcAsset(), amount })).addMemo(m);
  });
