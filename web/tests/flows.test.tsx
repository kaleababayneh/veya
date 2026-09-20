import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { Keypair } from "@stellar/stellar-sdk";
import type { Ad, Reservation, EscrowConfig } from "@/lib/escrow";
const m = vi.hoisted(() => ({
  address: null as string | null,
  params: { id: "1" },
  search: "",
  push: vi.fn(),
  connect: vi.fn(),
  getAd: vi.fn(),
  getReservation: vi.fn(),
  getConfig: vi.fn(),
  listAds: vi.fn(),
  listReservations: vi.fn(),
  reserve: vi.fn(),
  send: vi.fn(),
  reveal: vi.fn(),
  getJob: vi.fn(),
  proof: vi.fn(),
  info: vi.fn(),
  seal: vi.fn(),
  create: vi.fn(),
  release: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => m.params,
  useSearchParams: () => new URLSearchParams(m.search),
  useRouter: () => ({ push: m.push }),
  usePathname: () => "/market",
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
    connect: m.connect,
    ready: true,
    connecting: false,
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
  }),
}));
vi.mock("@/lib/config", () => ({
  config: {
    xlmSac: "XLM",
    usdcSac: "USDC",
    minMinutesToPay: 15,
    proverUrl: "https://fixture.invalid",
    networkPassphrase: "test",
  },
  txUrl: (h: string) => `https://fixture.invalid/tx/${h}`,
  accountUrl: () => "",
  contractUrl: () => "",
}));
vi.mock("@/lib/escrow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/escrow")>()),
  getAd: m.getAd,
  getReservation: m.getReservation,
  getConfig: m.getConfig,
  listAds: m.listAds,
  listReservations: m.listReservations,
  payeeHashHex: async () => "00".repeat(32),
  send: m.send,
  escrow: () => ({
    reserve: m.reserve,
    create_ad: m.create,
    release: m.release,
    declare_paid: vi.fn(),
    settle: vi.fn(),
  }),
}));
vi.mock("@/lib/reveal", () => ({
  cachedReveal: () => null,
  requestReveal: m.reveal,
  sealPayee: m.seal,
}));
vi.mock("@/lib/prover", () => ({
  requestProof: m.proof,
  getJob: m.getJob,
  proverInfo: m.info,
  fileToBase64: async () => "ZW1s",
  JOB_STEPS: [
    { key: "queued", label: "Queued" },
    { key: "proving", label: "Generating proof" },
    { key: "done", label: "Proof ready" },
  ],
}));
import Market from "@/app/market/page";
import Offer from "@/app/ads/[id]/page";
import Trade from "@/app/r/[id]/page";
import Seller from "@/app/sell/page";
import Activity from "@/app/me/page";
import { I18nProvider } from "@/lib/i18n";
const buyer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey(),
  seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
