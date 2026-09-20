"use client";
import Link from "next/link";
import { PageHeading, ReceiptGuide, useCopy } from "@/components/Product";
import { Card } from "@/components/ui";
import { ArrowMark } from "@/components/ArrowMark";
export default function Help() {
  const c = useCopy();
  return (
    <div className="product-page">
      <PageHeading
        eyebrow={c("VEYA GUIDE", "VEYA REHBERİ")}
        title={c("A clearer way to trade.", "İşlemin her adımı açık.")}
        description={c(
          "Buy from a peer. Pay through your bank. Verify the original receipt.",
          "Bir kullanıcıdan alın. Bankanızdan ödeyin. Orijinal dekontu doğrulayın.",
        )}
      />
      <div className="help-grid">
        {[
          [
            c("Choose an offer", "Teklif seçin"),
            c(
              "Enter your lira budget and compare what you receive after fees.",
              "Lira bütçenizi girin ve ücret sonrası alacağınız tutarı karşılaştırın.",
            ),
          ],
          [
            c("Reserve & pay", "Ayırın ve ödeyin"),
            c(
              "Connect a testnet wallet. Reveal the bank details; copy the exact amount and reference. Only mark paid after sending the transfer.",
              "Testnet cüzdanı bağlayın. Banka bilgilerini açın; tam tutarı ve referansı kopyalayın. Yalnızca havaleyi yaptıktan sonra ödendi olarak işaretleyin.",
            ),
          ],
          [
            c("Verify your receipt", "Dekontunuzu doğrulayın"),
            c(
              "Upload the original bank email as an .eml file. Verification needs your permission and a wallet signature.",
              "Bankanın orijinal e-postasını .eml dosyası olarak yükleyin. Doğrulama izninizi ve cüzdan imzanızı gerektirir.",
            ),
          ],
          [
            c("Receive your crypto", "Kriptonuzu alın"),
            c(
              "When verification finishes, confirm the settlement transaction in your wallet. Track the result in Activity.",
              "Doğrulama tamamlanınca cüzdanınızda işlemi onaylayın. Sonucu İşlemler bölümünde takip edin.",
            ),
          ],
        ].map(([title, text], i) => (
          <Card key={title}>
            <p className="product-eyebrow">0{i + 1}</p>
            <h2 className="section-title">{title}</h2>
            <p>{text}</p>
          </Card>
        ))}
      </div>
      <Card>
        <ReceiptGuide />
        <Link href="/me" className="product-text-link">
          {c("Continue an existing trade", "Mevcut işleme devam edin")} <ArrowMark />
        </Link>
      </Card>
      <div className="help-grid">
        <Card>
          <h2 className="section-title">
            {c("Watch the deadline", "Süreyi takip edin")}
          </h2>
          <p>
            {c(
              "Declaring payment gives a limited verification window. If a seller releases a declared reservation, a separate, limited bond claim may be available. It pays the bond slice, not the full original trade. Check the live trade page before acting.",
              "Ödeme bildirimi sınırlı doğrulama süresi sağlar. Satıcı bildirilen rezervasyonu serbest bırakırsa süreli teminat talebi mümkün olabilir. Bu, ilk işlemin tamamını değil teminat payını öder. İşlem yapmadan önce güncel işlem sayfasını kontrol edin.",
            )}
          </p>
        </Card>
        <Card>
          <h2 className="section-title">
            {c("Privacy & testnet", "Gizlilik ve testnet")}
          </h2>
          <p>
            {c(
              "The prover processes the receipt you consent to send. Bank details are encrypted, but the reveal service operator can access them. Test tokens have no real monetary value; bank transfers still use real lira.",
              "Doğrulama hizmeti gönderilmesine izin verdiğiniz dekontu işler. Banka bilgileri şifrelidir ancak açıklama hizmetinin operatörü bunlara erişebilir. Test tokenlarının parasal değeri yoktur; banka transferleri yine gerçek lira kullanır.",
            )}
          </p>
        </Card>
      </div>
      <Link className="product-text-link" href="/market">
        {c("Explore offers", "Teklifleri keşfedin")} <ArrowMark />
      </Link>
    </div>
  );
}
