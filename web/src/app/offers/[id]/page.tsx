"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OfferStatus, type Offer } from "@/contracts/escrow";
import { useWallet } from "@/lib/wallet";
import { escrow, getOffer, getConfig, send, unwrapResult, explainError, ERROR_HELP, type EscrowConfig } from "@/lib/escrow";
import { createJob, getJob, fileToBase64, JOB_STEPS, proverInfo, type ProverJob, type ProverInfo } from "@/lib/prover";
import { tokenByAddress } from "@/lib/tokens";
import { fmtToken, fmtTRY, fmtIBAN, fmtDate, fmtYmd, istanbulYmd, nowSec, short, hexToBuffer } from "@/lib/format";
import { config, accountUrl, contractUrl } from "@/lib/config";
import { Alert, BackLink, Button, Card, Spinner, StatusBadge, Steps, TxLink } from "@/components/ui";
import { Countdown } from "@/components/Countdown";

export default function OfferPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = useMemo(() => BigInt(idParam), [idParam]);
  const search = useSearchParams();
  const { address, connect, signTransaction } = useWallet();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [info, setInfo] = useState<ProverInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: string } | null>(
    search.get("created") ? { label: "Offer created", hash: search.get("created")! } : null,
  );
  const [now, setNow] = useState(nowSec());

  const refresh = useCallback(
    () => getOffer(id).then(setOffer, (e) => setErr(explainError(e))),
    [id],
  );

  useEffect(() => {
    refresh();
    getConfig().then(setCfg).catch(() => {});
    proverInfo().then(setInfo).catch(() => setInfo(null));
    const t = setInterval(() => {
      refresh();
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

  if (!offer) {
    return (
      <div className="space-y-4">
        <BackLink />
        {err ? <Alert kind="error">{err}</Alert> : <div className="flex items-center gap-2 text-muted"><Spinner /> Loading offer #{idParam}…</div>}
      </div>
    );
  }

  const t = tokenByAddress(offer.token);
  const isSeller = !!address && address === offer.seller;
  const isBuyer = !!address && offer.buyer === address;
  const lockExpired = offer.status === OfferStatus.Locked && Number(offer.lock_expires_at) <= now;
  const offerExpired = offer.expires_at !== 0n && Number(offer.expires_at) <= now;
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const payout = offer.amount - (offer.amount * BigInt(feeBps)) / 10000n;

  const c = () => escrow(address, signTransaction);
  const lock = () => run("Offer reserved", async () => send(await c().lock({ id, buyer: address! })));
  const unlock = () => run("Reservation released", async () => send(await c().unlock({ id, caller: address! })));
  const cancel = () => run("Offer withdrawn", async () => send(await c().cancel_offer({ id })));
  const fulfill = (pv: string, proof: string) =>
    run("Crypto released to you", async () => {
      const tx = await c().fulfill({ id, buyer: address!, public_values: hexToBuffer(pv), proof: hexToBuffer(proof) });
      const r = await send(tx);
      unwrapResult(r.result);
      return r;
    });

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Offer #{offer.id.toString()}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {fmtToken(offer.amount, t.decimals)} {t.symbol} <span className="text-muted">for</span> {fmtTRY(offer.try_amount_kurus)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Seller{" "}
            <a className="underline decoration-dotted" href={accountUrl(offer.seller)} target="_blank" rel="noreferrer">
              {short(offer.seller, 6)}
            </a>
            {isSeller && " (you)"} · created {fmtDate(offer.created_at)}
            {offer.expires_at !== 0n && ` · expires ${fmtDate(offer.expires_at)}`}
          </p>
        </div>
        <div className="text-right">
          <StatusBadge status={offer.status} expired={lockExpired} />
          {offer.status === OfferStatus.Locked && (
            <p className="mt-2 text-sm text-muted">
              Reservation ends in <Countdown until={Number(offer.lock_expires_at)} className="text-base" />
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

      {/* ─── buyer: open offer ─── */}
      {offer.status === OfferStatus.Open && !isSeller && (
        <Card className="space-y-4">
          <h2 className="font-semibold">Buy this offer</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Reserve the offer (a Stellar transaction, no funds move). You get {cfg ? Number(cfg.lock_duration) / 60 : 60} minutes.</li>
            <li>Send exactly {fmtTRY(offer.try_amount_kurus)} by FAST from your <b>Ziraat</b> account to the seller&apos;s IBAN.</li>
            <li>Ask Ziraat to e-mail your statement, upload the .eml here, and claim {fmtToken(payout, t.decimals)} {t.symbol}.</li>
          </ol>
          {offerExpired ? (
            <Alert kind="warn">This offer has expired and can no longer be reserved.</Alert>
          ) : (
            <Button onClick={lock} disabled={!!busy}>
              {busy === "Offer reserved" ? <><Spinner /> Confirm in wallet…</> : address ? "Reserve offer" : "Connect wallet to reserve"}
            </Button>
          )}
          <p className="text-xs text-muted">
            You must pay from a Ziraat Bankası TRY account: the proof is built from Ziraat&apos;s DKIM-signed statement e-mail. Fee {feeBps / 100}% is
            deducted from the crypto you receive.
          </p>
        </Card>
      )}

      {/* ─── buyer: locked by me ─── */}
      {offer.status === OfferStatus.Locked && isBuyer && (
        <BuyerFlow offer={offer} cfg={cfg} info={info} onFulfill={fulfill} onUnlock={unlock} busy={busy} lockExpired={lockExpired} />
      )}

      {/* ─── locked by someone else ─── */}
      {offer.status === OfferStatus.Locked && !isBuyer && (
        <Card className="space-y-3">
          <p className="text-sm">
            Reserved by <span className="mono">{short(offer.buyer ?? "", 6)}</span> since {fmtDate(offer.locked_at)}.
          </p>
          {lockExpired ? (
            <>
              <Alert kind="warn">
                The reservation timer has ended, but the buyer may already have sent the bank transfer and be generating their proof. Releasing
                lets someone else reserve. {isSeller && "Check your bank account before withdrawing."}
              </Alert>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={unlock} disabled={!!busy}>Release reservation</Button>
                {isSeller && <Button variant="danger" onClick={cancel} disabled={!!busy}>Withdraw funds anyway</Button>}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Wait for the timer to end to reserve it yourself.</p>
          )}
        </Card>
      )}

      {/* ─── seller ─── */}
      {isSeller && offer.status === OfferStatus.Open && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Your offer</h2>
          <p className="text-sm text-muted">Nobody has reserved it. You can withdraw your {t.symbol} any time.</p>
          <Button variant="danger" onClick={cancel} disabled={!!busy}>
            {busy === "Offer withdrawn" ? <><Spinner /> Confirm in wallet…</> : `Withdraw ${fmtToken(offer.amount, t.decimals)} ${t.symbol}`}
          </Button>
        </Card>
      )}

      {offer.status === OfferStatus.Fulfilled && (
        <Alert kind="ok">
          Completed on {fmtDate(offer.fulfilled_at)}: {fmtToken(payout, t.decimals)} {t.symbol} went to {short(offer.buyer ?? "", 6)}.
        </Alert>
      )}
      {offer.status === OfferStatus.Cancelled && <Alert kind="info">The seller withdrew this offer.</Alert>}

      <Card>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Payment details (public)</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Recipient IBAN</dt><dd className="mono">{fmtIBAN(offer.seller_iban)}</dd></div>
          <div><dt className="text-muted">Recipient name</dt><dd>{offer.seller_name}</dd></div>
          <div><dt className="text-muted">Amount to send</dt><dd className="font-semibold">{fmtTRY(offer.try_amount_kurus)}</dd></div>
          <div><dt className="text-muted">Token in escrow</dt><dd>{fmtToken(offer.amount, t.decimals)} {t.symbol} · <a className="underline decoration-dotted" href={contractUrl(offer.token)} target="_blank" rel="noreferrer">{short(offer.token, 5)}</a></dd></div>
        </dl>
      </Card>
    </div>
  );
}

function BuyerFlow({
  offer, cfg, info, onFulfill, onUnlock, busy, lockExpired,
}: {
  offer: Offer; cfg: EscrowConfig | null; info: ProverInfo | null;
  onFulfill: (pv: string, proof: string) => Promise<void>; onUnlock: () => Promise<void>;
  busy: string | null; lockExpired: boolean;
}) {
  const t = tokenByAddress(offer.token);
  const [paid, setPaid] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<ProverJob | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const minutesLeft = (Number(offer.lock_expires_at) - nowSec()) / 60;
  const tooLateToPay = minutesLeft < config.minMinutesToPay;
  const sinceYmd = istanbulYmd(Number(offer.locked_at));

  useEffect(() => {
    const saved = localStorage.getItem(`zkotc-job-${offer.id}`);
    if (!saved) return;
    getJob(saved)
      .then((j) => {
        setJob(j);
        setPaid(true);
      })
      .catch(() => localStorage.removeItem(`zkotc-job-${offer.id}`));
  }, [offer.id]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") { if (poll.current) clearInterval(poll.current); return; }
    poll.current = setInterval(() => getJob(job.id).then(setJob).catch(() => {}), 4000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [job]);

  const upload = async () => {
    if (!file) return;
    setJobErr(null);
    try {
      const j = await createJob({
        emlBase64: await fileToBase64(file),
        offerId: offer.id,
        recipientIban: offer.seller_iban,
        minAmountKurus: offer.try_amount_kurus,
        sinceYmd,
      });
      localStorage.setItem(`zkotc-job-${offer.id}`, j.id);
      setJob(j);
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : String(e));
    }
  };

  const stepIdx = !paid ? 0 : !job ? 1 : job.status === "done" ? 3 : 2;
  const jobStep = job ? JOB_STEPS.findIndex((s) => s.key === job.status) : -1;

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Complete your purchase</h2>
        <Steps current={stepIdx} steps={["Pay by FAST", "Get statement e-mail", "Generate proof", "Claim crypto"]} />
      </div>

      {lockExpired && (
        <Alert kind="warn">
          Your reservation timer ended. You can still claim as long as nobody releases the reservation, so finish the proof now.
        </Alert>
      )}

      {/* Step 1 */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">1 · Send the bank transfer</h3>
        <div className="grid gap-3 rounded-xl bg-panel-2 p-4 text-sm sm:grid-cols-2">
          <div><p className="text-muted">Alıcı IBAN</p><p className="mono select-all">{fmtIBAN(offer.seller_iban)}</p></div>
          <div><p className="text-muted">Alıcı adı</p><p className="select-all">{offer.seller_name}</p></div>
          <div><p className="text-muted">Tutar</p><p className="select-all font-semibold">{fmtTRY(offer.try_amount_kurus)}</p></div>
          <div><p className="text-muted">Transfer type</p><p>FAST (instant) from your <b>Ziraat</b> TRY account</p></div>
        </div>
        {tooLateToPay && !paid ? (
          <Alert kind="error">
            Less than {config.minMinutesToPay} minutes remain on your reservation. Do <b>not</b> send money now: release the reservation and
            reserve again to get a fresh timer.
          </Alert>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            I have sent exactly {fmtTRY(offer.try_amount_kurus)} to this IBAN.
          </label>
        )}
      </section>

      {/* Step 2 */}
      {paid && (
        <section className="space-y-2 text-sm">
          <h3 className="font-semibold">2 · Get your statement e-mail from Ziraat</h3>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Ziraat Mobil / İnternet Şubesi → <b>Hesaplarım</b> → your TRY account → <b>Hesap Hareketleri</b>.</li>
            <li>Choose today&apos;s date range → <b>E-posta Gönder</b> (the e-mail arrives within ~2 minutes from ziraat@ileti.ziraatbank.com.tr).</li>
            <li>In Gmail open the e-mail → ⋮ → <b>Show original</b> → <b>Download original</b> (a .eml file). Do not forward it; forwarding breaks the signature.</li>
          </ol>
        </section>
      )}

      {/* Step 3 */}
      {paid && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">3 · Generate the zero-knowledge proof</h3>
          {!job ? (
            <>
              <input type="file" accept=".eml,message/rfc822" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
              <label className="flex items-start gap-2 text-xs text-muted">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I understand the whole e-mail (my 30-day statement) is sent to the prover at <span className="mono">{config.proverUrl}</span>
                  {info ? ` (mode: ${info.prover_mode}, DKIM key: ${info.dkim_source})` : ""}, kept only in memory while the proof is generated, and that only
                  hashes, the amount, the date and a nullifier go on-chain.
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
              {job.row && (
                <p className="rounded-lg bg-panel-2 p-3 text-xs">
                  Matched statement row: <b>{fmtYmd(job.row.date_yyyymmdd)}</b> · {job.row.fis_no} · {fmtTRY(job.row.amount_kurus)} · {job.row.description}
                </p>
              )}
              {job.status === "failed" && (
                <Alert kind="error">
                  Proof failed: {job.error}. <button className="underline" onClick={() => { localStorage.removeItem(`zkotc-job-${offer.id}`); setJob(null); }}>Try another .eml</button>
                </Alert>
              )}
              {job.cycles ? <p className="text-xs text-muted">{job.cycles.toLocaleString()} zkVM cycles</p> : null}
            </div>
          )}
        </section>
      )}

      {/* Step 4 */}
      {job?.status === "done" && job.proof && job.public_values && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">4 · Claim your crypto</h3>
          <p className="text-sm text-muted">
            The proof ({(job.proof.length - 2) / 2} bytes) will be verified by the Soroban verifier contract inside the same transaction that pays you.
          </p>
          {cfg && info && cfg.image_id.toString("hex") !== info.image_id.replace(/^0x/, "") && (
            <Alert kind="error">The prover&apos;s guest image id does not match the escrow configuration; the claim would fail on-chain.</Alert>
          )}
          <Button onClick={() => onFulfill(job.public_values!, job.proof!)} disabled={!!busy}>
            {busy ? <><Spinner /> Confirm in wallet…</> : `Claim ${fmtToken(offer.amount - (offer.amount * BigInt(cfg ? Number(cfg.fee_bps) : 25)) / 10000n, t.decimals)} ${t.symbol}`}
          </Button>
        </section>
      )}

      <div className="border-t border-line pt-3 text-xs text-muted">
        Changed your mind and have <b>not</b> paid?{" "}
        <button className="underline" onClick={onUnlock} disabled={!!busy}>Release the reservation</button>.
      </div>
    </Card>
  );
}
