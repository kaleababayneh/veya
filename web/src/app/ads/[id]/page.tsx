"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { validId } from "@/lib/ux";
import { ReceiptGuide, useCopy } from "@/components/Product";
import { AdStatus, ReservationStatus } from "@/contracts/escrow";
import { useWalletSessionKey } from "@/lib/useWalletSessionKey";
import { useWallet } from "@/lib/wallet";
import { useI18n } from "@/lib/i18n";
import {
  escrow,
  getAd,
  getConfig,
  listReservations,
  send,
  unwrapResult,
  explainError,
  ERROR_HELP,
  quoteKurus,
  tokensForKurus,
  reservationLabel,
  type Ad,
  type Reservation,
  type EscrowConfig,
} from "@/lib/escrow";
import { requestReveal, type Revealed } from "@/lib/reveal";
import { tokenByAddress } from "@/lib/tokens";
import {
  fmtToken,
  fmtTRY,
  fmtIBAN,
  fmtDate,
  parseToken,
  parseTRY,
  nowSec,
  short,
} from "@/lib/format";
import { accountUrl } from "@/lib/config";
import {
  AdBadge,
  Alert,
  BackLink,
  Button,
  Card,
  Field,
  inputCls,
  Spinner,
  TxLink,
} from "@/components/ui";

