import React, { useState } from "react";
import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({
  address: "wallet-a",
  network: "Test SDF Network ; September 2015",
  sign: vi.fn(),
}));
vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: () => {},
    on: (_event: unknown, callback: (e: unknown) => void) => {
      callback({ payload: { address: "wallet-a" } });
      return () => {};
    },
    getAddress: async () => ({ address: m.address }),
    getNetwork: async () => ({ networkPassphrase: m.network }),
    signTransaction: m.sign,
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: () => [],
}));
vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  KitEventType: { STATE_UPDATED: "update" },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
}));
import { WalletProvider, useWallet } from "../src/lib/wallet";
function Harness() {
  const w = useWallet(),
    [result, setResult] = useState("");
  return (
    <>
      <button
        disabled={!w.ready}
        onClick={() =>
          w
            .signTransaction("fixture")
            .then(() => setResult("signed"))
            .catch((e) => setResult(e.message))
        }
      >
        Sign
      </button>
      <p>{result}</p>
    </>
  );
}
beforeEach(() => {
  m.address = "wallet-a";
  m.network = "Test SDF Network ; September 2015";
  m.sign.mockReset().mockResolvedValue({ signedTxXdr: "fixture" });
});
async function ready() {
  render(
    <WalletProvider>
      <Harness />
    </WalletProvider>,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
it("blocks a wrong-network signature before opening the transaction prompt", async () => {
  m.network = "Public Global Stellar Network ; September 2015";
  await ready();
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(/Switch your wallet/);
  expect(m.sign).not.toHaveBeenCalled();
});
it("rejects a signature returned after an account switch", async () => {
  m.sign.mockImplementation(async () => {
    m.address = "wallet-b";
    return { signedTxXdr: "fixture" };
  });
  await ready();
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(/Wallet changed during signing/);
  expect(screen.queryByText("signed")).toBeNull();
});
