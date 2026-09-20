"use client";
/**
 * The licensed rail: TRY ⇄ USDC through a Turkish anchor, driven by the standard SEPs from the browser
 * (SEP-1 discovery, SEP-10 login with the connected wallet, SEP-38 quotes, SEP-6 deposit/withdraw).
 * Same code against a real anchor: change NEXT_PUBLIC_ANCHOR_HOME_DOMAIN.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { config } from "@/lib/config";
import * as anchor from "@/lib/anchor";
import { Alert, BackLink, Button, Card, Field, Spinner, TxLink, inputCls } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Tab = "buy" | "sell";

export default function AnchorPage() {
  const { address, connect, signTransaction } = useWallet();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("buy");
  const [toml, setToml] = useState<anchor.AnchorToml | null>(null);
  const [info, setInfo] = useState<anchor.Sep6Info | null>(null);
  const [rate, setRate] = useState<{ buy: string; sell: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<anchor.Sep6Tx[]>([]);

  // buy
  const [tryAmount, setTryAmount] = useState("200");
  const [quote, setQuote] = useState<anchor.PriceResp | null>(null);
  const [dep, setDep] = useState<anchor.DepositResp | null>(null);
  // sell
  const [usdcAmount, setUsdcAmount] = useState("1");
  const [sellQuote, setSellQuote] = useState<anchor.PriceResp | null>(null);
  const [wd, setWd] = useState<anchor.WithdrawResp | null>(null);
  const [sentHash, setSentHash] = useState<string | null>(null);
  // status
  const [tx, setTx] = useState<anchor.Sep6Tx | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const sandbox = toml?.homeDomain.includes("mock") ?? false;

  useEffect(() => {
    if (!anchor.anchorConfigured()) return;
    anchor.discover().then(setToml).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    anchor.info().then(setInfo).catch(() => {});
    Promise.all([anchor.indicativePrice("buy", "100"), anchor.indicativePrice("sell", "1")])
      .then(([b, s]) => setRate({ buy: b.price, sell: s.price }))
      .catch(() => {});
  }, []);

  const refreshBalance = useCallback(() => {
    if (!address) return;
    anchor.usdcBalance(address).then(setBalance);
  }, [address]);
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const refreshHistory = useCallback((t: string) => {
    anchor.transactions(t, 8).then(setHistory).catch(() => {});
  }, []);

  const signIn = async () => {
    if (!address) return connect();
    setErr(null);
    try {
      setBusy("Sign the anchor's challenge in your wallet…");
      const t = await anchor.login(address, signTransaction);
      await anchor.kyc(t, address);
      setToken(t);
      refreshHistory(t);
      toast({ kind: "ok", title: "Signed in to the anchor", body: "SEP-10: your wallet signature is your identity. No password, no e-mail." });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // live quotes as the amounts change
  useEffect(() => {
    if (!token || tab !== "buy" || !(Number(tryAmount) > 0)) return setQuote(null);
    const h = setTimeout(() => anchor.firmPrice(token, "buy", Number(tryAmount).toFixed(2)).then(setQuote).catch(() => setQuote(null)), 300);
    return () => clearTimeout(h);
  }, [token, tab, tryAmount]);
  useEffect(() => {
    if (!token || tab !== "sell" || !(Number(usdcAmount) > 0)) return setSellQuote(null);
    const h = setTimeout(() => anchor.firmPrice(token, "sell", Number(usdcAmount).toFixed(7)).then(setSellQuote).catch(() => setSellQuote(null)), 300);
    return () => clearTimeout(h);
  }, [token, tab, usdcAmount]);

  // status polling for the current transaction
  const watch = useCallback(
    (id: string) => {
      if (!token) return;
      if (poll.current) clearInterval(poll.current);
      const tick = () =>
        anchor.transaction(token, id).then((t) => {
          setTx(t);
          if (anchor.FINAL.has(t.status)) {
            if (poll.current) clearInterval(poll.current);
            refreshBalance();
            refreshHistory(token);
            if (t.status === "completed") toast({ kind: "ok", title: t.kind === "deposit" ? `${t.amount_out} USDC received` : `${t.amount_out} TRY paid to your bank`, body: t.stellar_transaction_id ? <TxLink hash={t.stellar_transaction_id} /> : t.message });
          }
        }).catch(() => {});
      tick();
      poll.current = setInterval(tick, 3000);
    },
    [token, refreshBalance, refreshHistory, toast],
  );
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const startDeposit = async () => {
    if (!token || !address) return;
    setErr(null);
    try {
      setBusy("Asking the anchor for bank instructions…");
      const d = await anchor.deposit(token, address, Number(tryAmount).toFixed(2));
      setDep(d);
      setTx(null);
      watch(d.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const simulate = async () => {
    if (!dep) return;
    setErr(null);
    try {
      setBusy("Simulating the bank transfer (sandbox)…");
      await anchor.simulateBankTransfer(dep.id, Number(tryAmount).toFixed(2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const trustline = async () => {
    if (!address) return;
    setErr(null);
    try {
      setBusy("Confirm the USDC trustline in your wallet…");
      const h = await anchor.addUsdcTrustline(address, signTransaction);
      toast({ kind: "ok", title: "USDC trustline added", body: <TxLink hash={h} /> });
      refreshBalance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startWithdraw = async () => {
    if (!token) return;
    setErr(null);
    try {
      setBusy("Asking the anchor where to send the USDC…");
      const w = await anchor.withdraw(token, Number(usdcAmount).toFixed(7));
      setWd(w);
      setSentHash(null);
      setTx(null);
      watch(w.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sendUsdc = async () => {
    if (!wd || !address) return;
    setErr(null);
    try {
      setBusy("Confirm the USDC payment in your wallet…");
      const h = await anchor.sendUsdc(address, signTransaction, wd.account_id, Number(usdcAmount).toFixed(7), String(wd.memo ?? ""), wd.memo_type ?? "id");
      setSentHash(h);
      toast({ kind: "ok", title: "USDC sent to the anchor", body: <TxLink hash={h} /> });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setDep(null);
    setWd(null);
    setTx(null);
    setSentHash(null);
    if (poll.current) clearInterval(poll.current);
  };

  if (!anchor.anchorConfigured()) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert kind="warn">No anchor configured on this deployment (NEXT_PUBLIC_ANCHOR_HOME_DOMAIN).</Alert>
      </div>
    );
  }

  const limits = (kind: "deposit" | "withdraw") => info?.[kind]?.USDC;

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">For makers · the licensed rail</p>
          <h1 className="text-3xl font-semibold tracking-tight">Fund inventory and cash out through a Turkish anchor</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Buyers never need this page: the peer market settles on a proof of their bank receipt, no KYC, no custodian. Makers do: after selling
            USDC for lira you hold TRY in the bank and no inventory, and this is where you refill it, or cash USDC out to your bank. A regulated
            anchor with KYC and a spread over the USD/TRY oracle rate, whose price is what your ads compete with. Driven by the Stellar standards
            (SEP-1, SEP-10, SEP-6, SEP-38), so the same code works against any real anchor.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">{toml?.homeDomain ?? config.anchorHomeDomain}{sandbox ? " · testnet sandbox" : ""}</p>
          {rate ? (
            <p className="mt-1">
              buy USDC at <b>₺{Number(rate.buy).toFixed(2)}</b> · sell at <b>₺{Number(rate.sell).toFixed(2)}</b>
            </p>
          ) : (
            <p className="mt-1 text-muted">loading rate…</p>
          )}
        </div>
      </div>

      {err && <Alert kind="error">{err}</Alert>}

      {!token ? (
        <Card className="space-y-3">
          <p className="font-medium">Step 1 · Sign in to the anchor with your wallet</p>
          <p className="text-sm text-muted">SEP-10: the anchor sends a challenge transaction, your wallet signs it (nothing is submitted), and you get a session. Your key is your identity.</p>
          <Button onClick={signIn} disabled={!!busy}>{busy ? <><Spinner /> {busy}</> : address ? "Sign in with this wallet" : "Connect wallet"}</Button>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {(["buy", "sell"] as Tab[]).map((t) => (
              <button key={t} type="button" onClick={() => { setTab(t); reset(); }} className={`rounded-lg border px-3 py-1.5 text-sm ${tab === t ? "border-accent bg-accent/10 font-medium" : "border-line text-muted hover:text-fg"}`}>
                {t === "buy" ? "Fund inventory: TRY → USDC" : "Cash out: USDC → TRY"}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted">
              USDC balance: {balance === undefined ? "…" : balance === null ? "no trustline" : balance}
              {balance === null && <> · <button className="underline" onClick={trustline} disabled={!!busy}>add USDC trustline</button></>}
            </span>
          </div>

          {tab === "buy" && (
            <Card className="space-y-4">
              {!dep ? (
                <>
                  <Field label="You pay (TRY by bank transfer)" hint={limits("deposit") ? `min ₺${limits("deposit")!.min_amount ?? "?"} · fee ${limits("deposit")!.fee_percent ?? 0}%` : undefined}>
                    <input className={inputCls} value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} inputMode="decimal" />
                  </Field>
                  {quote && (
                    <p className="text-sm">
                      You receive about <b>{Number(quote.buy_amount).toFixed(4)} USDC</b> at ₺{Number(quote.total_price).toFixed(4)} per USDC
                      {quote.fee && <span className="text-muted"> (includes a {quote.fee.total} {quote.fee.asset.replace("iso4217:", "")} spread)</span>}
                    </p>
                  )}
                  <Button onClick={startDeposit} disabled={!!busy || !(Number(tryAmount) > 0)}>{busy ? <><Spinner /> {busy}</> : "Start deposit"}</Button>
                </>
              ) : (
                <>
                  <p className="font-medium">Step 2 · Send the TRY to the anchor&apos;s bank account</p>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <dl className="divide-y divide-line text-sm">
                      {Object.entries(dep.instructions ?? {}).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <dt className="text-muted">{v.description ?? k}</dt>
                          <dd className="mono select-all">{v.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  {sandbox && (
                    <div className="rounded-xl bg-panel-2 p-3 text-sm">
                      <p className="text-muted">This anchor is a sandbox with no real bank. On a real anchor you would now send the FAST; here, you play the bank:</p>
                      <Button className="mt-2" onClick={simulate} disabled={!!busy || (!!tx && tx.status !== "pending_user_transfer_start")}>{busy ? <><Spinner /> {busy}</> : "Simulate the bank transfer"}</Button>
                    </div>
                  )}
                  <Status tx={tx} onTrustline={balance === null ? trustline : undefined} busy={busy} />
                  <button className="text-xs text-muted underline" onClick={reset}>Start another</button>
                </>
              )}
            </Card>
          )}

          {tab === "sell" && (
            <Card className="space-y-4">
              {!wd ? (
                <>
                  <Field label="You send (USDC from your wallet)" hint={limits("withdraw") ? `min ${limits("withdraw")!.min_amount ?? "?"} USDC · fee ${limits("withdraw")!.fee_percent ?? 0}% · TRY is paid to the bank account on file at the anchor` : undefined}>
                    <input className={inputCls} value={usdcAmount} onChange={(e) => setUsdcAmount(e.target.value)} inputMode="decimal" />
                  </Field>
                  {sellQuote && (
                    <p className="text-sm">
                      You get about <b>₺{Number(sellQuote.buy_amount).toFixed(2)}</b> at ₺{Number(sellQuote.total_price).toFixed(4)} per USDC
                    </p>
                  )}
                  {balance === null && <Alert kind="warn">This wallet has no USDC trustline yet, so it holds no USDC to sell.</Alert>}
                  <Button onClick={startWithdraw} disabled={!!busy || !(Number(usdcAmount) > 0) || balance === null}>{busy ? <><Spinner /> {busy}</> : "Start withdrawal"}</Button>
                </>
              ) : (
                <>
                  <p className="font-medium">Step 2 · Send the USDC to the anchor with this memo</p>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <dl className="divide-y divide-line text-sm">
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Destination</dt><dd className="mono select-all">{wd.account_id}</dd></div>
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Memo ({wd.memo_type})</dt><dd className="mono select-all">{wd.memo}</dd></div>
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Amount</dt><dd>{Number(usdcAmount).toFixed(7)} USDC</dd></div>
                    </dl>
                  </div>
                  {wd.extra_info?.message && <p className="text-xs text-muted">{wd.extra_info.message}</p>}
                  {!sentHash ? (
                    <Button onClick={sendUsdc} disabled={!!busy}>{busy ? <><Spinner /> {busy}</> : "Send USDC from my wallet"}</Button>
                  ) : (
                    <p className="text-sm text-ok">✓ Sent: <TxLink hash={sentHash} /></p>
                  )}
                  <Status tx={tx} busy={busy} />
                  <button className="text-xs text-muted underline" onClick={reset}>Start another</button>
                </>
              )}
            </Card>
          )}

          {history.length > 0 && (
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your anchor transactions</p>
              <ul className="mt-2 divide-y divide-line text-sm">
                {history.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{t.kind === "deposit" ? "Deposit" : "Withdrawal"} · {t.amount_in} {t.amount_in_asset?.replace("iso4217:", "").replace(/^stellar:USDC.*/, "USDC")} → {t.amount_out} {t.amount_out_asset?.replace("iso4217:", "").replace(/^stellar:USDC.*/, "USDC")}</span>
                    <span className="text-xs text-muted">{t.status}{t.stellar_transaction_id && <> · <TxLink hash={t.stellar_transaction_id} label="tx" /></>}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        Buying, not making? <Link className="underline" href="/">The peer market</Link> is the door for you: pay a maker by FAST and settle with a proof of your bank receipt, no KYC.
        Got USDC now? <Link className="underline" href="/sell">Post an ad</Link> priced under the anchor&apos;s rate and let buyers come to you.
      </p>
    </div>
  );
}

