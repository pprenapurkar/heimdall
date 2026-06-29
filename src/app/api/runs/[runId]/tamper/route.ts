/**
 * C4 DEMO - mutate one event without updating its stored hash, to prove the
 * chain catches silent edits. POST { seq } (defaults to 2). Synthetic data only.
 */
import { NextResponse } from "next/server";
import { tamperWithEvent, verifyChain } from "@/lib/audit";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const seq = Number(body.seq ?? 2);
    await tamperWithEvent(params.runId, seq, DEMO_TENANT);
    const result = await verifyChain(params.runId, DEMO_TENANT);
    return NextResponse.json({ tampered_seq: seq, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
