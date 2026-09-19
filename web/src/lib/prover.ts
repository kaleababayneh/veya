import { config } from "./config";

export type JobStatus = "queued" | "executing" | "proving" | "done" | "failed";

export type ProverJob = {
  id: string;
  status: JobStatus;
  offer_id: number;
  created_at: number;
  updated_at: number;
  row?: { date_yyyymmdd: number; fis_no: string; amount_kurus: number; description: string } | null;
  claim?: {
    dkim_key_hash: string;
    domain_hash: string;
    recipient_iban_hash: string;
    amount_kurus: number;
    date_yyyymmdd: number;
    nullifier: string;
    offer_id: number;
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

export async function createJob(args: {
  emlBase64: string;
  offerId: bigint;
  recipientIban: string;
  minAmountKurus: bigint;
  sinceYmd: number;
}): Promise<ProverJob> {
  const res = await fetch(`${config.proverUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.proverToken ? { "x-prover-token": config.proverToken } : {}) },
    body: JSON.stringify({
      eml_base64: args.emlBase64,
      offer_id: Number(args.offerId),
      recipient_iban: args.recipientIban,
      min_amount_kurus: Number(args.minAmountKurus),
      since_yyyymmdd: args.sinceYmd,
    }),
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
  { key: "executing", label: "Checking e-mail", help: "DKIM signature, statement attachment and payment row are verified." },
  { key: "proving", label: "Generating proof", help: "RISC Zero zkVM run → Groth16 receipt over BN254 (2–10 min)." },
  { key: "done", label: "Proof ready", help: "Submit it to the escrow contract to receive your crypto." },
];
