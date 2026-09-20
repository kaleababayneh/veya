import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./product.css";
import { AppFrame } from "@/components/AppFrame";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/lib/i18n";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

/* Switzer (UI) + Sentient (headings), Fontshare / Indian Type Foundry — see THIRD_PARTY_NOTICES.md.
   Sentient ships as one Medium cut; the 500–700 range stops browsers from faking a bold on headings. */
const switzer = localFont({
  src: [
    { path: "./fonts/switzer-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/switzer-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/switzer-600.woff2", weight: "600 700", style: "normal" },
  ],
  variable: "--font-switzer",
  display: "swap",
});
const sentient = localFont({
  src: [{ path: "./fonts/sentient-500.woff2", weight: "500 700", style: "normal" }],
  variable: "--font-sentient",
  display: "swap",
});

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
    // the boot script sets data-theme before first paint, so <html> differs from the server render on purpose
    <html lang="en" className={`${switzer.variable} ${sentient.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
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
