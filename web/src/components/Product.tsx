"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { ArrowMark } from "@/components/ArrowMark";
export function useCopy() {
  const { lang } = useI18n();
  return (en: string, tr: string) => (lang === "tr" ? tr : en);
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="product-heading">
      <div>
        <p className="product-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="product-description">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function ReceiptGuide({ bank = "ziraat" }: { bank?: string }) {
  const c = useCopy();
  return (
    <div className="receipt-guide">
      <strong>
        {c(
          "Keep the original receipt email",
          "Orijinal dekont e-postasını saklayın",
        )}
      </strong>
      <ol>
        <li>
          {bank === "vakif" ? "VakıfBank Mobil" : "Ziraat Mobil"} → Hesap
          Hareketleri → {bank === "vakif" ? "Dekont" : "Dekont Gönder"} →
          E-posta
        </li>
        <li>
          {c(
            "Gmail on a computer: Show original → Download original. Apple Mail: Save As → Raw Message Source.",
            "Bilgisayarda Gmail: Orijinali göster → Orijinali indir. Apple Mail: Farklı Kaydet → Ham İleti Kaynağı.",
          )}
        </li>
        <li>
          {c(
            "Upload the .eml email, not a screenshot, PDF or forwarded message.",
            "Ekran görüntüsü, PDF veya iletilmiş mesaj yerine .eml e-postasını yükleyin.",
          )}
        </li>
      </ol>
      <p>
        {c(
          "On mobile? Have access to a computer for this step before you send money.",
          "Telefonda mısınız? Para göndermeden önce bu adım için bir bilgisayara erişiminiz olduğundan emin olun.",
        )}
      </p>
    </div>
  );
}
export function FundingLink() {
  const c = useCopy();
  return (
    <Link className="product-text-link" href="/anchor">
      {c("Fund or withdraw USDC", "USDC yatırın veya çekin")} <ArrowMark />
    </Link>
  );
}
