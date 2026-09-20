"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { short } from "@/lib/format";
import { Button } from "./ui";
import { useI18n } from "@/lib/i18n";

export function Nav() {
  const { address, connect, disconnect, connecting, ready } = useWallet();
  const { lang, setLang, t } = useI18n();
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-sm ${path === href ? "bg-panel-2 font-medium" : "text-muted hover:text-fg"}`}>
      {t(label)}
    </Link>
  );
  const links = (
    <>
      {link("/market", "Market")}
      {link("/sell", "Post an ad")}
      {link("/me", "My activity")}
      {link("/anchor", "Anchor")}
      {link("/how-it-works", "How it works")}
    </>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg text-xs font-bold">₺</span>
          Veya <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">testnet</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">{links}</nav>
        <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg"
          onClick={() => setLang(lang === "en" ? "tr" : "en")}
          title={lang === "en" ? "Alıcı adımlarını Türkçe göster" : "Show the buyer steps in English"}
        >
          {lang === "en" ? "TR" : "EN"}
        </button>
        {address ? (
          <Button variant="ghost" onClick={disconnect} title={address}>
            <span className="h-2 w-2 rounded-full bg-ok" /> {short(address, 5)}
          </Button>
        ) : (
          <Button onClick={connect} disabled={!ready || connecting}>
            {connecting ? t("Connecting…") : t("Connect wallet")}
          </Button>
        )}
        </div>
      </div>
      {/* phones: the same links as a scrollable row under the header */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:hidden">{links}</nav>
    </header>
  );
}
