"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletSessionKey } from "@/lib/useWalletSessionKey";
import { useWallet } from "@/lib/wallet";
import {
  escrow,
  getConfig,
  payeeHashHex,
  send,
  unwrapResult,
  explainError,
  type EscrowConfig,
} from "@/lib/escrow";
import { sealPayee } from "@/lib/reveal";
import {
  BANKS,
  bankFromIban,
  normalizeIban,
  isTrIbanShape,
  ibanChecksumOk,
  formatIban,
} from "@/lib/banks";
import { BankSelect } from "@/components/BankSelect";
import { TOKENS } from "@/lib/tokens";
import {
  fmtTRY,
  fmtToken,
  parseToken,
  parseTRY,
  nowSec,
  bytesToHex,
} from "@/lib/format";
import { Alert, Button, Card, Field, inputCls, Spinner } from "@/components/ui";
import { PageHeading, useCopy, FundingLink } from "@/components/Product";
export default function Sell() {
  const { address } = useWallet();
  const key = useWalletSessionKey(address);
  return <Seller key={key} />;
}
function Seller() {
  const { address, connect, signTransaction, ready, connecting } = useWallet(),
    router = useRouter(),
    c = useCopy();
  const [cfg, setCfg] = useState<EscrowConfig | null>(null),
    [step, setStep] = useState(0);
  const [token, setToken] = useState(TOKENS[0]?.address ?? ""),
    [amount, setAmount] = useState("500"),
    [price, setPrice] = useState("");
  const [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [bank, setBank] = useState(""),
    [iban, setIban] = useState(""),
    [name, setName] = useState(""),
    [nickname, setNickname] = useState(""),
    [days, setDays] = useState("30");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const locked = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    getConfig()
      .then((v) => {
        if (!alive.current) return;
        setCfg(v);
        setMin((Number(v.min_try_kurus) / 100).toFixed(2).replace(".", ","));
        setMax((Number(v.max_try_kurus) / 100).toFixed(2).replace(".", ","));
      })
      .catch(() => {
        if (alive.current)
          setError(
            "Configuration unavailable. Reload before creating an offer.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const t = TOKENS.find((t) => t.address === token),
    decimals = t?.decimals ?? 7;
  let units = 0n;
  try {
    units = parseToken(amount, decimals);
  } catch {}
  const bond = cfg ? (units * BigInt(cfg.bond_bps)) / 10000n : 0n;
  const validate = (page: number) => {
    if (!cfg)
      throw new Error(
        c(
          "Configuration is unavailable. Reload and try again.",
          "Yapılandırma kullanılamıyor. Sayfayı yenileyip tekrar deneyin.",
        ),
      );
    if (page === 0) {
      if (!t || !token || units <= 0n)
        throw new Error(
          c(
            "Choose an asset and enter a positive amount.",
            "Varlık seçin ve sıfırdan büyük bir miktar girin.",
          ),
        );
      const p = parseTRY(price),
        lo = parseTRY(min),
        hi = parseTRY(max);
      if (
        p <= 0n ||
        lo < cfg.min_try_kurus ||
        hi > cfg.max_try_kurus ||
        hi < lo ||
        (units * p) / 10n ** BigInt(decimals) < lo
      )
        throw new Error(
          c(
            "Check the price, trade limits and available liquidity.",
            "Fiyatı, işlem limitlerini ve mevcut likiditeyi kontrol edin.",
          ),
        );
    } else {
      if (
        !bank ||
        !isTrIbanShape(iban) ||
        !ibanChecksumOk(iban) ||
        bankFromIban(iban)?.code !== bank
      )
        throw new Error(
          c(
            "Enter a valid Turkish IBAN matching the selected bank.",
            "Seçilen bankaya ait geçerli bir Türk IBAN girin.",
          ),
        );
      if (
        !name.trim() ||
        name.trim().length > 64 ||
        nickname.length > 24 ||
        !/^\d+$/.test(days) ||
        Number(days) < 1 ||
        Number(days) > 365
      )
        throw new Error(
          c(
            "Enter the account holder name and a duration of 1–365 days.",
            "Hesap sahibinin adını ve 1–365 gün arasında süre girin.",
          ),
        );
    }
  };
  const next = () => {
    try {
      validate(step);
      setError(null);
      setStep(step + 1);
    } catch (e) {
      setError(explainError(e));
    }
  };
  const publish = async () => {
    if (locked.current) return;
    if (!address) {
      await connect();
      return;
    }
    try {
      validate(0);
      validate(1);
      if (!consent || !cfg) return;
      locked.current = true;
      setBusy(true);
      setError(null);
      const clean = normalizeIban(iban),
        holder = name.trim();
      const [hash, blob] = await Promise.all([
        payeeHashHex(clean, holder),
        sealPayee(
          {
            iban: clean,
            name: holder,
            bank: BANKS.find((b) => b.code === bank)?.name,
          },
          bytesToHex(cfg.reveal_pubkey),
        ),
      ]);
      if (!alive.current) return;
      const tx = await escrow(address, signTransaction).create_ad({
        seller: address,
        token,
        amount: units,
        price_kurus: parseTRY(price),
        min_try_kurus: parseTRY(min),
        max_try_kurus: parseTRY(max),
        payee_hash: Buffer.from(hash, "hex"),
        payee_blob: Buffer.from(blob),
        nickname: nickname.trim(),
        expires_at: BigInt(nowSec() + Number(days) * 86400),
      });
      if (!alive.current) return;
      const result = await send(tx),
        id = unwrapResult(result.result);
      if (alive.current) router.push(`/ads/${id}`);
    } catch (e) {
      if (alive.current) setError(explainError(e));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="product-page seller-page">
      <PageHeading
        eyebrow={c("SELL WITH VEYA", "VEYA İLE SAT")}
        title={c("Your crypto. Your offer.", "Kriptonuz. Teklifiniz.")}
        description={c(
          "Set your rate, choose where you get paid, then review.",
          "Kurunuzu belirleyin, ödeme hesabınızı seçin ve gözden geçirin.",
        )}
        action={<FundingLink />}
      />
      <ol className="seller-stepper">
        {[
          c("Set your offer", "Teklifiniz"),
          c("Bank details", "Banka bilgileri"),
          c("Review & deposit", "İnceleyin ve yatırın"),
        ].map((label, i) => (
          <li
            key={i}
            aria-current={i === step ? "step" : undefined}
            className={i === step ? "active" : ""}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <Card className="space-y-5">
        {step === 0 && (
          <>
            <h2 className="section-title">
              {c("What would you like to sell?", "Ne satmak istersiniz?")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={c("Asset", "Varlık")}>
                <select
                  className={inputCls}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                >
                  {TOKENS.map((t) => (
                    <option key={t.address} value={t.address}>
                      {t.symbol}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={c("Amount to deposit", "Yatırılacak miktar")}
                hint={c(
                  "Use a dot for token decimals, e.g. 500.25",
                  "Token ondalıkları için nokta kullanın: 500.25",
                )}
              >
                <input
                  className={inputCls}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <Field
              label={c("Price in TRY per token", "Token başına TL fiyatı")}
              hint={c(
                "Use a comma for kuruş, e.g. 42,50",
                "Kuruş için virgül kullanın: 42,50",
              )}
            >
              <input
                className={inputCls}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="42,50"
                inputMode="decimal"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={c("Minimum trade (TRY)", "En düşük işlem (TL)")}
                hint={cfg ? fmtTRY(cfg.min_try_kurus) : undefined}
              >
                <input
                  className={inputCls}
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field
                label={c("Maximum trade (TRY)", "En yüksek işlem (TL)")}
                hint={cfg ? fmtTRY(cfg.max_try_kurus) : undefined}
              >
                <input
                  className={inputCls}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <p className="text-sm text-muted">
              {c(
                "Your deposit also includes a seller bond. You will see the total before signing.",
                "Yatıracağınız tutar satıcı teminatını da içerir. İmzalamadan önce toplamı göreceksiniz.",
              )}
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="section-title">
              {c(
                "Where should buyers pay you?",
                "Alıcılar nereye ödeme yapsın?",
              )}
            </h2>
            <Field label={c("Bank", "Banka")}>
              <BankSelect value={bank} onChange={setBank} />
            </Field>
            <Field label="IBAN">
              <input
                className={inputCls}
                value={iban}
                onChange={(e) => setIban(formatIban(e.target.value))}
                autoComplete="off"
                placeholder="TR…"
              />
            </Field>
            <Field
              label={c("Account holder name", "Hesap sahibinin adı")}
              hint={c(
                "Exactly as shown by your bank.",
                "Bankanızda göründüğü şekilde.",
              )}
            >
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={c(
                  "Public nickname (optional)",
                  "Herkese açık takma ad (isteğe bağlı)",
                )}
              >
                <input
                  className={inputCls}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={24}
                />
              </Field>
              <Field label={c("Duration in days", "Gün olarak süre")}>
                <input
                  className={inputCls}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <p className="text-sm text-muted">
              {c(
                "Your IBAN and name are encrypted before storage. Reservation holders and the reveal service operator can see them.",
                "IBAN ve adınız saklanmadan önce şifrelenir. Rezervasyon sahipleri ve bilgi açıklama hizmetinin operatörü bunları görebilir.",
              )}
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="section-title">
              {c("Review your offer", "Teklifinizi inceleyin")}
            </h2>
            <dl className="review-grid">
              <div>
                <dt>{c("Duration", "Süre")}</dt>
                <dd>
                  {days} {c("days", "gün")}
                </dd>
              </div>
              <div>
                <dt>{c("Liquidity", "Likidite")}</dt>
                <dd>
                  {fmtToken(units, decimals)} {t?.symbol}
                </dd>
              </div>
              <div>
                <dt>
                  {c("Seller bond", "Satıcı teminatı")} (
                  {cfg ? Number(cfg.bond_bps) / 100 : 0}%)
                </dt>
                <dd>
                  {fmtToken(bond, decimals)} {t?.symbol}
                </dd>
              </div>
              <div>
                <dt>{c("Total deposit", "Toplam yatırılacak")}</dt>
                <dd>
                  {fmtToken(units + bond, decimals)} {t?.symbol}
                </dd>
              </div>
              <div>
                <dt>{c("Price per token", "Token fiyatı")}</dt>
                <dd>₺{price}</dd>
              </div>
              <div>
                <dt>{c("Trade limits", "İşlem limitleri")}</dt>
                <dd>
                  ₺{min} – ₺{max}
                </dd>
              </div>
              <div>
                <dt>{c("Bank account", "Banka hesabı")}</dt>
                <dd className="break-all">
                  {name}
                  <br />
                  {iban}
                </dd>
              </div>
            </dl>
            <Alert kind="warn">
              {c(
                "Testnet: these tokens have no real monetary value. Bank transfers use real lira. Network fees are separate.",
                "Testnet: Bu tokenların gerçek parasal değeri yoktur. Banka transferleri gerçek lira kullanır. Ağ ücretleri ayrıdır.",
              )}
            </Alert>
            <p className="text-sm text-muted">
              {c(
                "You can withdraw unreserved funds by closing the offer. Active reservations continue. The bond backs late payment claims and may be forfeited under the contract rules.",
                "Teklifi kapatarak ayrılmamış fonları çekebilirsiniz. Aktif rezervasyonlar devam eder. Teminat geç ödeme taleplerini karşılar ve sözleşme kurallarına göre kaybedilebilir.",
              )}{" "}
              {c("Buyer protocol fee:", "Alıcı protokol ücreti:")}{" "}
              {cfg ? Number(cfg.fee_bps) / 100 : 0}%.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {c(
                  "I reviewed the deposit, bank details and bond conditions.",
                  "Yatırılacak tutarı, banka bilgilerini ve teminat koşullarını inceledim.",
                )}
              </span>
            </label>
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="seller-actions">
          {step > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep(step - 1);
                setConsent(false);
                setError(null);
              }}
            >
              {c("Back", "Geri")}
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={next} disabled={!cfg}>
              {c("Continue", "Devam et")} →
            </Button>
          ) : (
            <Button
              onClick={publish}
              disabled={busy || !consent || !ready || connecting}
            >
              {busy ? (
                <>
                  <Spinner />
                  {c("Confirm in your wallet…", "Cüzdanınızda onaylayın…")}
                </>
              ) : address ? (
                c("Deposit & publish offer", "Yatır ve teklifi yayınla")
              ) : (
                c("Connect wallet", "Cüzdanı bağla")
              )}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
