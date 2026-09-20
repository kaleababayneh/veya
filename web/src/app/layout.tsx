import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import { AppFrame } from "@/components/AppFrame";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/lib/i18n";

const title = "Veya: Buy crypto with Turkish bank transfers";
const description = "Buy USDC or XLM directly from peers using a Turkish bank transfer. Verify your bank receipt and receive crypto in your wallet. Currently on Stellar testnet.";

export const metadata: Metadata = {
  applicationName: "Veya",
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Veya",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <I18nProvider>
          <ToastProvider>
            <a className="skip-link" href="#main-content">Skip to content</a>
            <AppFrame>{children}</AppFrame>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
