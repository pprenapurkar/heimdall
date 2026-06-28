import { NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const detail = await getRun(params.runId, DEMO_TENANT);
    if (!detail) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
