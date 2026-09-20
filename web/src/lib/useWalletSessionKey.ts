"use client";
import { useState } from "react";
/** Keep an unconnected draft through first connection; discard it on disconnect/account switch. */
export function useWalletSessionKey(address: string | null) {
  const [session, setSession] = useState({ address, key: 0 });
  if (session.address !== address)
    setSession({
      address,
      key: session.address ? session.key + 1 : session.key,
    });
  return session.key;
}
