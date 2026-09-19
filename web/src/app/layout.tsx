import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "zkOTC — P2P TRY ⇄ XLM/USDC with proof of bank payment",
  description: "Peer-to-peer OTC on Stellar. Sellers escrow crypto, buyers pay TRY by FAST and unlock it with a zero-knowledge proof of Ziraat's e-dekont e-mail for the transfer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <WalletProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-muted">
            Stellar testnet · Soroban BN254 verifier · RISC Zero zkEmail proofs · Built for Stellar Pro Hackathon, Istanbul 2026.
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
