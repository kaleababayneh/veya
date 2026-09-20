/** GET /api/prove/jobs/<id> — proving job status and, when done, the proof; forwarded (see lib/server/prover.ts). */
import { forward } from "@/lib/server/prover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Response.json({ error: "bad job id" }, { status: 400 });
  return forward(`/jobs/${id}`);
}
