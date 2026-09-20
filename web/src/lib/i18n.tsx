"use client";
/**
 * Minimal EN/TR switch for the buyer-facing copy. English strings are the keys; a missing Turkish entry falls
 * back to English, so the toggle can never blank a label. Choice is remembered per browser.
 */
import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type Lang = "en" | "tr";

const TR: Record<string, string> = {
  "Trade amount before fee":"Ücret öncesi işlem tutarı",
  "Check the confirmed payout in your wallet history.":"Onaylanan ödeme tutarını cüzdan geçmişinizde kontrol edin.",
  "before fee; current fee:":"ücret öncesi; güncel ücret:",
  "Upload the original email, verify it and receive your": "Orijinal e-postayı yükleyip doğrulayın ve alın:",
  "Loading ad #": "Teklif yükleniyor #",
  "Your ad": "Teklifiniz",
  "Unreserved": "Ayrılmamış",
  "Reserved by buyers": "Alıcıların ayırdığı",
  "Bond pool": "Teminat havuzu",
  "free ·": "serbest ·",
  "earmarked": "ayrılmış",
  "Update price": "Fiyatı güncelle",
  "Closing withdraws the unreserved tokens and the free part of the bond at once. Active reservations keep running; their tokens and bond slices come to you as they settle or release.": "Kapatmak, ayrılmamış tokenları ve serbest teminatı çeker. Aktif rezervasyonlar devam eder; teminatın iadesi ve tokenların aktarımı sözleşme kurallarına göre gerçekleşir.",
  "Your payee details on this ad:": "Bu teklifteki alıcı bilgileriniz:",
  "✓ matches the on-chain commitment": "✓ zincirdeki kayıtla eşleşiyor",
  "✗ does not match the on-chain commitment — buyers will refuse to pay": "✗ zincirdeki kayıtla eşleşmiyor; alıcılar ödeme yapmamalı",
  "Show my encrypted payee details": "Şifreli banka bilgilerimi göster",
  "Reservations on this ad": "Bu teklifin rezervasyonları",
  "payment declared": "ödeme bildirildi",
  "← Ad #": "← Teklif #",
  "The buyer declared the bank transfer on": "Alıcının ödeme bildirim tarihi:",
  ". The reservation is protected until": ". Rezervasyonun koruma bitişi:",
  "Check your bank account for": "Banka hesabınızı kontrol edin. Tutar:",
  "with reference": "referans:",
  ". If it is released after that and the buyer proves the payment within": ". Sonrasında serbest bırakılırsa ve alıcı ödemeyi şu gün sayısı içinde kanıtlarsa:",
  "days, the bond slice of": "teminat payı:",
  "goes to them.": "alıcıya ödenir.",
  "The buyer has": "Alıcı durumu:",
  "Release reservation": "Rezervasyonu serbest bırak",
  "You cannot release a reservation while it runs; the tokens stay reserved for this buyer.": "Süresi dolmadan rezervasyonu serbest bırakamazsınız; tokenlar alıcı için ayrılmış kalır.",
  "The claim window has passed.": "Talep süresi doldu.",
  "Return it to the ad": "Teklife iade et",
  "Released after the buyer declared a payment: they can still claim the bond slice of": "Ödeme bildiriminden sonra serbest bırakıldı. Talep edilebilecek teminat payı:",
  "with a valid proof until": "Geçerli kanıt için son tarih:",
  "by FAST · Ziraat / VakıfBank": "FAST ile · Ziraat / VakıfBank",
  "(after": "(ücret oranı:",
  "% fee)": "%)",
  "Protection after declaring": "Bildirim sonrası koruma",
  "min, then": "dakika, ardından",
  "-day bond claim": "gün teminat talebi",
  "Payee details": "Alıcı bilgileri",
  "encrypted on-chain; shown to the buyer and maker after a wallet signature": "zincirde şifreli; cüzdan imzasından sonra alıcı ve satıcıya gösterilir",
  "Payment reference": "Ödeme referansı",
  "Buyer wallet": "Alıcı cüzdanı",
  "Your reservation was released after you declared the payment on": "Ödeme bildiriminizden sonra rezervasyon serbest bırakıldı. Bildirim tarihi:",
  ". Prove the transfer before": ". Kanıt için son tarih:",
  "to receive the maker's bond slice of": "Alabileceğiniz satıcı teminat payı:",
  ". The tokens themselves are no longer reserved for you.": ". Tokenların kendisi artık sizin için ayrılmış değil.",
  "Your reservation timer ended. Do not start a new bank transfer. If you already paid, verify the original receipt promptly. The declaration deadline has passed; settlement is only possible while the reservation remains active.": "Rezervasyon süreniz doldu. Yeni banka transferi başlatmayın. Zaten ödediyseniz orijinal dekontu hemen doğrulayın. Bildirim süresi geçti; ödeme yalnızca rezervasyon aktif kaldığı sürece alınabilir.",
  "Do not pay.": "Ödeme yapmayın.",
  "The revealed details (": "Açıklanan bilgiler (",
  ") do not match this ad's on-chain commitment, so no proof could ever settle here. Release the reservation and pick another ad.": ") zincirdeki kayıtla eşleşmiyor; bu teklifte kanıtla ödeme alınamaz. Rezervasyonu serbest bırakın ve başka teklif seçin.",
  "Declaring locks the maker out for": "Bildirim sonrası satıcının serbest bırakamayacağı süre:",
  "minutes and puts their bond of": "dakika. Talebinizi destekleyen teminat:",
  "behind your claim. Only declare after the transfer has left your account.": "Yalnızca transfer hesabınızdan çıktıktan sonra bildirim yapın.",
  "· proof ready": "· kanıt hazır",
  "Show original": "Orijinali göster",
  "Download original": "Orijinali indir",
  "receipt detected": "dekont tespit edildi",
  "no Ziraat/VakıfBank signature found": "Ziraat/VakıfBank imzası bulunamadı",
  "Apple Mail: File → Save As → Raw Message Source": "Apple Mail: Dosya → Farklı Kaydet → Ham İleti Kaynağı",
  "Prover:": "Doğrulama hizmeti:",
  ". The e-mail is checked (DKIM signature, recipient, amount, reference) before proving and discarded when the job ends.": ". Kanıt öncesi e-postanın imzası, alıcısı, tutarı ve referansı kontrol edilir; işlem bitince e-posta silinir.",
  "Proof failed:": "Kanıt başarısız:",
  "Try again": "Tekrar dene",
  "The proof (": "Kanıt (",
  "bytes) is verified by the Soroban verifier contract inside the same transaction that pays you.": "bayt) size ödeme yapan aynı işlem içinde doğrulanır.",
  "Cannot confirm this proof against the current configuration. Reload this page before claiming.": "Kanıt güncel yapılandırmayla doğrulanamıyor. Talep öncesi sayfayı yenileyin.",
  "Changed your mind and have": "Vazgeçtiyseniz ve",
  "not": "henüz",
  "paid?": "ödeme yapmadıysanız:",
  "Release the reservation": "Rezervasyonu serbest bırak",
  "Back to the market": "Piyasaya dön",
  "Timer ended and you will not settle this one (never paid, or gave up)?": "Süre doldu ve bu işlemi tamamlamayacak mısınız?",
  "to free your reservation slot. Releasing it yourself waives the bond claim, so if you did pay, upload the receipt and settle instead.": "Serbest bırakmak teminat talebinden vazgeçirir. Ödeme yaptıysanız bunun yerine dekontu yükleyip işlemi tamamlayın.",
  "Show payment details": "Ödeme bilgilerini göster",
  "I have sent the transfer": "Transferi gönderdim",
  "Verify your receipt": "Dekontunuzu doğrulayın",
  "Receive": "Al",
  "Reload": "Yenile",
  "Configuration unavailable. Reload before continuing.": "Yapılandırma alınamadı. Devam etmeden önce yenileyin.",
  "New price (₺ per token)": "Yeni fiyat (token başına TL)",
  "You send": "Göndereceğiniz",
  "Buyer sends": "Alıcının göndereceği",
  "Buyer receives": "Alıcının alacağı",
  "Bond backing you": "Sizi destekleyen teminat",
  "Bond slice": "Teminat payı",
  "View transaction": "İşlemi görüntüle",
  "Queued": "Sırada",
  "Checking email": "E-posta kontrol ediliyor",
  "Generating proof": "Kanıt oluşturuluyor",
  "Proof ready": "Kanıt hazır",
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