function Status({ tx, onTrustline, busy }: { tx: anchor.Sep6Tx | null; onTrustline?: () => void; busy: string | null }) {
  if (!tx) return <p className="text-sm text-muted"><Spinner /> Waiting for the anchor…</p>;
  const label: Record<string, string> = {
    pending_user_transfer_start: "Waiting for your bank transfer",
    pending_external: "Bank transfer in flight",
    pending_anchor: "Anchor received the funds, paying out",
    pending_stellar: "Paying on Stellar",
    pending_trust: "Waiting for your USDC trustline",
    pending_user: "Waiting for you",
    completed: "Completed",
    error: "Failed",
    expired: "Expired",
  };
  return (
    <div className={`rounded-xl p-3 text-sm ${tx.status === "completed" ? "bg-ok/10" : tx.status === "error" || tx.status === "expired" ? "bg-danger/10" : "bg-panel-2"}`}>
      <p className="font-medium">{label[tx.status] ?? tx.status}</p>
      {tx.message && <p className="text-muted">{tx.message}</p>}
      {tx.status === "completed" && (
        <p className="mt-1">
          {tx.amount_in} → <b>{tx.amount_out}</b>{tx.stellar_transaction_id && <> · <TxLink hash={tx.stellar_transaction_id} /></>}
        </p>
      )}
      {tx.status === "pending_trust" && onTrustline && (
        <Button className="mt-2" onClick={onTrustline} disabled={!!busy}>Add the USDC trustline</Button>
      )}
    </div>
  );
}
