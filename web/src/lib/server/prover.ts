/**
 * Server-side address of the GPU prover. The box (and its URL) changes with every rental, so the browser never
 * talks to it: `/api/prove/*` forwards from here. PROVER_URL is server-only; NEXT_PUBLIC_PROVER_URL is the legacy name.
 */
export const proverUrl = () => (process.env.PROVER_URL ?? process.env.NEXT_PUBLIC_PROVER_URL ?? "").replace(/\/$/, "");

/** GET a prover path and hand its JSON (or error) straight back; 503 when no prover is configured or reachable. */
export async function forward(path: string): Promise<Response> {
  const base = proverUrl();
  if (!base) return Response.json({ error: "no prover is configured on this deployment (PROVER_URL)" }, { status: 503 });
  try {
    const res = await fetch(`${base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "the prover is offline" }, { status: 503 });
  }
}
