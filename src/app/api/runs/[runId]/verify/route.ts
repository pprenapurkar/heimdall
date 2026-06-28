/** C4 — recompute and verify the run's hash chain in SQL. */
import { NextResponse } from "next/server";
import { verifyChain } from "@/lib/audit";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const result = await verifyChain(params.runId, DEMO_TENANT);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
