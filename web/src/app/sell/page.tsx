"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { escrow, getConfig, payeeHashHex, send, unwrapResult, explainError, ERROR_HELP, type EscrowConfig } from "@/lib/escrow";
import { sealPayee } from "@/lib/reveal";
import { TOKENS } from "@/lib/tokens";
import { fmtTRY, parseToken, parseTRY, nowSec, bytesToHex } from "@/lib/format";
import { Alert, Button, Card, Field, inputCls, Spinner, TxLink, BackLink } from "@/components/ui";

export default function Sell() {
  const { address, connect, signTransaction } = useWallet();
  const router = useRouter();
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [token, setToken] = useState(TOKENS[0]?.address ?? "");
  const [amount, setAmount] = useState("500");
  const [price, setPrice] = useState("");
  const [minTry, setMinTry] = useState("");
  const [maxTry, setMaxTry] = useState("");
  const [iban, setIban] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [days, setDays] = useState("30");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState("");

  useEffect(() => {
    getConfig().then((c) => {
      setCfg(c);
      setMinTry((s) => s || (Number(c.min_try_kurus) / 100).toFixed(0));
      setMaxTry((s) => s || (Number(c.max_try_kurus) / 100).toFixed(0));
    }).catch(() => {});
  }, []);

  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const bondBps = cfg ? Number(cfg.bond_bps) : 500;
  const t = TOKENS.find((x) => x.address === token);
  const amountNum = Number(amount) || 0;
  const bondNum = Math.ceil(amountNum * bondBps) / 10000;
  const priceNum = Number(price.replace(",", ".")) || 0;
  const fmtN = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 7 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!address) return connect();
    if (!cfg) return setErr("Escrow configuration not loaded yet");
    try {
      setBusy("Encrypting payee details…");
      const cleanIban = iban.replace(/\s+/g, "").toUpperCase();
      const cleanName = name.trim();
      const [hashHex, blob] = await Promise.all([payeeHashHex(cleanIban, cleanName), sealPayee({ iban: cleanIban, name: cleanName }, bytesToHex(cfg.reveal_pubkey))]);
      setBusy("Confirm in wallet…");
      const c = escrow(address, signTransaction);
      const tx = await c.create_ad({
        seller: address,
        token,
        amount: parseToken(amount, t?.decimals ?? 7),
        price_kurus: parseTRY(price),
        min_try_kurus: parseTRY(minTry),
        max_try_kurus: parseTRY(maxTry),
        payee_hash: Buffer.from(hashHex, "hex"),
        payee_blob: Buffer.from(blob),
        nickname: nickname.trim(),
        expires_at: BigInt(nowSec() + Number(days) * 86400),
      });
      const { result, hash } = await send(tx);
      const id = unwrapResult(result);
      setHash(hash);
      router.push(`/ads/${id.toString()}`);
    } catch (e) {
      const m = explainError(e);
      const key = Object.keys(ERROR_HELP).find((k) => m.startsWith(k));
      setErr(key ? `${m}: ${ERROR_HELP[key]}` : m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Post an ad: sell crypto for TRY</h1>
        <p className="mt-2 text-muted">
          Deposit liquidity once, set your price and trade sizes. Buyers reserve slices, pay you by FAST and settle with a proof of the bank e-mail.
          Withdraw the unreserved part any time.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Token">
              <select className={inputCls} value={token} onChange={(e) => setToken(e.target.value)}>
                {TOKENS.map((tk) => (
                  <option key={tk.address} value={tk.address}>
                    {tk.symbol} — {tk.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Liquidity (${t?.symbol ?? ""})`} hint={`Deposited now, plus a ${bondBps / 100}% bond (${fmtN(bondNum)} ${t?.symbol ?? ""}) that backs your reservations and comes back as they complete.`}>
              <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
            </Field>
          </div>
          <Field label={`Price (₺ per ${t?.symbol ?? "token"})`} hint={priceNum > 0 ? `Your ${fmtN(amountNum)} ${t?.symbol} is worth ${fmtTRY(Math.round(amountNum * priceNum * 100))} at this price. You can change it later; taken reservations keep their price.` : "Buyers pay exactly this rate. You can change it later."}>
            <input className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="42,50" inputMode="decimal" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Min per trade (₺)" hint={cfg ? `At least ${fmtTRY(cfg.min_try_kurus)}` : undefined}>
              <input className={inputCls} value={minTry} onChange={(e) => setMinTry(e.target.value)} inputMode="decimal" required />
            </Field>
            <Field label="Max per trade (₺)" hint={cfg ? `At most ${fmtTRY(cfg.max_try_kurus)} on this deployment` : undefined}>
              <input className={inputCls} value={maxTry} onChange={(e) => setMaxTry(e.target.value)} inputMode="decimal" required />
            </Field>
          </div>
        </Card>
        <Card className="space-y-4">
          <p className="text-sm font-semibold">Where buyers pay you</p>
          <Field label="Your IBAN (any Turkish bank)" hint="Encrypted before it leaves your browser; stored on-chain only as ciphertext and a hash. Revealed to a buyer after they reserve.">
            <input className={`${inputCls} mono`} value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR33 0006 1005 1978 6457 8413 26" required />
          </Field>
          <Field label="Account holder name" hint="Exactly as your bank shows it — the proof checks it (upper/lower case and Turkish letters do not matter).">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="AYŞE YILMAZ" required maxLength={64} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nickname (public)" hint="Shown in the market instead of your bank details.">
              <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="ayse" maxLength={24} />
            </Field>
            <Field label="Ad runs for (days)" hint="No new reservations after that; you can close it earlier.">
              <input className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" required />
            </Field>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              My IBAN and name are encrypted to the market&apos;s reveal service and shown only to buyers who hold a reservation on my ad (and to the
              service operator). Only a hash goes on-chain in the clear. The escrow pays a buyer automatically when they prove a FAST transfer of the
              reserved amount to this IBAN with my payment reference. Protocol fee: {feeBps / 100}% of the tokens. My {bondBps / 100}% bond is forfeited only
              for a reservation I let be released after the buyer declared a payment they then prove within {cfg ? Math.round(Number(cfg.late_claim_window) / 86400) : 3} days.
            </span>
          </label>
        </Card>
        {err && <Alert kind="error">{err}</Alert>}
        {hash && (
          <Alert kind="ok">
            Ad posted. <TxLink hash={hash} />
          </Alert>
        )}
        <Button type="submit" disabled={!!busy || !consent} className="w-full">
          {busy ? (
            <>
              <Spinner /> {busy}
            </>
          ) : address ? (
            `Deposit ${fmtN(amountNum)} + ${fmtN(bondNum)} bond ${t?.symbol ?? ""} and post the ad`
          ) : (
            "Connect wallet to continue"
          )}
        </Button>
      </form>
    </div>
  );
}
