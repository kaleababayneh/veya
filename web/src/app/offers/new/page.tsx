"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { escrow, getConfig, send, unwrapResult, explainError, ERROR_HELP, type EscrowConfig } from "@/lib/escrow";
import { TOKENS } from "@/lib/tokens";
import { fmtTRY, parseToken, parseTRY, nowSec } from "@/lib/format";
import { Alert, Button, Card, Field, inputCls, Spinner, TxLink, BackLink } from "@/components/ui";

export default function NewOffer() {
  const { address, connect, signTransaction } = useWallet();
  const router = useRouter();
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [token, setToken] = useState(TOKENS[0]?.address ?? "");
  const [amount, setAmount] = useState("100");
  const [tryAmount, setTryAmount] = useState("4000");
  const [iban, setIban] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState("");

  useEffect(() => {
    getConfig().then(setCfg).catch(() => {});
  }, []);

  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const t = TOKENS.find((x) => x.address === token);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!address) return connect();
    try {
      setBusy(true);
      const c = escrow(address, signTransaction);
      const tx = await c.create_offer({
        seller: address,
        token,
        amount: parseToken(amount, t?.decimals ?? 7),
        try_amount_kurus: parseTRY(tryAmount),
        iban: iban.replace(/\s+/g, "").toUpperCase(),
        seller_name: name.trim(),
        expires_at: BigInt(nowSec() + Number(days) * 86400),
      });
      const { result, hash } = await send(tx);
      const id = unwrapResult(result);
      setHash(hash);
      router.push(`/offers/${id.toString()}?created=${hash}`);
    } catch (e) {
      const m = explainError(e);
      setErr(ERROR_HELP[m] ? `${m}: ${ERROR_HELP[m]}` : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sell crypto for TRY</h1>
        <p className="mt-2 text-muted">
          Your tokens are locked in the escrow contract until a buyer proves a FAST transfer to your IBAN. You can withdraw any time while
          nobody has reserved the offer.
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
            <Field label={`Amount (${t?.symbol ?? ""})`} hint="Deposited into escrow now.">
              <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
            </Field>
          </div>
          <Field
            label="Price in TRY (buyer sends exactly this)"
            hint={cfg ? `Allowed on this deployment: ${fmtTRY(cfg.min_try_kurus)} – ${fmtTRY(cfg.max_try_kurus)}` : undefined}
          >
            <input className={inputCls} value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} inputMode="decimal" required />
          </Field>
        </Card>
        <Card className="space-y-4">
          <p className="text-sm font-semibold">Where the buyer pays</p>
          <Field label="Your IBAN (any Turkish bank)" hint="Stored on-chain in plain text so the buyer can pay you. TR + 24 digits.">
            <input className={`${inputCls} mono`} value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR33 0006 1005 1978 6457 8413 26" required />
          </Field>
          <Field label="Account holder name" hint="As printed on bank documents (the proof checks it; upper/lower case and Turkish letters do not matter).">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="AYŞE YILMAZ" required maxLength={64} />
          </Field>
          <Field label="Offer expires after (days)" hint="After expiry you can withdraw; buyers can no longer reserve.">
            <input className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" required />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I understand my IBAN and name will be publicly visible on Stellar testnet, and that the escrow releases automatically when a
              buyer proves a payment of at least the TRY amount to this IBAN. Protocol fee: {feeBps / 100}% of the token amount.
            </span>
          </label>
        </Card>
        {err && <Alert kind="error">{err}</Alert>}
        {hash && (
          <Alert kind="ok">
            Offer created. <TxLink hash={hash} />
          </Alert>
        )}
        <Button type="submit" disabled={busy || !consent} className="w-full">
          {busy ? (
            <>
              <Spinner /> Confirm in wallet…
            </>
          ) : address ? (
            `Deposit ${amount || "0"} ${t?.symbol ?? ""} and publish offer`
          ) : (
            "Connect wallet to continue"
          )}
        </Button>
      </form>
    </div>
  );
}