let ad: Ad, r: Reservation, cfg: EscrowConfig;
const ok = (v: unknown) => ({ isOk: () => true, unwrap: () => v });
function mount(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.address = buyer;
  m.search = "amount=1000&bank=ziraat";
  m.params = { id: "1" };
  const now = BigInt(Math.floor(Date.now() / 1000));
  ad = {
    id: 1n,
    seller,
    token: "USDC",
    remaining: 10000000000n,
    reserved: 100000000n,
    bond_available: 500000000n,
    bond_held: 5000000n,
    price_kurus: 4000n,
    min_try_kurus: 10000n,
    max_try_kurus: 1000000n,
    status: 0,
    decimals: 7,
    expires_at: now + 86400n,
    nickname: "Ada",
    settled_count: 8,
    created_at: now - 500n,
    active_reservations: 1,
    payee_hash: Buffer.alloc(32),
    payee_blob: Buffer.alloc(32),
  } as Ad;
  r = {
    id: 1n,
    ad_id: 1n,
    buyer,
    amount: 250000000n,
    try_amount_kurus: 100000n,
    bond_slice: 12500000n,
    status: 0,
    created_at: now - 20n,
    lock_expires_at: now + 1800n,
    paid_declared_at: 0n,
    late_claim_until: 0n,
    settled_at: 0n,
  };
  cfg = {
    fee_bps: 25,
    bond_bps: 500,
    min_try_kurus: 10000n,
    max_try_kurus: 1000000n,
    image_id: Buffer.alloc(32),
    reveal_pubkey: Buffer.alloc(32),
    lock_duration: 1800n,
    proof_window: 7200n,
    late_claim_window: 259200n,
  } as EscrowConfig;
  m.getAd.mockImplementation(async () => ({ ...ad }));
  m.getReservation.mockImplementation(async () => ({ ...r }));
  m.getConfig.mockResolvedValue(cfg);
  m.listAds.mockImplementation(async () => [{ ...ad }]);
  m.listReservations.mockImplementation(async () => [{ ...r }]);
  m.info.mockResolvedValue({
    image_id: "00".repeat(32),
    prover_mode: "test",
    dkim_source: "fixture",
  });
  m.reveal.mockResolvedValue({
    verified: true,
    iban: "TR420001000000000000000001",
    name: "TEST PERSON",
    bank: "Ziraat",
  });
  m.send.mockResolvedValue({ hash: "a".repeat(64), result: ok({ id: 1n }) });
  m.reserve.mockResolvedValue({});
  m.seal.mockResolvedValue(new Uint8Array(32));
  m.create.mockResolvedValue({});
  m.getJob.mockRejectedValue(new Error("lost"));
  m.proof.mockResolvedValue({
    id: "job-1",
    offer_id: 1,
    status: "queued",
    image_id: "00".repeat(32),
    created_at: Number(now),
  });
});
async function reveal() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Show payment details" }),
  );
  await screen.findAllByText("TEST PERSON");
}
async function readyOffer() {
  await screen.findByText("Before you reserve");
  fireEvent.click(screen.getByRole("checkbox"));
}
async function sellerReview() {
  await screen.findByRole("heading", { name: "What would you like to sell?" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText(/Price in TRY per token/), {
    target: { value: "40" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByText("Where should buyers pay you?");
  fireEvent.change(screen.getByLabelText("Bank"), {
    target: { value: "00010" },
  });
  fireEvent.change(screen.getByLabelText("IBAN"), {
    target: { value: "TR420001000000000000000001" },
  });
  fireEvent.change(screen.getByLabelText(/Account holder name/), {
    target: { value: "TEST PERSON" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByText("Review your offer");
}
describe("buyer admission and amounts", () => {
  it("compares net receipts and excludes expired offers", async () => {
    m.listAds.mockResolvedValue([
      ad,
      { ...ad, id: 2n, nickname: "Expired", expires_at: 1n },
    ]);
    mount(<Market />);
    fireEvent.change(screen.getByLabelText("Amount in Turkish lira"), {
      target: { value: "1000" },
    });
    await screen.findByText("24.9375 USDC");
    expect(screen.queryByText("Expired")).toBeNull();
  });
  it("blocks unsupported bank before reserve", async () => {
    m.search = "amount=1000&bank=other";
    mount(<Offer />);
    await screen.findByText(/Only Ziraat and/);
    expect(
      (screen.getByRole("button", { name: /Reserve 25/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it("preserves readiness through first wallet connection without reserving", async () => {
    m.address = null;
    const view = mount(<Offer />);
    await readyOffer();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect wallet to reserve" }),
    );
    expect(m.connect).toHaveBeenCalledTimes(1);
    expect(m.reserve).not.toHaveBeenCalled();
    m.address = buyer;
    view.rerender(
      <I18nProvider>
        <Offer />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: /Reserve 25/ });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it("revalidates changed prices before a reservation transaction", async () => {
    mount(<Offer />);
    await readyOffer();
    ad = { ...ad, price_kurus: 5000n };
    fireEvent.click(screen.getByRole("button", { name: /Reserve 25/ }));
    await screen.findByText(/Offer changed/);
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it("keeps a rejected transaction retryable and prevents duplicate clicks", async () => {
    m.send.mockRejectedValue(new Error("Wallet rejected signature"));
    mount(<Offer />);
    await readyOffer();
    const b = screen.getByRole("button", { name: /Reserve 25/ });
    fireEvent.click(b);
    fireEvent.click(b);
    await screen.findByText(/Wallet rejected/);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.push).not.toHaveBeenCalled();
  });
});
describe("receipt and trade recovery", () => {
  it("does not show payment controls for mismatched payee", async () => {
    m.reveal.mockResolvedValue({
      verified: false,
      iban: "TRbad",
      name: "Wrong",
    });
    mount(<Trade />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Show payment details" }),
    );
    await screen.findByText("Do not pay.");
    expect(
      screen.queryByRole("button", { name: "I have sent the transfer" }),
    ).toBeNull();
  });
  it("allows already-paid recovery after declaration expiry without suggesting new payment", async () => {
    r.lock_expires_at = 1n;
    mount(<Trade />);
    await reveal();
    fireEvent.click(
      screen.getByRole("button", { name: "I already paid — verify receipt" }),
    );
    await screen.findByText("Drop the .eml file here, or click to choose it");
    expect(
      screen.queryByRole("button", { name: "I have sent the transfer" }),
    ).toBeNull();
  });
  it("requires fresh upload consent and rejects a PDF before prover work", async () => {
    r.paid_declared_at = r.created_at;
    const view = mount(<Trade />);
    await reveal();
    const input = view.container.querySelector("input[type=file]")!;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "receipt.pdf")] },
    });
    await screen.findByText(/Choose the original .eml/);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(m.proof).not.toHaveBeenCalled();
  });
  it("keeps lost proof jobs recoverable without changing payment state", async () => {
    r.paid_declared_at = r.created_at;
    localStorage.setItem(`zkotc-job-${buyer}-r1`, "lost");
    mount(<Trade />);
    await reveal();
    await screen.findByText(/previous proof job is unavailable/);
    expect(
      screen.queryByText("Drop the .eml file here, or click to choose it"),
    ).not.toBeNull();
    expect(m.send).not.toHaveBeenCalled();
  });
  it("blocks upload when the prover is unavailable and describes limited protection", async () => {
    r.paid_declared_at = r.created_at;
    m.info.mockRejectedValue(new Error("offline"));
    mount(<Trade />);
    await reveal();
    await screen.findByText(/payment protection is time-limited/);
    expect(
      (
        screen.getByRole("button", {
          name: "Verify receipt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("does not announce a failed contract release as success", async () => {
    m.send.mockResolvedValue({
      hash: "",
      result: {
        isOk: () => false,
        unwrapErr: () => ({ message: "LockActive" }),
      },
    });
    mount(<Trade />);
    await screen.findByRole("button", { name: "Show payment details" });
    fireEvent.click(
      screen.getByRole("button", { name: "Release the reservation" }),
    );
    await screen.findByText(/LockActive/);
    expect(screen.queryByText("Reservation released")).toBeNull();
  });
  it("clears private revealed information immediately on wallet change", async () => {
    const view = mount(<Trade />);
    await reveal();
    m.address = seller;
    view.rerender(
      <I18nProvider>
        <Trade />
      </I18nProvider>,
    );
    expect(screen.queryByText("TEST PERSON")).toBeNull();
    await waitFor(() => expect(m.getReservation).toHaveBeenCalledTimes(2));
  });
  it("shows bond amount, not a full-trade refund promise", async () => {
    r.status = 2;
    r.paid_declared_at = r.created_at;
    r.late_claim_until = BigInt(Math.floor(Date.now() / 1000) + 300);
    mount(<Trade />);
    await screen.findByText(/tokens themselves are no longer reserved/);
    expect(screen.getAllByText("1.25 USDC", { exact: false })).toBeTruthy();
  });
});
describe("seller and activity", () => {
  it("reviews total deposit and retains values when going back", async () => {
    m.address = seller;
    mount(<Seller />);
    await sellerReview();
    await screen.findByText("525 XLM");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("IBAN") as HTMLInputElement).value).toContain(
      "TR42",
    );
    expect(
      (screen.getByLabelText(/Account holder name/) as HTMLInputElement).value,
    ).toBe("TEST PERSON");
  });
  it("refreshes activity on focus and changes primary action from confirmed state", async () => {
    mount(<Activity />);
    await screen.findByText("Continue payment ↗");
    r.paid_declared_at = r.created_at;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await screen.findByText("Verify receipt ↗");
  });
});
