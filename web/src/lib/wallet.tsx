"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { config } from "./config";
import { useToast } from "@/components/Toast";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

type WalletCtx = {
  address: string | null;
  connecting: boolean;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  /** Sign a plain-text message with the connected wallet (used to prove wallet control to the reveal service). */
  signMessage: (message: string) => Promise<{ signedMessage: string; signerAddress?: string }>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [{ StellarWalletsKit }, { defaultModules }, { KitEventType, Networks }] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/sdk"),
        import("@creit.tech/stellar-wallets-kit/modules/utils"),
        import("@creit.tech/stellar-wallets-kit/types"),
      ]);
      StellarWalletsKit.init({
        modules: defaultModules(),
        network: Networks.TESTNET,
        authModal: { showInstallLabel: true },
      });
      off = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (e) => setAddress(e.payload.address ?? null));
      setKit(() => StellarWalletsKit);
    })();
    return () => off?.();
  }, []);

  const connect = useCallback(async () => {
    if (!kit) return;
    setConnecting(true);
    try {
      const { address } = await kit.authModal();
      setAddress(address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/closed|cancel|dismiss/i.test(msg)) {
        toast({ kind: "error", title: "Could not connect a wallet", body: <>Install <a className="underline" href="https://www.freighter.app" target="_blank" rel="noreferrer">Freighter</a> (browser extension), switch it to Testnet, then try again. {msg}</> });
      }
    } finally {
      setConnecting(false);
    }
  }, [kit, toast]);

  const disconnect = useCallback(async () => {
    await kit?.disconnect();
    setAddress(null);
  }, [kit]);

  const signTransaction = useCallback<WalletCtx["signTransaction"]>(
    async (xdr, opts) => {
      if (!kit) throw new Error("wallet not ready");
      return kit.signTransaction(xdr, { networkPassphrase: config.networkPassphrase, address: address ?? undefined, ...opts });
    },
    [kit, address],
  );

  const signMessage = useCallback<WalletCtx["signMessage"]>(
    async (message) => {
      if (!kit) throw new Error("wallet not ready");
      return kit.signMessage(message, { networkPassphrase: config.networkPassphrase, address: address ?? undefined });
    },
    [kit, address],
  );

  const value = useMemo(
    () => ({ address, connecting, ready: !!kit, connect, disconnect, signTransaction, signMessage }),
    [address, connecting, kit, connect, disconnect, signTransaction, signMessage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
