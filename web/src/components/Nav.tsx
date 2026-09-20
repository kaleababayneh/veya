"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { useI18n } from "@/lib/i18n";
import { short } from "@/lib/format";
import { Button } from "./ui";
import { useCopy } from "./Product";
export function Nav() {
  const path = usePathname(),
    c = useCopy();
  const { lang, setLang } = useI18n();
  const { address, connect, disconnect, connecting, ready } = useWallet();
  return (
    <header className="product-nav">
      <div className="product-nav-top">
        <Link href="/" aria-label="Veya" className="veya-wordmark">
          veya<span aria-hidden="true">↗</span>
        </Link>
        <span className="product-testnet">TESTNET</span>
        <div className="product-wallet">
          <button
            className="language-switch"
            aria-label={c("Switch to Turkish", "İngilizceye geç")}
            onClick={() => setLang(lang === "en" ? "tr" : "en")}
          >
            {lang === "en" ? "TR" : "EN"}
          </button>
          {address ? (
            <Button
              variant="ghost"
              onClick={disconnect}
              title={c("Disconnect wallet", "Cüzdan bağlantısını kes")}
            >
              {short(address, 4)} <span aria-hidden="true">↗</span>
            </Button>
          ) : (
            <Button onClick={connect} disabled={!ready || connecting}>
              {connecting
                ? c("Connecting…", "Bağlanıyor…")
                : c("Connect wallet", "Cüzdanı bağla")}
            </Button>
          )}
        </div>
      </div>
      <nav aria-label={c("Application navigation", "Uygulama gezinmesi")}>
        {[
          ["/market", c("Buy", "Al")],
          ["/sell", c("Sell", "Sat")],
          ["/me", c("Activity", "İşlemler")],
          ["/how-it-works", c("Help", "Yardım")],
          ["/about", c("About", "Hakkında")],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={path === href ? "page" : undefined}
            className={
              path === href ||
              (href === "/market" &&
                (path.startsWith("/ads") || path.startsWith("/r")))
                ? "selected"
                : ""
            }
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
