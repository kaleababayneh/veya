"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ReservationStatus, AdStatus } from "@/contracts/escrow";
import { useWallet } from "@/lib/wallet";
import { escrow, getAd, getReservation, getConfig, send, unwrapResult, explainError, ERROR_HELP, type Ad, type Reservation, type EscrowConfig } from "@/lib/escrow";
import { requestReveal, type Revealed } from "@/lib/reveal";
import { createJob, getJob, fileToBase64, JOB_STEPS, proverInfo, type ProverJob, type ProverInfo } from "@/lib/prover";
import { tokenByAddress } from "@/lib/tokens";
import { fmtToken, fmtTRY, fmtIBAN, fmtDate, fmtYmd, istanbulYmd, nowSec, short, hexToBuffer, bytesToHex, paymentReference } from "@/lib/format";
import { config } from "@/lib/config";
import { Alert, BackLink, Button, Card, ReservationBadge, Spinner, Steps, TxLink } from "@/components/ui";
import { Countdown } from "@/components/Countdown";

export default function ReservationPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = useMemo(() => BigInt(idParam), [idParam]);
  const search = useSearchParams();
  const { address, connect, signTransaction, signMessage } = useWallet();

  const [r, setR] = useState<Reservation | null>(null);
  const [ad, setAd] = useState<Ad | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [info, setInfo] = useState<ProverInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: string } | null>(
    search.get("reserved") ? { label: "Reserved", hash: search.get("reserved")! } : null,
  );
  const [now, setNow] = useState(nowSec());
  const [payee, setPayee] = useState<Revealed | null>(null);
  const [revealing, setRevealing] = useState(false);

  const refresh = useCallback(
    () =>
      getReservation(id)
        .then((res) => getAd(res.ad_id).then((a) => [res, a] as const))
        .then(
          ([res, a]) => {
            setR(res);
            setAd(a);
            setErr(null);
          },
          (e) => setErr(explainError(e)),
        ),
    [id],
  );

  useEffect(() => {
    refresh();
    getConfig().then(setCfg).catch(() => {});
    proverInfo().then(setInfo).catch(() => setInfo(null));
    const t = setInterval(() => {
      refresh();
      proverInfo().then(setInfo).catch(() => {});
      setNow(nowSec());
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<{ hash: string }>) => {
    setErr(null);
    if (!address) return connect();
    try {
      setBusy(label);
      const { hash } = await fn();
      setLastTx({ label, hash });
      await refresh();
    } catch (e) {
      const m = explainError(e);
      const key = Object.keys(ERROR_HELP).find((k) => m.startsWith(k));
      setErr(key ? `${m} — ${ERROR_HELP[key]}` : m);
    } finally {
      setBusy(null);
    }
  };

  if (!r || !ad) {
    return (
      <div className="space-y-4">
        <BackLink />
        {err ? <Alert kind="error">{err}</Alert> : <div className="flex items-center gap-2 text-muted"><Spinner /> Loading reservation #{idParam}…</div>}
      </div>
    );
  }

  const t = tokenByAddress(ad.token);
  const isBuyer = !!address && address === r.buyer;
  const isSeller = !!address && address === ad.seller;
  const active = r.status === ReservationStatus.Active;
  const expired = active && Number(r.lock_expires_at) <= now;
  const declared = r.paid_declared_at !== 0n;
  const claimOpen = r.status === ReservationStatus.Released && r.late_claim_until !== 0n && Number(r.late_claim_until) > now && r.bond_slice > 0n;
  const reclaimable = r.status === ReservationStatus.Released && r.bond_slice > 0n && (r.late_claim_until === 0n || Number(r.late_claim_until) < now);
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const payout = r.amount - (r.amount * BigInt(feeBps)) / 10000n;
  const lateClaimDays = cfg ? Math.round(Number(cfg.late_claim_window) / 86400) : 3;
  const bondStr = `${fmtToken(r.bond_slice, ad.decimals)} ${t.symbol}`;

  const c = () => escrow(address, signTransaction);
  const declarePaid = () =>
    run("Payment declared on-chain", async () => {
      const res = await send(await c().declare_paid({ id, buyer: address! }));
      unwrapResult(res.result);
      return res;
    });
  const release = () => run("Reservation released", async () => send(await c().release({ id, caller: address! })));
  const settle = (pv: string, proof: string) =>
    run("Crypto released to you", async () => {
      const res = await send(await c().settle({ id, buyer: address!, public_values: hexToBuffer(pv), proof: hexToBuffer(proof) }));
      unwrapResult(res.result);
      return res;
    });
  const claimBond = (pv: string, proof: string) =>
    run("Maker's bond paid to you", async () => {
      const res = await send(await c().claim_bond({ id, buyer: address!, public_values: hexToBuffer(pv), proof: hexToBuffer(proof) }));
      unwrapResult(res.result);
      return res;
    });
  const reclaimBond = () =>
    run("Bond slice returned", async () => {
      const res = await send(await c().reclaim_bond({ id }));
      unwrapResult(res.result);
      return res;
    });
  const reveal = async () => {
    setErr(null);
    setRevealing(true);
    try {
      setPayee(await requestReveal(ad.id, id, address!, signMessage));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className="space-y-6">
      <BackLink href={`/ads/${ad.id}`}>← Ad #{ad.id.toString()}</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Reservation #{r.id.toString()} · maker {ad.nickname || short(ad.seller, 5)}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {fmtToken(r.amount, ad.decimals)} {t.symbol} <span className="text-muted">for</span> {fmtTRY(r.try_amount_kurus)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {fmtTRY(ad.price_kurus)} per {t.symbol} · buyer <span className="mono">{short(r.buyer, 5)}</span>{isBuyer && " (you)"} · reserved {fmtDate(r.created_at)}
          </p>
        </div>
        <div className="text-right">
          <ReservationBadge status={r.status} expired={expired} claimOpen={claimOpen} />
          {active && (
            <p className="mt-2 text-sm text-muted">
              {declared ? "Protected for " : "Reservation ends in "}
              <Countdown until={Number(r.lock_expires_at)} className="text-base" />
            </p>
          )}
        </div>
      </div>

      {err && <Alert kind="error">{err}</Alert>}
      {lastTx && (
        <Alert kind="ok">
          {lastTx.label}. <TxLink hash={lastTx.hash} />
        </Alert>
      )}

      {/* buyer: active reservation */}
      {active && isBuyer && (
        <BuyerFlow mode="buy" r={r} ad={ad} cfg={cfg} info={info} address={address!} payee={payee} revealing={revealing} onReveal={reveal} onDeclare={declarePaid} onClaim={settle} onRelease={release} busy={busy} expired={expired} />
      )}

      {/* buyer: released after declaring — claim the maker's bond slice with the same proof */}
      {claimOpen && isBuyer && (
        <BuyerFlow mode="bond" r={r} ad={ad} cfg={cfg} info={info} address={address!} payee={payee} revealing={revealing} onReveal={reveal} onDeclare={declarePaid} onClaim={claimBond} onRelease={release} busy={busy} expired={false} />
      )}

      {/* maker / others */}
      {active && !isBuyer && (
        <Card className="space-y-3">
          {declared ? (
            <Alert kind={expired ? "error" : "warn"}>
              The buyer declared the bank transfer on {fmtDate(r.paid_declared_at)}. The reservation is protected until {fmtDate(r.lock_expires_at)}.
              {isSeller && (
                <>
                  {" "}Check your bank account for {fmtTRY(r.try_amount_kurus)} with reference <span className="mono">{paymentReference(r.id, r.buyer)}</span>. If it is released after that and the
                  buyer proves the payment within {lateClaimDays} days, the bond slice of <b>{bondStr}</b> goes to them.
                </>
              )}
            </Alert>
          ) : (
            <p className="text-sm text-muted">The buyer has {expired ? "not declared a payment and the timer ended" : "until the timer ends to pay and declare"}.</p>
          )}
          {expired && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={release} disabled={!!busy}>Release reservation</Button>
            </div>
          )}
          {isSeller && !expired && <p className="text-xs text-muted">You cannot release a reservation while it runs; the tokens stay reserved for this buyer.</p>}
        </Card>
      )}

      {r.status === ReservationStatus.Settled && (
        <Alert kind="ok">
          Completed on {fmtDate(r.settled_at)}: {fmtToken(payout, ad.decimals)} {t.symbol} went to {short(r.buyer, 6)}.
        </Alert>
      )}
      {r.status === ReservationStatus.Released && !claimOpen && (
        <Alert kind="info">
          Released{r.bond_slice > 0n ? `; a bond slice of ${bondStr} is still held` : ""}.
          {reclaimable && (
            <>
              {" "}The claim window has passed. <button className="underline" onClick={reclaimBond} disabled={!!busy}>Return it to the ad</button>.
            </>
          )}
        </Alert>
      )}
      {claimOpen && !isBuyer && (
        <Alert kind="warn">
          Released after the buyer declared a payment: they can still claim the bond slice of {bondStr} with a valid proof until {fmtDate(r.late_claim_until)}.
        </Alert>
      )}

      <Card>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Terms of this reservation</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">You send</dt><dd className="font-semibold">{fmtTRY(r.try_amount_kurus)} by FAST from Ziraat</dd></div>
          <div><dt className="text-muted">You receive</dt><dd>{fmtToken(payout, ad.decimals)} {t.symbol} (after {feeBps / 100}% fee)</dd></div>
          <div><dt className="text-muted">Bond backing you</dt><dd>{bondStr}{ad.status === AdStatus.Closed ? " (ad closed by the maker; your reservation still settles)" : ""}</dd></div>
          <div><dt className="text-muted">Protection after declaring</dt><dd>{cfg ? Number(cfg.proof_window) / 60 : 120} min, then {lateClaimDays}-day bond claim</dd></div>
          <div><dt className="text-muted">Payee details</dt><dd>encrypted on-chain; shown to you after a wallet signature</dd></div>
          <div><dt className="text-muted">Payment reference</dt><dd className="mono">{paymentReference(r.id, r.buyer)}</dd></div>
        </dl>
      </Card>
    </div>
  );
}

function BuyerFlow({
  mode, r, ad, cfg, info, address, payee, revealing, onReveal, onDeclare, onClaim, onRelease, busy, expired,
}: {
  mode: "buy" | "bond";
  r: Reservation; ad: Ad; cfg: EscrowConfig | null; info: ProverInfo | null;
  address: string;
  payee: Revealed | null; revealing: boolean; onReveal: () => Promise<void>;
  onDeclare: () => Promise<void>;
  onClaim: (pv: string, proof: string) => Promise<void>; onRelease: () => Promise<void>;
  busy: string | null; expired: boolean;
}) {
  const t = tokenByAddress(ad.token);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<ProverJob | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const bond = mode === "bond";
  const declared = r.paid_declared_at !== 0n;
  const paid = bond || declared;
  const minutesLeft = (Number(r.lock_expires_at) - nowSec()) / 60;
  const tooLateToPay = !bond && !paid && minutesLeft < config.minMinutesToPay;
  const sinceYmd = istanbulYmd(Number(r.created_at));
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const payout = r.amount - (r.amount * BigInt(feeBps)) / 10000n;
  const prize = bond ? `${fmtToken(r.bond_slice, ad.decimals)} ${t.symbol}` : `${fmtToken(payout, ad.decimals)} ${t.symbol}`;
  const reference = paymentReference(r.id, address);
  const canPay = !!payee && payee.verified;
  const copyReference = () => {
    navigator.clipboard?.writeText(reference).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  useEffect(() => {
    const saved = localStorage.getItem(`zkotc-job-r${r.id}`);
    if (!saved) return;
    getJob(saved).then(setJob).catch(() => localStorage.removeItem(`zkotc-job-r${r.id}`));
  }, [r.id]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") { if (poll.current) clearInterval(poll.current); return; }
    poll.current = setInterval(() => getJob(job.id).then(setJob).catch(() => {}), 2000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [job]);

  const upload = async () => {
    if (!file || !payee) return;
    setJobErr(null);
    try {
      const j = await createJob({
        emlBase64: await fileToBase64(file),
        offerId: r.id,
        buyer: address,
        recipientIban: payee.iban,
        recipientName: payee.name,
        minAmountKurus: r.try_amount_kurus,
        sinceYmd,
      });
      localStorage.setItem(`zkotc-job-r${r.id}`, j.id);
      setJob(j);
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : String(e));
    }
  };

  const stepIdx = !payee ? 0 : !paid ? 1 : !job ? 2 : job.status === "done" ? 4 : 3;
  const jobStep = job ? JOB_STEPS.findIndex((s) => s.key === job.status) : -1;

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{bond ? "Claim the maker's bond" : "Complete your purchase"}</h2>
        <Steps current={stepIdx} steps={["Payee details", bond ? "Payment declared" : "Pay & declare", "e-dekont e-mail", "Proof", bond ? "Claim bond" : `Claim ${t.symbol}`]} />
      </div>

      {bond && (
        <Alert kind="warn">
          Your reservation was released after you declared the payment on {fmtDate(r.paid_declared_at)}. Prove the transfer before <b>{fmtDate(r.late_claim_until)}</b> to
          receive the maker&apos;s bond slice of <b>{prize}</b>. (The tokens themselves are no longer reserved for you.)
        </Alert>
      )}
      {!bond && expired && !paid && (
        <Alert kind="warn">Your reservation timer ended. You can still settle as long as nobody releases it, so finish quickly, or release it and reserve again.</Alert>
      )}

      {/* Step 0: reveal */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">1 · Where to pay</h3>
        {!payee ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              The maker&apos;s IBAN and name are encrypted on-chain. Sign a message with your wallet (no transaction, no fee) to have them revealed to you; the
              app then checks they match the maker&apos;s on-chain commitment before showing them.
            </p>
            <Button onClick={onReveal} disabled={revealing}>{revealing ? <><Spinner /> Waiting for your signature…</> : "Reveal payment details"}</Button>
          </div>
        ) : !payee.verified ? (
          <Alert kind="error">
            <b>Do not pay.</b> The revealed details ({fmtIBAN(payee.iban)}, {payee.name}) do not hash to this ad&apos;s on-chain payee commitment, so a proof of a
            payment to them could never settle. Release the reservation and choose another ad.
          </Alert>
        ) : (
          <div className="grid gap-3 rounded-xl bg-panel-2 p-4 text-sm sm:grid-cols-2">
            <div><p className="text-muted">Alıcı IBAN</p><p className="mono select-all">{fmtIBAN(payee.iban)}</p></div>
            <div><p className="text-muted">Alıcı adı</p><p className="select-all">{payee.name}</p></div>
            <div><p className="text-muted">Tutar</p><p className="select-all font-semibold">{fmtTRY(r.try_amount_kurus)}</p></div>
            <div><p className="text-muted">Transfer type</p><p>FAST (instant) from your <b>Ziraat</b> TRY account</p></div>
            <div className="sm:col-span-2 rounded-lg border border-line bg-panel p-3">
              <p className="text-muted">Açıklama (payment reference) — <b className="text-fg">required</b></p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="mono select-all text-base font-semibold">{reference}</span>
                <button type="button" className="rounded-md border border-line px-2 py-0.5 text-xs" onClick={copyReference}>{copied ? "copied" : "copy"}</button>
              </p>
              <p className="mt-1 text-xs text-muted">Type exactly this into the transfer&apos;s description. It ties the payment to your wallet: nobody who gets hold of your e-mail can claim in your place.</p>
            </div>
            <p className="sm:col-span-2 text-xs text-ok">✓ These details match the maker&apos;s on-chain commitment.</p>
          </div>
        )}
      </section>

      {/* Step 1: declare */}
      {!bond && canPay && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">2 · Send the transfer, then declare it</h3>
          {paid ? (
            <Alert kind="ok">
              Payment declared on {fmtDate(r.paid_declared_at)}. The maker cannot release before {fmtDate(r.lock_expires_at)}; after that a valid proof still wins their bond slice of{" "}
              {fmtToken(r.bond_slice, ad.decimals)} {t.symbol} for {cfg ? Math.round(Number(cfg.late_claim_window) / 86400) : 3} days.
            </Alert>
          ) : tooLateToPay ? (
            <Alert kind="error">
              Less than {config.minMinutesToPay} minutes remain. Do <b>not</b> send money now: release the reservation and reserve again to get a fresh timer.
            </Alert>
          ) : (
            <div className="space-y-2">
              <Button onClick={onDeclare} disabled={!!busy}>
                {busy === "Payment declared on-chain" ? <><Spinner /> Confirm in wallet…</> : `I have sent ${fmtTRY(r.try_amount_kurus)} — declare it on-chain`}
              </Button>
              <p className="text-xs text-muted">
                Records the time of your payment. From then on nobody can release your reservation for {cfg ? Number(cfg.proof_window) / 60 : 120} minutes, and the maker&apos;s bond
                backs your claim afterwards. Declare only after the transfer has left your account.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Step 2: e-mail */}
      {paid && canPay && (
        <section className="space-y-2 text-sm">
          <h3 className="font-semibold">3 · Get the e-dekont e-mail for this transfer</h3>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Ziraat Mobil / İnternet Şubesi → <b>Hesap Hareketleri</b> → open the FAST transfer you sent → <b>Dekont Gönder</b> → <b>E-posta</b>.</li>
            <li>The e-mail (subject <b>e-dekont</b>) arrives within ~2 minutes from ileti.ziraatbank.com.tr.</li>
            <li>In Gmail open it → ⋮ → <b>Show original</b> → <b>Download original</b> (a .eml file). Do not forward it; forwarding breaks the signature.</li>
          </ol>
        </section>
      )}

      {/* Step 3: proof */}
      {paid && canPay && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">4 · Generate the zero-knowledge proof</h3>
          {!job ? (
            <>
              <input type="file" accept=".eml,message/rfc822" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
              <label className="flex items-start gap-2 text-xs text-muted">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I understand the e-mail (the dekont of this one transfer) is sent to the prover at <span className="mono">{config.proverUrl}</span>
                  {info ? ` (mode: ${info.prover_mode}, DKIM key: ${info.dkim_source})` : ""}, kept only in memory while the proof is generated, and that only hashes, the amount,
                  the date and a nullifier go on-chain.
                </span>
              </label>
              <Button onClick={upload} disabled={!file || !consent}>Verify e-mail and start proving</Button>
              {jobErr && <Alert kind="error">{jobErr}</Alert>}
            </>
          ) : (
            <div className="space-y-3">
              <ol className="space-y-1 text-sm">
                {JOB_STEPS.map((s, i) => (
                  <li key={s.key} className={`flex items-center gap-2 ${i < jobStep || job.status === "done" ? "text-ok" : i === jobStep ? "" : "text-muted"}`}>
                    {i === jobStep && job.status !== "done" ? <Spinner /> : <span className="w-4 text-center">{i < jobStep || job.status === "done" ? "✓" : "·"}</span>}
                    <span className="font-medium">{s.label}</span> <span className="text-xs text-muted">{s.help}</span>
                  </li>
                ))}
              </ol>
              {job.dekont && (
                <p className="rounded-lg bg-panel-2 p-3 text-xs">
                  Dekont: <b>{fmtYmd(job.dekont.date_yyyymmdd)} {job.dekont.time}</b> · {job.dekont.fis_no} · {fmtTRY(job.dekont.amount_kurus)} → {job.dekont.recipient_name ?? "?"}{job.dekont.fast_sorgu_no ? ` · FAST ${job.dekont.fast_sorgu_no}` : ""}
                </p>
              )}
              {job.status === "failed" && (
                <Alert kind="error">
                  Proof failed: {job.error}. <button className="underline" onClick={() => { localStorage.removeItem(`zkotc-job-r${r.id}`); setJob(null); }}>Try another .eml</button>
                </Alert>
              )}
              {job.cycles ? <p className="text-xs text-muted">{job.cycles.toLocaleString()} zkVM cycles</p> : null}
            </div>
          )}
        </section>
      )}

      {/* Step 4: claim */}
      {job?.status === "done" && job.proof && job.public_values && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">5 · {bond ? "Claim the bond" : `Claim your ${t.symbol}`}</h3>
          <p className="text-sm text-muted">The proof ({(job.proof.length - 2) / 2} bytes) is verified by the Soroban verifier contract inside the same transaction that pays you.</p>
          {cfg && info && bytesToHex(cfg.image_id).toLowerCase() !== info.image_id.replace(/^0x/, "").toLowerCase() && (
            <Alert kind="error">
              The prover&apos;s guest image id ({info.image_id.slice(0, 10)}…) does not match the escrow configuration ({bytesToHex(cfg.image_id).slice(0, 8)}…); a claim with this
              proof would fail on-chain. If the prover was updated, reload this page.
            </Alert>
          )}
          <Button onClick={() => onClaim(job.public_values!, job.proof!)} disabled={!!busy}>
            {busy ? <><Spinner /> Confirm in wallet…</> : `Claim ${prize}`}
          </Button>
        </section>
      )}

      {!bond && !paid && (
        <div className="border-t border-line pt-3 text-xs text-muted">
          Changed your mind and have <b>not</b> paid?{" "}
          <button className="underline" onClick={onRelease} disabled={!!busy}>Release the reservation</button>. Not sure which ad to pick? <Link className="underline" href="/">Back to the market</Link>.
        </div>
      )}
    </Card>
  );
}
