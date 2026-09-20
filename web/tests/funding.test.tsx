import React from "react";
import { beforeEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
const m = vi.hoisted(() => ({
  address: "wallet-a",
  price: vi.fn(),
  login: vi.fn(),
  deposit: vi.fn(),
  history: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...p
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p}>{children}</a>,
}));
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({
    address: m.address,
    ready: true,
    connecting: false,
    signTransaction: vi.fn(),
    connect: vi.fn(),
  }),
}));
vi.mock("@/lib/anchor", () => ({
  anchorConfigured: () => true,
  discover: async () => ({ homeDomain: "mock.fixture" }),
  info: async () => ({
    deposit: { USDC: { enabled: true, min_amount: 1, max_amount: 10000 } },
    withdraw: { USDC: { enabled: true } },
  }),
  login: m.login,
  kyc: async () => {},
  usdcBalance: async () => "10",
  transactions: m.history,
  firmPrice: m.price,
  deposit: m.deposit,
  transaction: async () => null,
  FINAL: new Set(["completed"]),
}));
import Funding from "@/app/anchor/page";
beforeEach(() => {
  vi.clearAllMocks();
  m.address = "wallet-a";
  m.login.mockResolvedValue("session");
  m.history.mockResolvedValue([]);
  m.price.mockResolvedValue({ buy_amount: "5", total_price: "40" });
  m.deposit.mockResolvedValue({ id: "d1", instructions: {} });
});
async function signIn() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Sign in with wallet" }),
  );
  await screen.findByLabelText(/You pay/);
}
it("disables a deposit until its own amount quote arrives and ignores a late previous quote", async () => {
  let oldResolve: (v: unknown) => void = () => {},
    newResolve: (v: unknown) => void = () => {};
  m.price.mockImplementation(
    (_token: string, _side: string, amount: string) =>
      new Promise((resolve) => {
        if (amount === "200.00") oldResolve = resolve;
        else newResolve = resolve;
      }),
  );
  render(<Funding />);
  await signIn();
  await waitFor(() => expect(m.price).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText(/You pay/), {
    target: { value: "400" },
  });
  await waitFor(() => expect(m.price).toHaveBeenCalledTimes(2));
  await act(async () => oldResolve({ buy_amount: "5", total_price: "40" }));
  expect(
    (
      screen.getByRole("button", {
        name: "Get transfer instructions",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.queryByText("5 USDC")).toBeNull();
  await act(async () => newResolve({ buy_amount: "10", total_price: "40" }));
  await screen.findByText("10 USDC");
  fireEvent.click(
    screen.getByRole("button", { name: "Get transfer instructions" }),
  );
  await waitFor(() =>
    expect(m.deposit).toHaveBeenCalledWith("session", "wallet-a", "400.00"),
  );
});
it("does not carry anchor authentication into a different wallet", async () => {
  const view = render(<Funding />);
  await signIn();
  m.address = "wallet-b";
  view.rerender(<Funding />);
  expect(screen.queryByLabelText(/You pay/)).toBeNull();
  await screen.findByRole("button", { name: "Sign in with wallet" });
  expect(m.login).toHaveBeenCalledTimes(1);
});
it("rejects an over-limit deposit before asking the provider", async () => {
  render(<Funding />);
  await signIn();
  fireEvent.change(screen.getByLabelText(/You pay/), {
    target: { value: "20000" },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Get transfer instructions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Get transfer instructions" }),
  );
  await screen.findByText("Amount is outside the provider limits.");
  expect(m.deposit).not.toHaveBeenCalled();
});
