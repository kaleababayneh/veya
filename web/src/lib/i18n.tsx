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
  "FAST transfer from your Ziraat or VakıfBank account": "Ziraat veya VakıfBank hesabınızdan FAST transferi",
  "I paid from": "Ödediğim banka:",
  "Prove it from your bank's dekont e-mail": "Bankanızın dekont e-postasıyla kanıtlayın",
  ". The bank e-mails it to your registered address within a minute (subject \"Dekont\", attachment Dekont.pdf).":
    ". Banka bir dakika içinde kayıtlı adresinize e-posta ile gönderir (konu \"Dekont\", ek Dekont.pdf).",
  "The Açıklama line is required: it ties the payment to your wallet, so nobody who obtains your e-mail can claim in your place.":
    "Açıklama satırı zorunludur: ödemeyi cüzdanınıza bağlar; e-postanızı ele geçiren biri sizin yerinize talepte bulunamaz.",
  "I have sent it — declare on-chain": "Gönderdim — zincirde beyan et",
  "Confirm in wallet…": "Cüzdanda onaylayın…",
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
  // nav
  "Market": "Piyasa",
  "Post an ad": "İlan ver",
  "My activity": "İşlemlerim",
  "Anchor": "Anchor",
  "How it works": "Nasıl çalışır",
  "Connect wallet": "Cüzdan bağla",
  "Connecting…": "Bağlanıyor…",
  // market
  "Buy XLM or USDC with a Turkish bank transfer. Peer to peer.": "Türk bankasından havaleyle XLM veya USDC alın. Kişiden kişiye.",
  "Makers post ads with a price and their liquidity in a Soroban escrow. Pick an ad, reserve any amount within its limits, pay the maker by FAST, and prove the payment from your bank's own signed receipt e-mail (Ziraat or VakıfBank) with a zero-knowledge proof. The escrow pays you out in about a minute.":
    "Satıcılar fiyatlarını ve likiditelerini bir Soroban emanet sözleşmesine koyarak ilan verir. Bir ilan seçin, limitler içinde istediğiniz tutarı ayırtın, satıcıya FAST ile ödeyin ve ödemeyi bankanızın imzalı dekont e-postasından (Ziraat veya VakıfBank) sıfır bilgi ispatıyla kanıtlayın. Emanet sözleşmesi yaklaşık bir dakikada ödemenizi yapar.",
  "Rules of the market": "Piyasa kuralları",
  "A reservation holds the maker's tokens for": "Bir rezervasyon satıcının tokenlarını",
  "min at the quoted price.": "dakika boyunca verilen fiyattan tutar.",
  "Declare your payment and the maker cannot withdraw for": "Ödemenizi beyan edin; satıcı",
  "min; their": "dakika boyunca çekemez;",
  "bond backs you after that.": "teminatı sonrasında sizi korur.",
  "Makers' bank details are encrypted on-chain and shown only to you after you reserve.": "Satıcıların banka bilgileri zincirde şifrelidir ve yalnızca ayırttıktan sonra size gösterilir.",
  "Fee": "Ücret:",
  "of the tokens you receive. No custody, no middleman.": "aldığınız tokenların yüzdesi. Emanetçi yok, aracı yok.",
  "Escrow contract on stellar.expert ↗": "Emanet sözleşmesi stellar.expert'te ↗",
  "Buy": "Al",
  "All": "Tümü",
  "Maker": "Satıcı",
  "Price": "Fiyat",
  "Available": "Mevcut",
  "Limits": "Limitler",
  "Per trade": "İşlem başına",
  "per": "birim",
  "trades": "işlem",
  "active": "aktif",
  "No ads with liquidity right now": "Şu anda likiditesi olan ilan yok",
  "Be the first maker:": "İlk satıcı siz olun:",
  "post an ad": "ilan verin",
  "Recent trades": "Son işlemler",
  "Each settled with a zero-knowledge proof of the bank transfer, verified on-chain.": "Her biri banka transferinin sıfır bilgi ispatıyla, zincir üzerinde doğrulanarak tamamlandı.",
  "settled": "tamamlandı",
  "View the trade →": "İşlemi gör →",
  // ad page
  "available": "mevcut",
  "limits": "limitler",
  "per trade": "işlem başına",
  "trades completed": "işlem tamamlandı",
  "until": "bitiş",
  "Buy {sym} from {maker}": "{maker} satıcısından {sym} al",
  "You pay (TRY by FAST)": "Ödeyeceğiniz (FAST ile TRY)",
  "You reserve": "Ayırtacağınız",
  "min": "en az",
  "max": "en çok",
  "You send by FAST": "FAST ile gönderirsiniz",
  "Protocol fee": "Protokol ücreti",
  "You receive": "Alırsınız",
  "Enter an amount": "Bir tutar girin",
  "Connect wallet to reserve": "Ayırtmak için cüzdan bağlayın",
  "Reserve": "Ayırt",
  "for": "karşılığı",
  "Reserving is a Stellar transaction that holds the maker's tokens for you; no money moves until you pay the maker.": "Ayırtma, satıcının tokenlarını sizin için tutan bir Stellar işlemidir; siz satıcıya ödeyene kadar para hareket etmez.",
  "How a trade works here": "Burada bir işlem nasıl yürür",
  "Reserve an amount: the tokens are held for you for": "Bir tutar ayırtın: tokenlar",
  "minutes at today's price.": "dakika boyunca bugünün fiyatından sizin için tutulur.",
  "The maker's IBAN and name are revealed to you only after reserving (they are encrypted on-chain). Pay by FAST from Ziraat with the payment reference in the description.": "Satıcının IBAN'ı ve adı yalnızca ayırttıktan sonra size gösterilir (zincirde şifrelidir). Açıklamaya ödeme referansını yazarak Ziraat veya VakıfBank'tan FAST ile ödeyin.",
  "Declare the payment: the maker cannot withdraw for": "Ödemeyi beyan edin: satıcı",
  "minutes, and their bond backs you afterwards.": "dakika boyunca çekemez ve sonrasında teminatı sizi korur.",
  "Upload the e-dekont e-mail, get a proof in ~15 s, claim your": "Dekont e-postasını yükleyin, ~15 saniyede kanıt alın,",
  "(fee": "alın (ücret",
  // reservation header
  "Reservation": "Rezervasyon",
  "from": "satıcı:",
  "You get": "Alacağınız:",
  "reserved": "ayırtıldı",
  "buyer": "alıcı",
  "Protected for": "Koruma süresi",
  "Reservation ends in": "Rezervasyon bitişine",
  "Reserved · timer ended": "Ayırtıldı · süre doldu",
  "Reserved": "Ayırtıldı",
  "Completed": "Tamamlandı",
  "Released · bond claim open": "Serbest bırakıldı · teminat talebi açık",
  "Released": "Serbest bırakıldı",
  "Completed on": "Tamamlanma:",
  "went to": "şu cüzdana gitti:",
  "Fully reserved": "Tamamen ayırtılmış",
  "Active": "Aktif",
  "Closed": "Kapalı",
  "← Market": "← Piyasa",
  "Ad": "İlan",
  "maker": "satıcı",
  "Testnet: fund a wallet at": "Testnet: cüzdanınızı şuradan fonlayın:",
  "Paying by FAST needs a Ziraat or VakıfBank account; without one, browse the market and open a recent trade to see a settled proof.": "FAST ile ödemek için Ziraat veya VakıfBank hesabı gerekir; hesabınız yoksa piyasaya göz atın ve tamamlanmış bir işlemi açıp doğrulanmış kanıtı görün.",
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
