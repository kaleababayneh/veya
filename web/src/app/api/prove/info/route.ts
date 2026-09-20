/** GET /api/prove/info — the prover's image id and mode, forwarded (see lib/server/prover.ts). */
import { forward } from "@/lib/server/prover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => forward("/info");
