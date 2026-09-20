"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ReservationStatus, AdStatus } from "@/contracts/escrow";
import { useWallet } from "@/lib/wallet";
import {
  escrow,
  getAd,
  getReservation,
  getConfig,
  send,
  unwrapResult,
  explainError,
  ERROR_HELP,
  type Ad,
  type Reservation,
  type EscrowConfig,
} from "@/lib/escrow";
import { requestReveal, cachedReveal, type Revealed } from "@/lib/reveal";
import {
  requestProof,
  getJob,
  fileToBase64,
  JOB_STEPS,
  proverInfo,
  type ProverJob,
  type ProverInfo,
} from "@/lib/prover";
import { tokenByAddress } from "@/lib/tokens";
import {
  fmtToken,
  fmtTRY,
  fmtIBAN,
  fmtDate,
  fmtYmd,
  nowSec,
  short,
  hexToBuffer,
  bytesToHex,
  paymentReference,
} from "@/lib/format";
import { config, accountUrl } from "@/lib/config";
import {
  Alert,
  BackLink,
  Button,
  Card,
  ReservationBadge,
  Skeleton,
  Spinner,
  TxLink,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/lib/i18n";
import { bankByName } from "@/lib/banks";
import { BankLogo } from "@/components/BankSelect";
import { receiptFileError, validId } from "@/lib/ux";
import { useCopy } from "@/components/Product";
import { Countdown } from "@/components/Countdown";

export default function ReservationPage() {
  const { address } = useWallet();
  const { id } = useParams<{ id: string }>();
  return <ReservationDetails key={`${id}:${address ?? "disconnected"}`} />;
}
function ReservationDetails() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = useMemo(() => validId(idParam), [idParam]);
  const search = useSearchParams();
  const wallet = useWallet();
  const { connect, signTransaction, signMessage } = wallet;
  const { toast } = useToast();
  const { t: tr } = useI18n();

  const [r, setR] = useState<Reservation | null>(null);
  const [ad, setAd] = useState<Ad | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [cfgError, setCfgError] = useState(false);
  const [info, setInfo] = useState<ProverInfo | null>(null);
  const [proverDown, setProverDown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: string } | null>(
    search.get("reserved")
      ? { label: "Reserved", hash: search.get("reserved")! }
      : null,
  );
  const [now, setNow] = useState(nowSec());
  const [payee, setPayee] = useState<Revealed | null>(null);
  const [revealing, setRevealing] = useState(false);

  const refresh = useCallback(
    () =>
      (id === null
        ? Promise.reject(new Error("Invalid trade link"))
        : getReservation(id)
      )
        .then((res) => getAd(res.ad_id).then((a) => [res, a] as const))
        .then(
          ([res, a]) => {
            setR(res);
            setAd(a);
            setLoadErr(null);
          },
          (e) => setLoadErr(explainError(e)),
        ),
    [id],
  );

  useEffect(() => {
    refresh();
    getConfig()
      .then((v) => {
        setCfg(v);
        setCfgError(false);
      })
      .catch(() => setCfgError(true));
    proverInfo()
      .then((i) => {
        setInfo(i);
        setProverDown(false);
      })
      .catch(() => {
        setInfo(null);
        setProverDown(true);
      });
    const t = setInterval(() => {
      refresh();
      getConfig()
        .then((v) => {
          setCfg(v);
          setCfgError(false);
        })
        .catch(() => setCfgError(true));
      proverInfo()
        .then((i) => {
          setInfo(i);
          setProverDown(false);
        })
        .catch(() => setProverDown(true));
      setNow(nowSec());
    }, 10_000);
    const resume = () => {
      if (document.visibilityState === "visible") {
        refresh();
        setNow(nowSec());
      }
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  const actionLock = useRef(false);
  const run = async (label: string, fn: () => Promise<{ hash: string }>) => {
    if (actionLock.current) return;
    setErr(null);
    if (!wallet.address) return connect();
    actionLock.current = true;
    try {
      setBusy(label);
      const { hash } = await fn();
      setLastTx({ label, hash });
      toast({ kind: "ok", title: label, body: <TxLink hash={hash} /> });
      await refresh();
    } catch (e) {
      const m = explainError(e);
      const key = Object.keys(ERROR_HELP).find((k) => m.startsWith(k));
      setErr(key ? `${m} — ${ERROR_HELP[key]}` : m);
    } finally {
      actionLock.current = false;
      setBusy(null);
    }
  };

  if (!r || !ad || id === null) {
    return (
      <div className="space-y-4">
        <BackLink />
        {err ? (
          <Alert kind="error">{loadErr || err}</Alert>
        ) : (
          <Skeleton lines={6} />
        )}
      </div>
    );
  }

  if (!cfg || cfgError)
    return (
      <Alert kind="error">
        {tr("Configuration unavailable. Reload before continuing.")}{" "}
        <button className="underline" onClick={() => window.location.reload()}>
          {tr("Reload")}
        </button>
      </Alert>
    );
  const t = tokenByAddress(ad.token);
  // dev only: `?as=buyer` / `?as=maker` previews the other side's layout without their wallet (no action can succeed)
  const preview =
    process.env.NODE_ENV === "development" ? search.get("as") : null;
  const address =
    preview === "buyer"
      ? r.buyer
      : preview === "maker"
        ? ad.seller
        : wallet.address;
  const isBuyer = !!address && address === r.buyer;
  const isSeller = !!address && address === ad.seller;
  const active = r.status === ReservationStatus.Active;
  const expired = active && Number(r.lock_expires_at) <= now;
  const declared = r.paid_declared_at !== 0n;
  const claimOpen =
    r.status === ReservationStatus.Released &&
    r.late_claim_until !== 0n &&
    Number(r.late_claim_until) > now &&
    r.bond_slice > 0n;
  const reclaimable =
    r.status === ReservationStatus.Released &&
    r.bond_slice > 0n &&
    (r.late_claim_until === 0n || Number(r.late_claim_until) < now);
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const payout = r.amount - (r.amount * BigInt(feeBps)) / 10000n;
  const lateClaimDays = cfg
    ? Math.round(Number(cfg.late_claim_window) / 86400)
    : 3;
  const bondStr = `${fmtToken(r.bond_slice, ad.decimals)} ${t.symbol}`;
  // a reveal done earlier in this session (also on the ad page) is reused without another signature
  const shownPayee =
    payee ??
    (isBuyer
      ? cachedReveal(ad.id, id, address!)
      : isSeller
        ? cachedReveal(ad.id, null, address!)
        : null);

  const c = () => escrow(address, signTransaction);
  const declarePaid = () =>
    run("Payment declared on-chain", async () => {
      const res = await send(await c().declare_paid({ id, buyer: address! }));
      unwrapResult(res.result);
      return res;
    });
  const release = () =>
    run("Reservation released", async () => {
      const res = await send(await c().release({ id, caller: address! }));
      unwrapResult(res.result);
      return res;
    });
  const settle = (pv: string, proof: string) =>
    run("Crypto released to you", async () => {
      const res = await send(
        await c().settle({
          id,
          buyer: address!,
          public_values: hexToBuffer(pv),
          proof: hexToBuffer(proof),
        }),
      );
      unwrapResult(res.result);
      return res;
    });
  const claimBond = (pv: string, proof: string) =>
    run("Maker's bond paid to you", async () => {
      const res = await send(
        await c().claim_bond({
          id,
          buyer: address!,
          public_values: hexToBuffer(pv),
          proof: hexToBuffer(proof),
        }),
      );
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
    <div className="product-page trade-page">
      <BackLink href={`/ads/${ad.id}`}>
        {" "}
        {tr("← Ad #")} {ad.id.toString()}
      </BackLink>
      <div className="trade-summary flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {tr("Reservation")} #{r.id.toString()} · {tr("from")}{" "}
            {ad.nickname || short(ad.seller, 5)}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {r.status === ReservationStatus.Settled
              ? `${tr("Trade amount before fee")}: `
              : isBuyer
                ? `${tr("You get")} `
                : ""}
            {fmtToken(
              r.status === ReservationStatus.Settled ? r.amount : payout,
              ad.decimals,
            )}{" "}
            {t.symbol} <span className="text-muted">{tr("for")}</span>{" "}
            {fmtTRY(r.try_amount_kurus)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {tr("Price")}:{" "}
            {fmtTRY(
              r.amount > 0n
                ? (r.try_amount_kurus * 10n ** BigInt(ad.decimals)) / r.amount
                : 0n,
            )}{" "}
            / {t.symbol}
            {!isBuyer && (
              <>
                {" "}
                · {tr("buyer")}{" "}
                <span className="mono">{short(r.buyer, 5)}</span>
              </>
            )}{" "}
            · {tr("reserved")} {fmtDate(r.created_at)}
          </p>
        </div>
        <div className="text-right">
          <ReservationBadge
            status={r.status}
            expired={expired}
            claimOpen={claimOpen}
          />
          {active && (
            <p className="mt-2 text-sm text-muted">
              {declared
                ? `${tr("Protected for")} `
                : `${tr("Reservation ends in")} `}
              <Countdown
                until={Number(r.lock_expires_at)}
                className="text-base"
              />
            </p>
          )}
        </div>
      </div>

      {(loadErr || err) && (
        <Alert kind="error">
          {loadErr || err}{" "}
          <button className="underline" onClick={refresh}>
            {tr("Try again")}
          </button>
        </Alert>
      )}
      {lastTx && (
        <Alert kind="ok">
          {lastTx.label}. <TxLink hash={lastTx.hash} />
        </Alert>
      )}

      {/* buyer: active reservation */}
      {active && isBuyer && (
        <BuyerFlow
          key={`${address}:${r.id}`}
          mode="buy"
          r={r}
          ad={ad}
          cfg={cfg}
          info={info}
          proverDown={proverDown}
          address={address!}
          payee={shownPayee}
          revealing={revealing}
          onReveal={reveal}
          onDeclare={declarePaid}
          onClaim={settle}
          onRelease={release}
          busy={busy}
          expired={expired}
        />
      )}

      {/* buyer: released after declaring — claim the maker's bond slice with the same proof */}
      {claimOpen && isBuyer && (
        <BuyerFlow
          key={`${address}:${r.id}`}
          mode="bond"
          r={r}
          ad={ad}
          cfg={cfg}
          info={info}
          proverDown={proverDown}
          address={address!}
          payee={shownPayee}
          revealing={revealing}
          onReveal={reveal}
          onDeclare={declarePaid}
          onClaim={claimBond}
          onRelease={release}
          busy={busy}
          expired={false}
        />
      )}

      {/* maker / others */}
      {active && !isBuyer && (
        <Card className="space-y-3">
          {declared ? (
            <Alert kind={expired ? "error" : "warn"}>
              {" "}
              {tr("The buyer declared the bank transfer on")}{" "}
              {fmtDate(r.paid_declared_at)}{" "}
              {tr(". The reservation is protected until")}{" "}
              {fmtDate(r.lock_expires_at)}.
              {isSeller && (
                <>
                  {" "}
                  {tr("Check your bank account for")}{" "}
                  {fmtTRY(r.try_amount_kurus)} {tr("with reference")}{" "}
                  <span className="mono">
                    {paymentReference(r.id, r.buyer)}
                  </span>{" "}
                  {tr(
                    ". If it is released after that and the buyer proves the payment within",
                  )}{" "}
                  {lateClaimDays} {tr("days, the bond slice of")}{" "}
                  <b>{bondStr}</b> {tr("goes to them.")}{" "}
                </>
              )}
            </Alert>
          ) : (
            <p className="text-sm text-muted">
              {" "}
              {tr("The buyer has")}{" "}
              {expired
                ? "not declared a payment and the timer ended"
                : "until the timer ends to pay and declare"}
              .
            </p>
          )}
          {expired && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={release} disabled={!!busy}>
                {" "}
                {tr("Release reservation")}{" "}
              </Button>
            </div>
          )}
          {isSeller && !expired && (
            <p className="text-xs text-muted">
              {" "}
              {tr(
                "You cannot release a reservation while it runs; the tokens stay reserved for this buyer.",
              )}{" "}
            </p>
          )}
        </Card>
      )}

      {r.status === ReservationStatus.Settled && (
        <Alert kind="ok">
          {tr("Completed on")} {fmtDate(r.settled_at)}:{" "}
          {tr("Check the confirmed payout in your wallet history.")}{" "}
          <a
            className="underline"
            href={accountUrl(r.buyer)}
            target="_blank"
            rel="noreferrer"
          >
            {short(r.buyer, 6)} ↗
          </a>
        </Alert>
      )}
      {r.status === ReservationStatus.Released && !claimOpen && (
        <Alert kind="info">
          Released
          {r.bond_slice > 0n
            ? `; a bond slice of ${bondStr} is still held`
            : ""}
          .
          {reclaimable && (
            <>
              {" "}
              {tr("The claim window has passed.")}{" "}
              <button
                className="underline"
                onClick={reclaimBond}
                disabled={!!busy}
              >
                {" "}
                {tr("Return it to the ad")}{" "}
              </button>
              .
            </>
          )}
        </Alert>
      )}
      {claimOpen && !isBuyer && (
        <Alert kind="warn">
          {" "}
          {tr(
            "Released after the buyer declared a payment: they can still claim the bond slice of",
          )}{" "}
          {bondStr} {tr("with a valid proof until")}{" "}
          {fmtDate(r.late_claim_until)}.
        </Alert>
      )}

      <details className="rounded-2xl border border-line bg-panel p-5 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
          {tr("Reservation details")}
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted">
              {tr(isBuyer ? "You send" : "Buyer sends")}
            </dt>
            <dd className="font-semibold">
              {fmtTRY(r.try_amount_kurus)}{" "}
              {tr("by FAST · Ziraat / VakıfBank")}{" "}
            </dd>
          </div>
          <div>
            <dt className="text-muted">
              {tr(isBuyer ? "You receive" : "Buyer receives")}
            </dt>
            <dd>
              {fmtToken(
                r.status === ReservationStatus.Settled ? r.amount : payout,
                ad.decimals,
              )}{" "}
              {t.symbol}{" "}
              {r.status === ReservationStatus.Settled
                ? tr("before fee; current fee:")
                : tr("(after")}{" "}
              {feeBps / 100} {tr("% fee)")}{" "}
            </dd>
          </div>
          <div>
            <dt className="text-muted">
              {tr(isBuyer ? "Bond backing you" : "Bond slice")}
            </dt>
            <dd>
              {bondStr}
              {ad.status === AdStatus.Closed
                ? " (ad closed by the maker; your reservation still settles)"
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted"> {tr("Protection after declaring")} </dt>
            <dd>
              {cfg ? Number(cfg.proof_window) / 60 : 120} {tr("min, then")}{" "}
              {lateClaimDays} {tr("-day bond claim")}{" "}
            </dd>
          </div>
          <div>
            <dt className="text-muted"> {tr("Payee details")} </dt>
            <dd>
              {" "}
              {tr(
                "encrypted on-chain; shown to the buyer and maker after a wallet signature",
              )}{" "}
            </dd>
          </div>
          <div>
            <dt className="text-muted"> {tr("Payment reference")} </dt>
            <dd className="mono">{paymentReference(r.id, r.buyer)}</dd>
          </div>
          <div>
            <dt className="text-muted"> {tr("Buyer wallet")} </dt>
            <dd className="mono">{short(r.buyer, 8)}</dd>
          </div>
          <div>
            <dt className="text-muted">Maker</dt>
            <dd className="mono">{short(ad.seller, 8)}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

function Copy({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const c = useCopy();
  const { t: tr } = useI18n();
  return (
    <button
      type="button"
      className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:bg-panel-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setFailed(false);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setFailed(true);
        }
      }}
    >
      {failed
        ? c("Select and copy manually", "Seçip elle kopyalayın")
        : done
          ? tr("copied ✓")
          : (label ?? tr("copy"))}
    </button>
  );
}

function StepCard({
  n,
  title,
  state,
  summary,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "active" | "todo";
  summary?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { t: tr } = useI18n();
  const expanded = state === "active" || (state === "done" && open);
  return (
    <div
      className={`rounded-2xl border p-4 ${state === "active" ? "border-accent bg-panel shadow-sm" : state === "done" ? "border-line bg-panel" : "border-dashed border-line opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${state === "done" ? "bg-ok text-white" : state === "active" ? "bg-accent text-accent-fg" : "bg-panel-2 text-muted"}`}
          >
            {state === "done" ? "✓" : n}
          </span>
          <div>
            <p className="font-semibold">{title}</p>
            {state === "done" && summary && !open && (
              <div className="text-sm text-muted break-words">{summary}</div>
            )}
          </div>
        </div>
        {state === "done" && children && (
          <button
            type="button"
            className="shrink-0 whitespace-nowrap text-xs text-muted underline decoration-dotted"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? tr("hide") : tr("show")}
          </button>
        )}
      </div>
      {expanded && children && <div className="mt-4 space-y-3">{children}</div>}
    </div>
  );
}

function BuyerFlow({
  mode,
  r,
  ad,
  cfg,
  info,
  proverDown,
  address,
  payee,
  revealing,
  onReveal,
  onDeclare,
  onClaim,
  onRelease,
  busy,
  expired,
}: {
  mode: "buy" | "bond";
  r: Reservation;
  ad: Ad;
  cfg: EscrowConfig | null;
  info: ProverInfo | null;
  proverDown: boolean;
  address: string;
  payee: Revealed | null;
  revealing: boolean;
  onReveal: () => Promise<void>;
  onDeclare: () => Promise<void>;
  onClaim: (pv: string, proof: string) => Promise<void>;
  onRelease: () => Promise<void>;
  busy: string | null;
  expired: boolean;
}) {
  const t = tokenByAddress(ad.token);
  const { signMessage } = useWallet();
  const { t: tr } = useI18n();
  const [linkCopied, setLinkCopied] = useState(false);
  const [bank, setBank] = useState<"ziraat" | "vakif">(() => {
    try {
      return localStorage.getItem("zkotc-bank") === "vakif"
        ? "vakif"
        : "ziraat";
    } catch {
      return "ziraat";
    }
  });
  const pickBank = (b: "ziraat" | "vakif") => {
    setBank(b);
    try {
      localStorage.setItem("zkotc-bank", b);
    } catch {
      /* ignore */
    }
  };
  const [detectedBank, setDetectedBank] = useState<"ziraat" | "vakif" | null>(
    null,
  );
  /** The bank is decided by the e-mail's DKIM signature, not by the switch: read the file's headers and follow them. */
  const fileVersion = useRef(0);
  const takeFile = (f: File | null) => {
    if (uploadingRef.current) return;
    setConsent(false);
    const version = ++fileVersion.current;
    const problem = f ? receiptFileError(f) : null;
    if (problem) {
      setFile(null);
      setJobErr(
        problem === "format"
          ? "Choose the original .eml email, not a PDF or screenshot."
          : "Choose an email between 1 byte and 2 MB.",
      );
      return;
    }
    setJobErr(null);
    setFile(f);
    setDetectedBank(null);
    if (!f) return;
    f.slice(0, 64 * 1024)
      .text()
      .then((head) => {
        if (version !== fileVersion.current) return;
        const m = /d=\s*([a-z0-9.-]+)/i.exec(head.replace(/\r?\n[ \t]+/g, " "));
        const d = m?.[1]?.toLowerCase() ?? "";
        const b =
          d === "vakifbank.com.tr"
            ? "vakif"
            : d === "ileti.ziraatbank.com.tr"
              ? "ziraat"
              : null;
        setDetectedBank(b);
        if (b) pickBank(b);
      })
      .catch(() => {});
  };
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const copy = useCopy();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [job, setJob] = useState<ProverJob | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const bond = mode === "bond";
  const declared = r.paid_declared_at !== 0n;
  const [recoverPaid, setRecoverPaid] = useState(false);
  const paid = bond || declared || recoverPaid;
  const minutesLeft = (Number(r.lock_expires_at) - nowSec()) / 60;
  const tooLateToPay = !bond && !paid && minutesLeft < config.minMinutesToPay;
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const payout = r.amount - (r.amount * BigInt(feeBps)) / 10000n;
  const prize = bond
    ? `${fmtToken(r.bond_slice, ad.decimals)} ${t.symbol}`
    : `${fmtToken(payout, ad.decimals)} ${t.symbol}`;
  const reference = paymentReference(r.id, address);
  const canPay = !!payee && payee.verified;
  const proved = job?.status === "done" && !!job.proof && !!job.public_values;
  const proving = !!job && job.status !== "done" && job.status !== "failed";
  const jobStep = job ? JOB_STEPS.findIndex((s) => s.key === job.status) : -1;
  const elapsed = job ? Math.max(0, nowSec() - job.created_at) : 0;

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`zkotc-job-${address}-r${r.id}`);
    } catch {}
    if (!saved) return;
    let alive = true;
    getJob(saved)
      .then((j) => {
        if (alive && String(j.offer_id) === String(r.id)) setJob(j);
      })
      .catch(() => {
        if (alive)
          setJobErr(
            "Your previous proof job is unavailable. Try again; if it was lost, upload the original email again. Your payment status has not changed.",
          );
      });
    return () => {
      alive = false;
    };
  }, [r.id, address]);

  const jobId = job?.id;
  useEffect(() => {
    if (!proving || !jobId) {
      if (poll.current) clearInterval(poll.current);
      return;
    }
    let alive = true,
      pending = false;
    poll.current = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await getJob(jobId);
        if (alive) {
          setJob(next);
          setJobErr(null);
        }
      } catch {
        if (alive)
          setJobErr(
            "Verification status is unavailable. Reconnecting automatically; keep your original email and watch the deadline.",
          );
      } finally {
        pending = false;
        if (alive) setTick((x) => x + 1);
      }
    }, 3000);
    return () => {
      alive = false;
      if (poll.current) clearInterval(poll.current);
    };
  }, [jobId, proving]);

  const submitEml = async (emlBase64: string) => {
    // the wallet signs a short message (no transaction); /api/prove checks the reservation on-chain and forwards
    const j = await requestProof({
      reservationId: r.id,
      address,
      signMessage,
      emlBase64,
    });
    if (String(j.offer_id) !== String(r.id))
      throw new Error(
        "Verification returned a different trade. Retry without making another payment.",
      );
    try {
      localStorage.setItem(`zkotc-job-${address}-r${r.id}`, j.id);
    } catch {}
    setJob(j);
  };

  const upload = async () => {
    if (!file || !consent || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setJobErr(null);
    try {
      await submitEml(await fileToBase64(file));
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : String(e));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const s1: "done" | "active" | "todo" = canPay ? "done" : "active";
  const s2: "done" | "active" | "todo" = paid
    ? "done"
    : canPay
      ? "active"
      : "todo";
  const s3: "done" | "active" | "todo" = proved
    ? "done"
    : paid && canPay
      ? "active"
      : "todo";
  const s4: "done" | "active" | "todo" = proved ? "active" : "todo";
  void tick;

  return (
    <div className="space-y-3">
      {bond && (
        <Alert kind="warn">
          {" "}
          {tr(
            "Your reservation was released after you declared the payment on",
          )}{" "}
          {fmtDate(r.paid_declared_at)} {tr(". Prove the transfer before")}{" "}
          <b>{fmtDate(r.late_claim_until)}</b>{" "}
          {tr("to receive the maker's bond slice of")} <b>{prize}</b>{" "}
          {tr(". The tokens themselves are no longer reserved for you.")}{" "}
        </Alert>
      )}
      {!bond && expired && !paid && (
        <Alert kind="warn">
          {" "}
          {tr(
            "Your reservation timer ended. Do not start a new bank transfer. If you already paid, verify the original receipt promptly. The declaration deadline has passed; settlement is only possible while the reservation remains active.",
          )}{" "}
        </Alert>
      )}

      {/* 1 · reveal */}
      <StepCard
        n={1}
        title={tr(bond ? "Where you paid" : "Where to pay")}
        state={s1}
        summary={
          payee ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {payee.name}
              {bankByName(payee.bank) && (
                <span className="inline-flex items-center gap-1">
                  <BankLogo bank={bankByName(payee.bank)!} size={18} />
                  {payee.bank}
                </span>
              )}
              <span className="mono">{fmtIBAN(payee.iban)}</span>
            </span>
          ) : undefined
        }
      >
        {!payee ? (
          <>
            <p className="text-sm text-muted">
              {tr(
                "The maker's bank details are encrypted on-chain. Sign a message with your wallet to reveal them — no transaction, no fee.",
              )}
            </p>
            <Button
              className="w-full sm:w-auto"
              onClick={onReveal}
              disabled={revealing}
            >
              {revealing ? (
                <>
                  <Spinner /> {tr("Waiting for your wallet…")}
                </>
              ) : (
                tr("Show payment details")
              )}
            </Button>
          </>
        ) : !payee.verified ? (
          <Alert kind="error">
            <b> {tr("Do not pay.")} </b> {tr("The revealed details (")}{" "}
            {fmtIBAN(payee.iban)}, {payee.name}{" "}
            {tr(
              ") do not match this ad's on-chain commitment, so no proof could ever settle here. Release the reservation and pick another ad.",
            )}{" "}
          </Alert>
        ) : (
          <p className="text-sm text-ok">
            {tr("✓ Verified against the maker's on-chain commitment.")}
          </p>
        )}
      </StepCard>

      {/* 2 · pay + declare */}
      <StepCard
        n={2}
        title={
          bond
            ? tr("Payment declared")
            : `${tr("Send")} ${fmtTRY(r.try_amount_kurus)} ${tr("by FAST, then declare it")}`
        }
        state={s2}
        summary={
          declared ? (
            <>
              {tr("Declared")} {fmtDate(r.paid_declared_at)}
              {r.status === ReservationStatus.Active && (
                <>
                  {" "}
                  · {tr("protected until")} {fmtDate(r.lock_expires_at)}
                </>
              )}
            </>
          ) : undefined
        }
      >
        {canPay && (
          <>
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="bg-panel-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {tr("FAST transfer from your Ziraat or VakıfBank account")}
              </div>
              <dl className="divide-y divide-line text-sm">
                {[
                  [
                    "Alıcı IBAN",
                    fmtIBAN(payee!.iban),
                    payee!.iban.replace(/\s+/g, ""),
                  ],
                  ["Alıcı adı", payee!.name, payee!.name],
                  ...(payee!.bank
                    ? [["Alıcı banka", payee!.bank, payee!.bank]]
                    : []),
                  [
                    "Tutar",
                    fmtTRY(r.try_amount_kurus),
                    (Number(r.try_amount_kurus) / 100)
                      .toFixed(2)
                      .replace(".", ","),
                  ],
                  ["Açıklama", reference, reference],
                ].map(([k, v, c]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <dt className="text-muted">{k}</dt>
                    <dd className="flex min-w-0 flex-wrap justify-end items-center gap-2">
                      <span
                        className={`select-all break-all ${k === "Alıcı IBAN" || k === "Açıklama" ? "mono" : ""} ${k === "Tutar" || k === "Açıklama" ? "font-semibold" : ""}`}
                      >
                        {v}
                      </span>
                      <Copy value={c} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="text-xs text-muted">
              {tr(
                "The Açıklama line is required: it ties the payment to your wallet, so nobody who obtains your e-mail can claim in your place.",
              )}
            </p>
            {!paid && (
              <>
                {tooLateToPay && (
                  <Alert kind="warn">
                    {copy(
                      "Too little time remains to start a payment. Do not send money now. If you already sent it, continue below.",
                      "Ödeme başlatmak için yeterli süre kalmadı. Şimdi para göndermeyin. Zaten gönderdiyseniz aşağıdan devam edin.",
                    )}
                  </Alert>
                )}
                {expired ? (
                  <Button onClick={() => setRecoverPaid(true)}>
                    {copy(
                      "I already paid — verify receipt",
                      "Zaten ödedim — dekontu doğrula",
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={onDeclare}
                      disabled={!!busy}
                    >
                      {busy === "Payment declared on-chain" ? (
                        <>
                          <Spinner /> {tr("Confirm in wallet…")}
                        </>
                      ) : (
                        tr("I have sent the transfer")
                      )}
                    </Button>
                    <p className="text-xs text-muted">
                      {" "}
                      {tr("Declaring locks the maker out for")}{" "}
                      {cfg ? Number(cfg.proof_window) / 60 : 120}{" "}
                      {tr("minutes and puts their bond of")}{" "}
                      {fmtToken(r.bond_slice, ad.decimals)} {t.symbol}{" "}
                      {tr(
                        "behind your claim. Only declare after the transfer has left your account.",
                      )}{" "}
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
      </StepCard>

      {/* 3 · prove */}
      <StepCard
        n={3}
        title={tr("Verify your receipt")}
        state={s3}
        summary={
          job?.dekont ? (
            <>
              Dekont {fmtYmd(job.dekont.date_yyyymmdd)} {job.dekont.time} ·{" "}
              {fmtTRY(job.dekont.amount_kurus)} {tr("· proof ready")}{" "}
            </>
          ) : undefined
        }
      >
        {!job ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">{tr("I paid from")}</span>
              {(["ziraat", "vakif"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => pickBank(b)}
                  className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1 ${bank === b ? "border-accent bg-accent/10 font-medium" : "border-line text-muted hover:text-fg"}`}
                >
                  {b === "ziraat" ? "Ziraat" : "VakıfBank"}
                </button>
              ))}
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              {bank === "ziraat" ? (
                <li>
                  <b className="text-fg">Ziraat Mobil</b> →{" "}
                  {tr("Hesap Hareketleri → the")} ₺
                  {(Number(r.try_amount_kurus) / 100).toLocaleString("tr-TR")}{" "}
                  {tr("transfer →")} <b className="text-fg">Dekont Gönder</b> →{" "}
                  <b className="text-fg">E-posta</b>
                  {tr(
                    '. The bank e-mails it to your registered address within a minute (subject "e-dekont").',
                  )}
                </li>
              ) : (
                <li>
                  <b className="text-fg">VakıfBank Mobil</b> →{" "}
                  {tr("Hesap Hareketleri → the")} ₺
                  {(Number(r.try_amount_kurus) / 100).toLocaleString("tr-TR")}{" "}
                  {tr("transfer →")} <b className="text-fg">Dekont</b> →{" "}
                  <b className="text-fg">E-posta</b>
                  {tr(
                    '. The bank e-mails it to your registered address within a minute (subject "Dekont", attachment Dekont.pdf).',
                  )}
                </li>
              )}
              <li>
                {tr("Open that e-mail in")}{" "}
                <b className="text-fg">{tr("Gmail on a computer")}</b> → ⋮{" "}
                {tr("menu →")}{" "}
                <b className="text-fg"> {tr("Show original")} </b> →{" "}
                <b className="text-fg"> {tr("Download original")} </b>
                {tr(
                  ", and drop the file below. Do not forward it: forwarding breaks the bank's signature.",
                )}
              </li>
            </ol>
            <label
              className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center text-sm ${file ? "border-ok/60 bg-ok/5" : "border-line hover:border-accent/60"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) takeFile(f);
              }}
            >
              <input
                type="file"
                disabled={uploading}
                accept=".eml,message/rfc822"
                className="sr-only"
                onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <span className="font-medium">
                  {file.name}
                  {detectedBank && (
                    <span className="ml-2 rounded-md bg-ok/15 px-1.5 py-0.5 text-xs text-ok">
                      {detectedBank === "vakif" ? "VakıfBank" : "Ziraat"}{" "}
                      {tr("receipt detected")}{" "}
                    </span>
                  )}
                  {file && detectedBank === null && (
                    <span className="ml-2 rounded-md bg-warn/15 px-1.5 py-0.5 text-xs text-warn">
                      {" "}
                      {tr("no Ziraat/VakıfBank signature found")}{" "}
                    </span>
                  )}
                </span>
              ) : (
                <span className="font-medium">
                  {tr("Drop the .eml file here, or click to choose it")}
                </span>
              )}
              <span className="text-xs text-muted">
                {" "}
                {tr("Apple Mail: File → Save As → Raw Message Source")}{" "}
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {tr(
                  "Send this one e-mail to the prover; it is kept in memory only and only hashes, the amount, the date and a nullifier go on-chain.",
                )}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setShowPrivacy((v) => !v)}
                >
                  {showPrivacy ? tr("less") : tr("details")}
                </button>
                {showPrivacy && (
                  <span className="block pt-1">
                    {" "}
                    {tr("Prover:")}{" "}
                    <span className="mono">{config.proverUrl}</span>
                    {info
                      ? ` · mode ${info.prover_mode} · DKIM key from ${info.dkim_source}`
                      : ""}{" "}
                    {tr(
                      ". The e-mail is checked (DKIM signature, recipient, amount, reference) before proving and discarded when the job ends.",
                    )}{" "}
                  </span>
                )}
              </span>
            </label>
            {proverDown && (
              <Alert kind="warn">
                {copy(
                  "Receipt verification is temporarily unavailable. Check your deadline above: payment protection is time-limited. Keep the original email and retry when the service returns.",
                  "Dekont doğrulaması geçici olarak kullanılamıyor. Yukarıdaki süreyi kontrol edin: ödeme koruması süreyle sınırlıdır. Orijinal e-postayı saklayın ve hizmet geri geldiğinde tekrar deneyin.",
                )}
              </Alert>
            )}
            <Button
              className="w-full sm:w-auto"
              onClick={upload}
              disabled={!file || !consent || proverDown || uploading}
            >
              {uploading
                ? copy(
                    "Waiting for wallet / starting verification…",
                    "Cüzdan bekleniyor / doğrulama başlatılıyor…",
                  )
                : copy("Verify receipt", "Dekontu doğrula")}
            </Button>
            <p className="text-xs text-muted">
              {tr(
                "Your wallet will ask for a signature first (no transaction, no fee): it proves this reservation is yours before the prover spends GPU time.",
              )}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted sm:hidden">
              {tr(
                "On a phone? Copy this page's link and open it on a computer for the upload step.",
              )}
              <button
                type="button"
                className="rounded-md border border-line px-2 py-0.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  } catch {
                    setJobErr(
                      copy(
                        "Copy the address from your browser to continue on a computer.",
                        "Bilgisayarda devam etmek için tarayıcınızın adresini kopyalayın.",
                      ),
                    );
                  }
                }}
              >
                {linkCopied ? tr("Link copied ✓") : tr("Copy link")}
              </button>
            </p>
            {jobErr && <Alert kind="error">{jobErr}</Alert>}
          </>
        ) : (
          <div className="space-y-3">
            {jobErr && <Alert kind="warn">{jobErr}</Alert>}
            {proving && (
              <div>
                <p role="status" className="text-sm text-muted">
                  <Spinner /> {copy("Verifying receipt", "Dekont doğrulanıyor")}{" "}
                  · {elapsed}s
                </p>
              </div>
            )}
            <ol className="space-y-1 text-sm">
              {JOB_STEPS.map((st, i) => (
                <li
                  key={st.key}
                  className={`flex items-center gap-2 ${i < jobStep || job.status === "done" ? "text-ok" : i === jobStep ? "" : "text-muted"}`}
                >
                  {i === jobStep && job.status !== "done" ? (
                    <Spinner />
                  ) : (
                    <span className="w-4 text-center">
                      {i < jobStep || job.status === "done" ? "✓" : "·"}
                    </span>
                  )}
                  <span className="font-medium">
                    {tr(st.key === "executing" ? "Checking email" : st.label)}
                  </span>
                </li>
              ))}
            </ol>
            {job.dekont && (
              <p className="rounded-lg bg-panel-2 p-3 text-xs">
                Dekont:{" "}
                <b>
                  {fmtYmd(job.dekont.date_yyyymmdd)} {job.dekont.time}
                </b>{" "}
                · {job.dekont.fis_no} · {fmtTRY(job.dekont.amount_kurus)} →{" "}
                {job.dekont.recipient_name ?? "?"}
                {job.dekont.fast_sorgu_no
                  ? ` · FAST ${job.dekont.fast_sorgu_no}`
                  : ""}
              </p>
            )}
            {job.status === "failed" && (
              <Alert kind="error">
                {" "}
                {tr("Proof failed:")} {job.error}.{" "}
                <button
                  className="underline"
                  onClick={() => {
                    try {
                      localStorage.removeItem(`zkotc-job-${address}-r${r.id}`);
                    } catch {}
                    setJob(null);
                  }}
                >
                  {" "}
                  {tr("Try again")}{" "}
                </button>
              </Alert>
            )}
          </div>
        )}
      </StepCard>

      {/* 4 · claim */}
      <StepCard
        n={4}
        title={
          bond
            ? `${tr("Claim the bond:")} ${prize}`
            : `${tr("Receive")} ${prize}`
        }
        state={s4}
      >
        {proved && (
          <>
            <p className="text-sm text-muted">
              {" "}
              {tr("The proof (")} {(job!.proof!.length - 2) / 2}{" "}
              {tr(
                "bytes) is verified by the Soroban verifier contract inside the same transaction that pays you.",
              )}{" "}
            </p>
            {!cfg ||
              (bytesToHex(cfg.image_id).toLowerCase() !==
                job?.image_id.replace(/^0x/, "").toLowerCase() && (
                <Alert kind="error">
                  {" "}
                  {tr(
                    "Cannot confirm this proof against the current configuration. Reload this page before claiming.",
                  )}{" "}
                </Alert>
              ))}
            <Button
              className="w-full sm:w-auto"
              onClick={() => onClaim(job!.public_values!, job!.proof!)}
              disabled={
                !!busy ||
                !cfg ||
                bytesToHex(cfg.image_id).toLowerCase() !==
                  job?.image_id.replace(/^0x/, "").toLowerCase()
              }
            >
              {busy ? (
                <>
                  <Spinner /> {tr("Confirm in wallet…")}
                </>
              ) : (
                `${tr("Receive")} ${prize}`
              )}
            </Button>
          </>
        )}
      </StepCard>

      {!bond && !paid && (
        <p className="text-xs text-muted">
          {" "}
          {tr("Changed your mind and have")} <b> {tr("not")} </b> {tr("paid?")}{" "}
          <button className="underline" onClick={onRelease} disabled={!!busy}>
            {" "}
            {tr("Release the reservation")}{" "}
          </button>{" "}
          ·{" "}
          <Link className="underline" href="/market">
            {" "}
            {tr("Back to the market")}{" "}
          </Link>
        </p>
      )}
      {!bond && paid && expired && !proved && (
        <p className="text-xs text-muted">
          {" "}
          {tr(
            "Timer ended and you will not settle this one (never paid, or gave up)?",
          )}{" "}
          <button className="underline" onClick={onRelease} disabled={!!busy}>
            {" "}
            {tr("Release the reservation")}{" "}
          </button>{" "}
          {tr(
            "to free your reservation slot. Releasing it yourself waives the bond claim, so if you did pay, upload the receipt and settle instead.",
          )}{" "}
        </p>
      )}
    </div>
  );
}