export default function AdPage() {
  const { address } = useWallet();
  const { id } = useParams<{ id: string }>();
  const key = useWalletSessionKey(address);
  return <AdDetails key={`${id}:${key}`} />;
}
function AdDetails() {
  const { id: idParam } = useParams<{ id: string }>();
  const { t: tr } = useI18n();
  const id = useMemo(() => validId(idParam), [idParam]);
  const router = useRouter();
  const { address, connect, signTransaction, signMessage } = useWallet();

  const [ad, setAd] = useState<Ad | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; hash: string } | null>(
    null,
  );
  const [payee, setPayee] = useState<Revealed | null>(null);
  const [priceInput, setPriceInput] = useState("");

  const refresh = useCallback(
    () =>
      (id === null
        ? Promise.reject(new Error("Invalid offer link"))
        : getAd(id)
      ).then(
        (a) => {
          setAd(a);
          setLoadErr(null);
          listReservations()
            .then((rs) => setReservations(rs.filter((r) => r.ad_id === id)))
            .catch(() => {});
        },
        (e) => setLoadErr(explainError(e)),
      ),
    [id],
  );

  useEffect(() => {
    refresh();
    getConfig()
      .then(setCfg)
      .catch(() => {});
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const actionLock = useRef(false);
  const run = async (label: string, fn: () => Promise<{ hash: string }>) => {
    if (actionLock.current) return;
    setErr(null);
    if (!address) return connect();
    actionLock.current = true;
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
      actionLock.current = false;
      setBusy(null);
    }
  };

  if (!ad) {
    return (
      <div className="space-y-4">
        <BackLink />
        {loadErr || err ? (
          <Alert kind="error">{loadErr || err}</Alert>
        ) : (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> {tr("Loading ad #")} {idParam}…
          </div>
        )}
      </div>
    );
  }

  const t = tokenByAddress(ad.token);
  const isSeller = !!address && address === ad.seller;
  const now = nowSec();
  const expired = ad.expires_at !== 0n && Number(ad.expires_at) <= now;
  const minTokens = tokensForKurus(
    ad.min_try_kurus,
    ad.price_kurus,
    ad.decimals,
  );
  const soldOut = ad.remaining < minTokens;
  const open = ad.status === AdStatus.Active && !expired && !soldOut;
  const feeBps = cfg ? Number(cfg.fee_bps) : 25;
  const c = () => escrow(address, signTransaction);

  const setPrice = () =>
    run("Price updated", async () => {
      const r = await send(
        await c().set_price({ id: ad.id, price_kurus: parseTRY(priceInput) }),
      );
      unwrapResult(r.result);
      return r;
    });
  const closeAd = () =>
    run("Ad closed, funds withdrawn", async () => {
      const r = await send(await c().close_ad({ id: ad.id }));
      unwrapResult(r.result);
      return r;
    });
  const revealMine = async () => {
    setErr(null);
    try {
      setPayee(await requestReveal(ad.id, null, address!, signMessage));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="product-page offer-detail">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {tr("Ad")} #{ad.id.toString()} · {ad.nickname || tr("maker")}{" "}
            <span className="mono">{short(ad.seller, 5)}</span>
            {isSeller && " (you)"}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t.symbol} · {fmtTRY(ad.price_kurus)}{" "}
            <span className="text-base font-medium text-muted">
              {tr("per")} {t.symbol}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {fmtToken(ad.remaining, ad.decimals)} {t.symbol} {tr("available")}{" "}
            (≈ {fmtTRY(quoteKurus(ad.remaining, ad.price_kurus, ad.decimals))})
            · {tr("limits")} {fmtTRY(ad.min_try_kurus)} –{" "}
            {fmtTRY(ad.max_try_kurus)} {tr("per trade")} · {ad.settled_count}{" "}
            {tr("trades completed")}
            {ad.expires_at !== 0n &&
              ` · ${tr("until")} ${fmtDate(ad.expires_at)}`}
          </p>
        </div>
        <AdBadge status={ad.status} soldOut={soldOut} />
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

      {!isSeller &&
        (open && cfg && !loadErr ? (
          <QuotePanel
            ad={ad}
            feeBps={feeBps}
            address={address}
            busy={busy}
            onReserve={(amount) =>
              run("Reserved", async () => {
                const latest = await getAd(ad.id);
                if (
                  latest.price_kurus !== ad.price_kurus ||
                  latest.remaining < amount ||
                  latest.status !== AdStatus.Active ||
                  (latest.expires_at !== 0n &&
                    latest.expires_at <= BigInt(nowSec()))
                ) {
                  await refresh();
                  throw new Error(
                    "Offer changed. Review the new price and availability before reserving.",
                  );
                }
                const r = await send(
                  await c().reserve({ id: ad.id, buyer: address!, amount }),
                );
                const res = unwrapResult(r.result);
                router.push(`/r/${res.id.toString()}?reserved=${r.hash}`);
                return r;
              })
            }
          />
        ) : (
          <Alert kind="warn">
            {!cfg
              ? "Configuration unavailable. Reload before reserving."
              : loadErr
                ? "Refresh the page before reserving."
                : ad.status === AdStatus.Closed
                  ? "The maker closed this ad."
                  : expired
                    ? "This ad has expired."
                    : "This ad is fully reserved right now; check back when a reservation completes or is released."}
          </Alert>
        ))}

      {isSeller && (
        <Card className="space-y-4">
          <h2 className="font-semibold"> {tr("Your ad")} </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted"> {tr("Unreserved")} </dt>
              <dd className="font-medium">
                {fmtToken(ad.remaining, ad.decimals)} {t.symbol}
              </dd>
            </div>
            <div>
              <dt className="text-muted"> {tr("Reserved by buyers")} </dt>
              <dd className="font-medium">
                {fmtToken(ad.reserved, ad.decimals)} {t.symbol}
              </dd>
            </div>
            <div>
              <dt className="text-muted"> {tr("Bond pool")} </dt>
              <dd className="font-medium">
                {fmtToken(ad.bond_available, ad.decimals)} {tr("free ·")}{" "}
                {fmtToken(ad.bond_held, ad.decimals)} {tr("earmarked")}{" "}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Completed</dt>
              <dd className="font-medium">{ad.settled_count} trades</dd>
            </div>
          </dl>
          {ad.status === AdStatus.Active && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={tr("New price (₺ per token)")}>
                <input
                  className={inputCls}
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder={(Number(ad.price_kurus) / 100).toFixed(2)}
                  inputMode="decimal"
                />
              </Field>
              <Button
                variant="ghost"
                onClick={setPrice}
                disabled={!!busy || !priceInput}
              >
                {" "}
                {tr("Update price")}{" "}
              </Button>
              <Button variant="danger" onClick={closeAd} disabled={!!busy}>
                {busy === "Ad closed, funds withdrawn" ? (
                  <>
                    <Spinner /> Confirm in wallet…
                  </>
                ) : (
                  `Close ad & withdraw ${fmtToken(ad.remaining + ad.bond_available, ad.decimals)} ${t.symbol}`
                )}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted">
            {" "}
            {tr(
              "Closing withdraws the unreserved tokens and the free part of the bond at once. Active reservations keep running; their tokens and bond slices come to you as they settle or release.",
            )}{" "}
          </p>
          <div>
            {payee ? (
              <p className="text-sm">
                {" "}
                {tr("Your payee details on this ad:")}{" "}
                <span className="mono">{fmtIBAN(payee.iban)}</span> ·{" "}
                {payee.name}{" "}
                {payee.verified ? (
                  <span className="text-ok">
                    {" "}
                    {tr("✓ matches the on-chain commitment")}{" "}
                  </span>
                ) : (
                  <span className="text-danger">
                    {" "}
                    {tr(
                      "✗ does not match the on-chain commitment — buyers will refuse to pay",
                    )}{" "}
                  </span>
                )}
              </p>
            ) : (
              <Button variant="ghost" onClick={revealMine}>
                {" "}
                {tr("Show my encrypted payee details")}{" "}
              </Button>
            )}
          </div>
          {reservations.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {" "}
                {tr("Reservations on this ad")}{" "}
              </h3>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {reservations.map((r) => (
                  <li
                    key={r.id.toString()}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span>
                      #{r.id.toString()} · {fmtToken(r.amount, ad.decimals)}{" "}
                      {t.symbol} for {fmtTRY(r.try_amount_kurus)} ·{" "}
                      <span className="mono">{short(r.buyer, 4)}</span>
                      {r.paid_declared_at !== 0n &&
                        r.status === ReservationStatus.Active && (
                          <span className="ml-2 text-warn">
                            {" "}
                            {tr("payment declared")}{" "}
                          </span>
                        )}
                    </span>
                    <Link
                      className="underline decoration-dotted"
                      href={`/r/${r.id}`}
                    >
                      {tr(reservationLabel[r.status])} →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {tr("How a trade works here")}
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            {tr("Reserve an amount: the tokens are held for you for")}{" "}
            {cfg ? Number(cfg.lock_duration) / 60 : 60}{" "}
            {tr("minutes at today's price.")}
          </li>
          <li>
            {tr(
              "The maker's IBAN and name are revealed to you only after reserving (they are encrypted on-chain). Pay by FAST from Ziraat with the payment reference in the description.",
            )}
          </li>
          <li>
            {tr("Declare the payment: the maker cannot withdraw for")}{" "}
            {cfg ? Number(cfg.proof_window) / 60 : 120}{" "}
            {tr("minutes, and their bond backs you afterwards.")}
          </li>
          <li>
            {tr("Upload the original email, verify it and receive your")}{" "}
            {t.symbol} {tr("(fee")} {feeBps / 100}%).
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          Maker{" "}
          <a
            className="underline decoration-dotted"
            href={accountUrl(ad.seller)}
            target="_blank"
            rel="noreferrer"
          >
            {ad.seller}
          </a>
        </p>
      </Card>
    </div>
  );
}

function QuotePanel({
  ad,
  feeBps,
  address,
  busy,
  onReserve,
}: {
  ad: Ad;
  feeBps: number;
  address: string | null;
  busy: string | null;
  onReserve: (amount: bigint) => Promise<void>;
}) {
  const { t: tr } = useI18n();
  const copy = useCopy();
  const search = useSearchParams();
  const [bank, setBank] = useState(search.get("bank") ?? "");
  const [receiptReady, setReceiptReady] = useState(false);
  const { ready, connecting } = useWallet();
  const t = tokenByAddress(ad.token);
  const [tryStr, setTryStr] = useState(search.get("amount") ?? "");
  const [tokStr, setTokStr] = useState(() => {
    try {
      return fmtToken(
        tokensForKurus(
          parseTRY(search.get("amount") ?? ""),
          ad.price_kurus,
          ad.decimals,
        ),
        ad.decimals,
      ).replace(/,/g, "");
    } catch {
      return "";
    }
  });
  const [amount, setAmount] = useState<bigint>(() => {
    try {
      const k = parseTRY(search.get("amount") ?? "");
      return k > 0n ? tokensForKurus(k, ad.price_kurus, ad.decimals) : 0n;
    } catch {
      return 0n;
    }
  });
  const [problem, setProblem] = useState<string | null>(null);

  const apply = (a: bigint) => {
    setAmount(a);
    const q = a > 0n ? quoteKurus(a, ad.price_kurus, ad.decimals) : 0n;
    if (a <= 0n) setProblem(null);
    else if (q < ad.min_try_kurus)
      setProblem(`Minimum trade is ${fmtTRY(ad.min_try_kurus)}.`);
    else if (q > ad.max_try_kurus)
      setProblem(`Maximum trade is ${fmtTRY(ad.max_try_kurus)}.`);
    else if (a > ad.remaining)
      setProblem(
        `Only ${fmtToken(ad.remaining, ad.decimals)} ${t.symbol} is available.`,
      );
    else setProblem(null);
    return q;
  };
  const onTry = (v: string) => {
    setTryStr(v);
    try {
      const k = parseTRY(v);
      const a = tokensForKurus(k, ad.price_kurus, ad.decimals);
      apply(a);
      setTokStr(fmtToken(a, ad.decimals).replace(/,/g, ""));
    } catch {
      setAmount(0n);
      setTokStr("");
      setProblem(v ? "Enter a TRY amount like 1000 or 1.250,50" : null);
    }
  };
  const onTok = (v: string) => {
    setTokStr(v);
    try {
      const a = parseToken(v, ad.decimals);
      const q = apply(a);
      setTryStr(
        (Number(q) / 100).toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );
    } catch {
      setAmount(0n);
      setTryStr("");
      setProblem(v ? "Enter a token amount" : null);
    }
  };
  const quick = (k: bigint) =>
    onTry(
      (Number(k) / 100).toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  const maxK =
    quoteKurus(ad.remaining, ad.price_kurus, ad.decimals) < ad.max_try_kurus
      ? quoteKurus(ad.remaining, ad.price_kurus, ad.decimals)
      : ad.max_try_kurus;
  const q = amount > 0n ? quoteKurus(amount, ad.price_kurus, ad.decimals) : 0n;
  const receive = amount - (amount * BigInt(feeBps)) / 10000n;
  const ok =
    amount > 0n &&
    !problem &&
    q >= ad.min_try_kurus &&
    q <= ad.max_try_kurus &&
    amount <= ad.remaining;
  const admitted = (bank === "ziraat" || bank === "vakif") && receiptReady;

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">
        {tr("Buy {sym} from {maker}")
          .replace("{sym}", t.symbol)
          .replace("{maker}", ad.nickname || short(ad.seller, 5))}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("You pay (TRY by FAST)")}>
          <input
            className={`${inputCls} text-lg`}
            value={tryStr}
            onChange={(e) => onTry(e.target.value)}
            placeholder="1.000,00"
            inputMode="decimal"
          />
        </Field>
        <Field label={`${tr("You reserve")} (${t.symbol})`}>
          <input
            className={`${inputCls} text-lg`}
            value={tokStr}
            onChange={(e) => onTok(e.target.value)}
            placeholder="25"
            inputMode="decimal"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 hover:bg-panel-2"
          onClick={() => quick(ad.min_try_kurus)}
        >
          {tr("min")} {fmtTRY(ad.min_try_kurus)}
        </button>
        {[50_000n, 100_000n, 250_000n]
          .filter((k) => k > ad.min_try_kurus && k < maxK)
          .map((k) => (
            <button
              key={k.toString()}
              type="button"
              className="rounded-full border border-line px-3 py-1 hover:bg-panel-2"
              onClick={() => quick(k)}
            >
              {fmtTRY(k)}
            </button>
          ))}
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 hover:bg-panel-2"
          onClick={() => quick(maxK)}
        >
          {tr("max")} {fmtTRY(maxK)}
        </button>
      </div>
      {problem && <Alert kind="warn">{problem}</Alert>}
      {ok && (
        <div className="rounded-xl bg-panel-2 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">{tr("Price")}</span>
            <span>
              {fmtTRY(ad.price_kurus)} / {t.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{tr("You send by FAST")}</span>
            <span className="font-semibold">{fmtTRY(q)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">
              {tr("Protocol fee")} ({feeBps / 100}%)
            </span>
            <span>
              −{fmtToken(amount - receive, ad.decimals)} {t.symbol}
            </span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 mt-2">
            <span className="text-muted">{tr("You receive")}</span>
            <span className="text-base font-semibold">
              {fmtToken(receive, ad.decimals)} {t.symbol}
            </span>
          </div>
        </div>
      )}
      <section className="readiness-panel">
        <h3>{copy("Before you reserve", "Rezervasyondan önce")}</h3>
        <Field label={copy("Your paying bank", "Ödeme bankanız")}>
          <select
            className={inputCls}
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setReceiptReady(false);
              try {
                localStorage.setItem("zkotc-bank", e.target.value);
              } catch {}
            }}
          >
            <option value="">{copy("Select a bank", "Banka seçin")}</option>
            <option value="ziraat">Ziraat</option>
            <option value="vakif">VakıfBank</option>
          </select>
        </Field>
        {bank === "other" ? (
          <Alert kind="warn">
            {copy(
              "Only Ziraat and VakıfBank receipt emails are supported. Do not pay from another bank.",
              "Yalnızca Ziraat ve VakıfBank dekont e-postaları destekleniyor. Başka bankadan ödeme yapmayın.",
            )}
          </Alert>
        ) : (
          bank && (
            <>
              <ReceiptGuide bank={bank} />
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={receiptReady}
                  onChange={(e) => setReceiptReady(e.target.checked)}
                />
                <span>
                  {copy(
                    "I can obtain the original email. I understand these are test tokens and the bank transfer uses real lira.",
                    "Orijinal e-postayı alabiliyorum. Tokenların test amaçlı olduğunu ve banka transferinde gerçek lira kullanıldığını anlıyorum.",
                  )}
                </span>
              </label>
            </>
          )
        )}
        <p className="text-sm text-muted">
          {copy(
            "Use a Stellar testnet wallet. Connecting does not reserve an offer; the reservation needs a separate transaction and network fee.",
            "Stellar testnet cüzdanı kullanın. Bağlanmak teklif ayırmaz; rezervasyon ayrı bir işlem ve ağ ücreti gerektirir.",
          )}
        </p>
      </section>
      <Button
        className="w-full"
        onClick={() => {
          try {
            localStorage.setItem("zkotc-bank", bank);
          } catch {}
          onReserve(amount);
        }}
        disabled={!ok || !admitted || !!busy || !ready || connecting}
      >
        {busy === "Reserved" ? (
          <>
            <Spinner /> {tr("Confirm in wallet…")}
          </>
        ) : address ? (
          ok ? (
            `${tr("Reserve")} ${fmtToken(amount, ad.decimals)} ${t.symbol} ${tr("for")} ${fmtTRY(q)}`
          ) : (
            tr("Enter an amount")
          )
        ) : (
          tr("Connect wallet to reserve")
        )}
      </Button>
      <p className="text-xs text-muted">
        {tr(
          "Reserving is a Stellar transaction that holds the maker's tokens for you; no money moves until you pay the maker.",
        )}
      </p>
    </Card>
  );
}
