"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import * as anchor from "@/lib/anchor";
import {
  Alert,
  Button,
  Card,
  Field,
  Spinner,
  TxLink,
  inputCls,
} from "@/components/ui";
import { PageHeading, useCopy } from "@/components/Product";
import { useRefresh } from "@/lib/useRefresh";
import { parseTRY, parseToken } from "@/lib/format";
import { ArrowMark } from "@/components/ArrowMark";
function decimal(value: string, places: number): string {
  const n = places === 2 ? parseTRY(value) : parseToken(value, places);
  if (n <= 0n) throw new Error("Enter a positive amount");
  const base = 10n ** BigInt(places);
  return `${n / base}.${(n % base).toString().padStart(places, "0")}`;
}
export default function Funding() {
  const { address } = useWallet();
  return <FundingSession key={address ?? "disconnected"} />;
}
function FundingSession() {
  const { address, connect, signTransaction, ready, connecting } = useWallet(),
    c = useCopy();
  const [token, setToken] = useState<string | null>(null),
    [side, setSide] = useState<"buy" | "sell">("buy"),
    [amount, setAmount] = useState("200");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [dep, setDep] = useState<anchor.DepositResp | null>(null),
    [wd, setWd] = useState<anchor.WithdrawResp | null>(null),
    [sent, setSent] = useState<string | null>(null),
    [watchId, setWatchId] = useState<string | null>(null),
    [committed, setCommitted] = useState("");
  const [quoted, setQuoted] = useState<{
    key: string;
    value: anchor.PriceResp | null;
    error?: string;
  } | null>(null);
  const locked = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const configured = anchor.anchorConfigured();
  const load = useCallback(async () => {
    if (!configured) return null;
    const [toml, info] = await Promise.all([anchor.discover(), anchor.info()]);
    return { toml, info };
  }, [configured]);
  const service = useRefresh(load, 60000);
  const loadAccount = useCallback(async () => {
    if (!token || !address) return null;
    const [balance, history] = await Promise.all([
      anchor.usdcBalance(address),
      anchor.transactions(token, 8),
    ]);
    return { balance, history };
  }, [token, address]);
  const account = useRefresh(loadAccount, 15000);
  const loadTransaction = useCallback(
    async () => (token && watchId ? anchor.transaction(token, watchId) : null),
    [token, watchId],
  );
  const transaction = useRefresh(loadTransaction, 10000),
    tx = transaction.data;
  const sandbox = service.data?.toml.homeDomain.includes("mock") ?? false;
  let normalized = "";
  try {
    normalized = decimal(amount, side === "buy" ? 2 : 7);
  } catch {}
  const quoteKey = `${side}:${normalized}`,
    quote = quoted?.key === quoteKey ? quoted.value : null;
  useEffect(() => {
    if (!token || !normalized) return;
    let live = true;
    const timer = setTimeout(() => {
      anchor
        .firmPrice(token, side, normalized)
        .then((value) => {
          if (live) setQuoted({ key: quoteKey, value });
        })
        .catch(() => {
          if (live) setQuoted({ key: quoteKey, value: null, error: "quote" });
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token, side, normalized, quoteKey]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
        account.refresh();
      }
    }
  };
  const login = () =>
    run(async () => {
      if (!address) {
        await connect();
        return;
      }
      const jwt = await anchor.login(address, signTransaction);
      if (!alive.current) return;
      await anchor.kyc(jwt, address);
      if (alive.current) setToken(jwt);
    });
  const start = () =>
    run(async () => {
      if (!token || !address || !quote || !normalized) return;
      const limits =
        service.data?.info[side === "buy" ? "deposit" : "withdraw"].USDC;
      if (!limits?.enabled)
        throw new Error(
          c("This service is unavailable.", "Bu hizmet kullanılamıyor."),
        );
      if (
        (limits.min_amount && Number(normalized) < limits.min_amount) ||
        (limits.max_amount && Number(normalized) > limits.max_amount)
      )
        throw new Error(
          c(
            "Amount is outside the provider limits.",
            "Tutar sağlayıcının limitleri dışında.",
          ),
        );
      if (side === "buy") {
        const d = await anchor.deposit(token, address, normalized);
        if (!alive.current) return;
        setDep(d);
        setWatchId(d.id);
      } else {
        const w = await anchor.withdraw(token, normalized);
        if (!alive.current) return;
        setWd(w);
        setWatchId(w.id);
      }
      setCommitted(normalized);
    });
  const trust = () =>
    run(async () => {
      if (!address) return;
      await anchor.addUsdcTrustline(address, signTransaction);
    });
  const send = () =>
    run(async () => {
      if (!wd || !address || sent) return;
      const hash = await anchor.sendUsdc(
        address,
        signTransaction,
        wd.account_id,
        committed,
        String(wd.memo ?? ""),
        wd.memo_type ?? "id",
      );
      if (alive.current) setSent(hash);
    });
  const status = (s: string) =>
    ({
      pending_user_transfer_start: c(
        "Waiting for your transfer",
        "Transferiniz bekleniyor",
      ),
      pending_external: c(
        "Bank transfer pending",
        "Banka transferi bekleniyor",
      ),
      pending_anchor: c("Provider processing", "Sağlayıcı işliyor"),
      pending_stellar: c(
        "Confirming on Stellar",
        "Stellar üzerinde onaylanıyor",
      ),
      pending_trust: c("Add USDC to your wallet", "Cüzdanınıza USDC ekleyin"),
      pending_user: c("Action needed", "İşlem gerekli"),
      completed: c("Completed", "Tamamlandı"),
      error: c("Failed", "Başarısız"),
      expired: c("Expired", "Süresi doldu"),
      refunded: c("Refunded", "İade edildi"),
    })[s] ?? s.replaceAll("_", " ");
  const limits =
    service.data?.info[side === "buy" ? "deposit" : "withdraw"].USDC;
  const reset = () => {
    setWatchId(null);
    setDep(null);
    setWd(null);
    setSent(null);
    setError(null);
  };
  return (
    <div className="product-page funding-page">
      <PageHeading
        eyebrow={c("SELLER TOOLS", "SATICI ARAÇLARI")}
        title={c("Keep your inventory moving.", "Bakiyenizi yönetin.")}
        description={c(
          "Fund or withdraw USDC through the configured provider.",
          "Yapılandırılmış sağlayıcı üzerinden USDC yatırın veya çekin.",
        )}
        action={
          <Link className="product-text-link" href="/sell">
            {c("Create an offer", "Teklif oluştur")} <ArrowMark />
          </Link>
        }
      />
      {!configured ? (
        <Card>
          <h2 className="section-title">
            {c(
              "Funding is not available here yet",
              "Burada fonlama henüz kullanılamıyor",
            )}
          </h2>
          <p>
            {c(
              "This deployment has no funding provider. You can use an existing testnet balance to create an offer.",
              "Bu sürümde fonlama sağlayıcısı yok. Mevcut testnet bakiyenizle teklif oluşturabilirsiniz.",
            )}
          </p>
          <Link href="/how-it-works" className="product-text-link">
            {c("Read the guide", "Rehberi okuyun")} <ArrowMark />
          </Link>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted break-all">
            {service.data?.toml.homeDomain} · {c("Testnet", "Testnet")}
            {sandbox
              ? c(
                  " · Simulated banking; do not send real money.",
                  " · Simüle banka; gerçek para göndermeyin.",
                )
              : c(
                  " · Provider terms and verification requirements apply.",
                  " · Sağlayıcının koşulları ve doğrulama şartları geçerlidir.",
                )}
          </p>
          {service.error && (
            <Alert kind="error">
              {c("Provider unavailable.", "Sağlayıcı kullanılamıyor.")}{" "}
              <button onClick={service.refresh} className="underline">
                {c("Retry", "Tekrar dene")}
              </button>
            </Alert>
          )}
          {!token ? (
            <Card className="space-y-4">
              <h2 className="section-title">
                {c(
                  "Connect your inventory wallet",
                  "Bakiyenizin bulunduğu cüzdanı bağlayın",
                )}
              </h2>
              <p>
                {c(
                  "Sign a login challenge. This signature does not move funds.",
                  "Giriş mesajını imzalayın. Bu imza fon aktarmaz.",
                )}
              </p>
              <Button
                onClick={login}
                disabled={busy || !ready || connecting || !service.data}
              >
                {busy ? (
                  <Spinner />
                ) : address ? (
                  c("Sign in with wallet", "Cüzdanla giriş yap")
                ) : (
                  c("Connect wallet", "Cüzdanı bağla")
                )}
              </Button>
            </Card>
          ) : (
            <>
              {account.error && (
                <Alert kind="warn">
                  {c(
                    "Could not refresh balance or history. Retry before sending funds.",
                    "Bakiye veya geçmiş yenilenemedi. Fon göndermeden önce tekrar deneyin.",
                  )}{" "}
                  <button className="underline" onClick={account.refresh}>
                    {c("Retry", "Tekrar dene")}
                  </button>
                </Alert>
              )}
              {!watchId ? (
                <Card className="space-y-5">
                  <div className="flex flex-wrap gap-3">
                    {(["buy", "sell"] as const).map((s) => (
                      <Button
                        key={s}
                        variant={side === s ? "primary" : "ghost"}
                        onClick={() => {
                          setSide(s);
                          setAmount(s === "buy" ? "200" : "1");
                          setQuoted(null);
                        }}
                        disabled={busy}
                        aria-pressed={side === s}
                      >
                        {s === "buy"
                          ? c("Add USDC", "USDC ekle")
                          : c("Withdraw USDC", "USDC çek")}
                      </Button>
                    ))}
                  </div>
                  <p className="text-sm text-muted">
                    {c("Wallet balance:", "Cüzdan bakiyesi:")}{" "}
                    {account.data?.balance ??
                      c("USDC not available", "USDC mevcut değil")}
                    {account.data?.balance === null && (
                      <button
                        className="underline ml-2"
                        onClick={trust}
                        disabled={busy}
                      >
                        {c("Add USDC trustline", "USDC varlığını ekle")}
                      </button>
                    )}
                  </p>
                  <Field
                    label={
                      side === "buy"
                        ? c("You pay (TRY)", "Ödeyeceğiniz (TL)")
                        : c("You send (USDC)", "Göndereceğiniz (USDC)")
                    }
                    hint={
                      side === "buy"
                        ? c(
                            "Use a comma for kuruş: 200,50",
                            "Kuruş için virgül kullanın: 200,50",
                          )
                        : c(
                            "Use a dot for decimals: 1.25",
                            "Ondalık için nokta kullanın: 1.25",
                          )
                    }
                  >
                    <input
                      className={inputCls}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      disabled={busy}
                    />
                  </Field>
                  {limits && (
                    <p className="text-sm text-muted">
                      {c("Limits:", "Limitler:")} {limits.min_amount ?? "—"} –{" "}
                      {limits.max_amount ?? "—"} ·{" "}
                      {c("Provider fee:", "Sağlayıcı ücreti:")}{" "}
                      {limits.fee_percent ?? 0}%
                    </p>
                  )}
                  {quote ? (
                    <div className="trade-summary">
                      <span>
                        {c("Estimated receipt", "Tahmini alacağınız")}
                      </span>
                      <h2 className="text-3xl">
                        {quote.buy_amount} {side === "buy" ? "USDC" : "TRY"}
                      </h2>
                      <p className="text-sm text-muted">
                        {c(
                          "The provider confirms final fees and payout.",
                          "Son ücretleri ve ödemeyi sağlayıcı onaylar.",
                        )}
                      </p>
                    </div>
                  ) : (
                    normalized && (
                      <p role="status">
                        {quoted?.key === quoteKey && quoted.error
                          ? c(
                              "Quote unavailable. Change the amount to retry.",
                              "Fiyat alınamadı. Tekrar denemek için tutarı değiştirin.",
                            )
                          : c("Fetching quote…", "Fiyat alınıyor…")}
                      </p>
                    )
                  )}
                  <Button
                    onClick={start}
                    disabled={
                      busy ||
                      !quote ||
                      !normalized ||
                      !!account.error ||
                      !account.data ||
                      !limits?.enabled ||
                      (side === "sell" &&
                        (account.data.balance === null ||
                          Number(account.data.balance) < Number(normalized)))
                    }
                  >
                    {busy ? (
                      <Spinner />
                    ) : (
                      c("Get transfer instructions", "Transfer bilgilerini al")
                    )}
                  </Button>
                </Card>
              ) : (
                <Card className="space-y-4">
                  <h2 className="section-title">
                    {c("Transfer details", "Transfer bilgileri")}
                  </h2>
                  <p>
                    {c("Transaction", "İşlem")}:{" "}
                    <span className="break-all">{watchId}</span>
                  </p>
                  {dep && (
                    <>
                      <p>
                        {c("Send exactly", "Tam olarak gönderin")}:{" "}
                        <b>{committed} TRY</b>
                      </p>
                      <dl className="review-grid">
                        {Object.entries(dep.instructions ?? {}).map(
                          ([key, v]) => (
                            <div key={key}>
                              <dt>{v.description ?? key}</dt>
                              <dd className="break-all select-all">
                                {v.value}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                      {dep.how && <p>{dep.how}</p>}
                      {sandbox && (
                        <Button
                          disabled={
                            busy || tx?.status !== "pending_user_transfer_start"
                          }
                          onClick={() =>
                            run(async () => {
                              await anchor.simulateBankTransfer(
                                dep.id,
                                committed,
                              );
                              transaction.refresh();
                            })
                          }
                        >
                          {c(
                            "Simulate bank transfer",
                            "Banka transferini simüle et",
                          )}
                        </Button>
                      )}
                    </>
                  )}
                  {wd && (
                    <>
                      <dl className="review-grid">
                        <div>
                          <dt>{c("Destination", "Hedef")}</dt>
                          <dd className="break-all select-all">
                            {wd.account_id}
                          </dd>
                        </div>
                        <div>
                          <dt>Memo ({wd.memo_type})</dt>
                          <dd className="break-all select-all">{wd.memo}</dd>
                        </div>
                        <div>
                          <dt>{c("Amount", "Tutar")}</dt>
                          <dd>{committed} USDC</dd>
                        </div>
                      </dl>
                      {sent ? (
                        <TxLink hash={sent} />
                      ) : (
                        <Button
                          disabled={
                            busy ||
                            !!transaction.error ||
                            !!account.error ||
                            !tx ||
                            anchor.FINAL.has(tx.status)
                          }
                          onClick={send}
                        >
                          {busy ? (
                            <Spinner />
                          ) : (
                            c("Send USDC from wallet", "Cüzdandan USDC gönder")
                          )}
                        </Button>
                      )}
                    </>
                  )}
                  {transaction.error ? (
                    <Alert kind="warn">
                      {c(
                        "Status unavailable. Do not repeat a transfer based on a missing update.",
                        "Durum alınamadı. Güncelleme gelmediği için transferi tekrarlamayın.",
                      )}{" "}
                      <button
                        onClick={transaction.refresh}
                        className="underline"
                      >
                        {c("Retry", "Tekrar dene")}
                      </button>
                    </Alert>
                  ) : (
                    <div role="status">
                      {tx ? (
                        <>
                          <h3 className="font-semibold">{status(tx.status)}</h3>
                          {tx.message && <p>{tx.message}</p>}
                          {tx.status === "completed" && (
                            <p>
                              {tx.amount_in} → {tx.amount_out}
                            </p>
                          )}
                          {tx.stellar_transaction_id && (
                            <TxLink hash={tx.stellar_transaction_id} />
                          )}
                        </>
                      ) : (
                        <Spinner />
                      )}
                    </div>
                  )}
                  {tx?.status === "pending_trust" && (
                    <Button onClick={trust} disabled={busy}>
                      {c("Add USDC trustline", "USDC varlığını ekle")}
                    </Button>
                  )}
                  <button
                    className="product-text-link"
                    onClick={reset}
                    disabled={busy}
                  >
                    {tx && anchor.FINAL.has(tx.status)
                      ? c("Start another transfer", "Başka transfer başlat")
                      : c(
                          "Back to funding (this transfer stays open)",
                          "Fonlamaya dön (bu transfer açık kalır)",
                        )}
                  </button>
                </Card>
              )}
              {!!account.data?.history.length && (
                <section>
                  <h2 className="section-title">
                    {c("Provider history", "Sağlayıcı geçmişi")}
                  </h2>
                  <div className="activity-list">
                    {account.data.history.map((t) => (
                      <article className="activity-row" key={t.id}>
                        <div>
                          <p>
                            {t.kind === "deposit"
                              ? c("Deposit", "Yatırma")
                              : c("Withdrawal", "Çekme")}{" "}
                            · {t.amount_in} → {t.amount_out}
                          </p>
                          <p>{status(t.status)}</p>
                        </div>
                        <button
                          className="product-text-link"
                          disabled={busy}
                          onClick={() => {
                            reset();
                            setWatchId(t.id);
                          }}
                        >
                          {c("View status", "Durumu gör")} <ArrowMark />
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {error && <Alert kind="error">{error}</Alert>}
        </>
      )}
    </div>
  );
}
