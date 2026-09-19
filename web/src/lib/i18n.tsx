"use client";
/**
 * Minimal EN/TR switch for the buyer-facing copy. English strings are the keys; a missing Turkish entry falls
 * back to English, so the toggle can never blank a label. Choice is remembered per browser.
 */
import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type Lang = "en" | "tr";

const TR: Record<string, string> = {
  "Where to pay": "Nereye ödeyeceksiniz",
  "Where you paid": "Nereye ödediniz",
  "Reveal bank details": "Banka bilgilerini göster",
  "Waiting for your wallet…": "Cüzdanınız bekleniyor…",
  "The maker's bank details are encrypted on-chain. Sign a message with your wallet to reveal them — no transaction, no fee.":
    "Satıcının banka bilgileri zincir üzerinde şifreli. Görmek için cüzdanınızla bir mesaj imzalayın — işlem yok, ücret yok.",
  "✓ Verified against the maker's on-chain commitment.": "✓ Satıcının zincir üzerindeki taahhüdüyle doğrulandı.",
  "FAST transfer from your Ziraat account": "Ziraat hesabınızdan FAST transferi",
  "The Açıklama line is required: it ties the payment to your wallet, so nobody who obtains your e-mail can claim in your place.":
    "Açıklama satırı zorunludur: ödemeyi cüzdanınıza bağlar; e-postanızı ele geçiren biri sizin yerinize talepte bulunamaz.",
  "I have sent it — declare on-chain": "Gönderdim — zincirde beyan et",
  "Confirm in wallet…": "Cüzdanda onaylayın…",
  "Prove it from Ziraat's e-dekont e-mail": "Ziraat e-dekont e-postasıyla kanıtlayın",
  "Drop the .eml file here, or click to choose it": ".eml dosyasını buraya bırakın ya da tıklayıp seçin",
  "Verify the e-mail and start proving": "E-postayı doğrula ve kanıtı başlat",
  "Your wallet will ask for a signature first (no transaction, no fee): it proves this reservation is yours before the prover spends GPU time.":
    "Cüzdanınız önce bir imza isteyecek (işlem yok, ücret yok): kanıtlayıcı GPU zamanı harcamadan önce rezervasyonun size ait olduğunu gösterir.",
  "Claim your": "Alın:",
  "Claim the bond:": "Teminatı alın:",
  "Claim": "Al",
  "Send": "Gönderin:",
  "by FAST, then declare it": "FAST ile, sonra beyan edin",
  "copy": "kopyala",
  "copied ✓": "kopyalandı ✓",
  "show": "göster",
  "hide": "gizle",
  "Reservation details": "Rezervasyon ayrıntıları",
  "On a phone? Copy this page's link and open it on a computer for the upload step.":
    "Telefonda mısınız? Bu sayfanın bağlantısını kopyalayıp yükleme adımı için bilgisayarda açın.",
  "Copy link": "Bağlantıyı kopyala",
  "Payment declared": "Ödeme beyan edildi",
  "details": "ayrıntılar",
  "less": "daha az",
  "Send this one e-mail to the prover; it is kept in memory only and only hashes, the amount, the date and a nullifier go on-chain.":
    "Bu e-postayı kanıtlayıcıya gönderin; yalnızca bellekte tutulur ve zincire sadece özetler, tutar, tarih ve bir nullifier yazılır.",
  "Hesap Hareketleri → the": "Hesap Hareketleri → ",
  "transfer →": "tutarlı transfer →",
  ". The bank e-mails it to your registered address within a minute (subject \"e-dekont\").":
    ". Banka bir dakika içinde kayıtlı adresinize e-posta ile gönderir (konu \"e-dekont\").",
  "Open that e-mail in": "Bu e-postayı",
  "Gmail on a computer": "bilgisayarda Gmail'de açın",
  "menu →": "menüsü →",
  ", and drop the file below. Do not forward it: forwarding breaks the bank's signature.":
    ", sonra dosyayı aşağıya bırakın. İletmeyin: iletmek bankanın imzasını bozar.",
  "Declared": "Beyan edildi",
  "protected until": "koruma bitişi",
  "Link copied ✓": "Bağlantı kopyalandı ✓",
};

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string };
const Ctx = createContext<I18n>({ lang: "en", setLang: () => {}, t: (s) => s });

// the choice lives in localStorage; useSyncExternalStore keeps server render ("en") and client in step without an effect
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = (): Lang => {
  try {
    return localStorage.getItem("zkotc-lang") === "tr" ? "tr" : "en";
  } catch {
    return "en";
  }
};
const getServerSnapshot = (): Lang => "en";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem("zkotc-lang", l);
    } catch {
      /* ignore */
    }
    listeners.forEach((cb) => cb());
  }, []);
  const t = useCallback((s: string) => (lang === "tr" ? (TR[s] ?? s) : s), [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
