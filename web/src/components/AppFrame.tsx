"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";

export function AppFrame({ children }: { children: React.ReactNode }) {
  if (usePathname() === "/") return <>
    <header className="veya-nav">
      <Link href="/" aria-label="Veya home" className="veya-wordmark">veya<span aria-hidden="true">↗</span></Link>
      <nav aria-label="Main navigation"><Link href="/market">The market</Link><Link href="/how-it-works">How it works</Link></nav>
      <div className="veya-nav-action"><span className="testnet-label">Testnet</span><Link href="/market" className="veya-button nav-button">Explore Veya <span aria-hidden="true">↗</span></Link></div>
    </header>
    <main id="main-content">{children}</main>
  </>;
  return <WalletProvider><div className="product-app"><Nav /><main id="main-content" className="product-main">{children}</main><footer className="product-footer">Veya · Stellar testnet</footer></div></WalletProvider>;
}
