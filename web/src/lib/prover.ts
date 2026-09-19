import { config } from "./config";

export type JobStatus = "queued" | "executing" | "proving" | "done" | "failed";

export type ProverJob = {
  id: string;
  status: JobStatus;
  /** the reservation id the proof is bound to (the prover API still calls it offer_id) */
  offer_id: number;
  created_at: number;
  updated_at: number;
  dekont?: { date_yyyymmdd: number; time: string; fis_no: string; amount_kurus: number; description: string; fast_sorgu_no?: string | null; recipient_name?: string | null } | null;
  claim?: {
    dkim_key_hash: string;
    domain_hash: string;
    payee_hash: string;
    amount_kurus: number;
    date_yyyymmdd: number;
    nullifier: string;
    offer_id: number;
    reference_hash: string;
  } | null;
  public_values?: string | null;
  proof?: string | null;
  image_id: string;
  journal_digest?: string | null;
  cycles?: number | null;
  error?: string | null;
};

export type ProverInfo = { image_id: string; prover_mode: string; dkim_source: string; public_values_len: number };

async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err = (body as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(err);
  }
  return body as T;
}

export const proverInfo = () => fetch(`${config.proverUrl}/info`).then((r) => j<ProverInfo>(r));

/**
 * Start a proving job through this app's `/api/prove` gate: the wallet signs a short message (no transaction),
 * the server checks the reservation on-chain, opens the maker's payee details and forwards the e-mail to the
 * prover with its private token. The browser never holds the prover token or the payee-derived parameters.
 */
export async function requestProof(args: {
  reservationId: bigint;
  address: string;
  signMessage: (message: string) => Promise<{ signedMessage: string }>;
  emlBase64: string;
}): Promise<ProverJob> {
  const message = `zkotc prove reservation ${args.reservationId.toString()} at ${Math.floor(Date.now() / 1000)}`;
  const { signedMessage } = await args.signMessage(message);
  const res = await fetch("/api/prove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reservationId: args.reservationId.toString(), address: args.address, message, signature: signedMessage, emlBase64: args.emlBase64 }),
  });
  return j<ProverJob>(res);
}

export const getJob = (id: string) => fetch(`${config.proverUrl}/jobs/${id}`).then((r) => j<ProverJob>(r));

export const fileToBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export const JOB_STEPS: { key: JobStatus; label: string; help: string }[] = [
  { key: "queued", label: "Queued", help: "Waiting for the prover." },
  { key: "executing", label: "Checking e-mail", help: "DKIM signature, e-dekont attachment and transfer details are verified." },
  { key: "proving", label: "Generating proof", help: "RISC Zero zkVM run → Groth16 receipt over BN254 (~15 s on the GPU prover)." },
  { key: "done", label: "Proof ready", help: "Submit it to the escrow contract to receive your crypto." },
];
