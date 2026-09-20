"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";
import { ArrowMark } from "@/components/ArrowMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppFrame({ children }: { children: React.ReactNode }) {
  if (usePathname() === "/") return <>
    <header className="veya-nav">
      <Link href="/" aria-label="Veya home" className="veya-wordmark">veya<span aria-hidden="true"><ArrowMark /></span></Link>
      <div className="veya-nav-action"><span className="testnet-label">Testnet</span><ThemeToggle /><Link href="/market" className="veya-button nav-button">Launch app <span aria-hidden="true"><ArrowMark /></span></Link></div>
    </header>
    <main id="main-content">{children}</main>
  </>;
  return <WalletProvider><div className="product-app"><Nav /><main id="main-content" className="product-main">{children}</main><footer className="product-footer">Veya · Stellar testnet</footer></div></WalletProvider>;
}
