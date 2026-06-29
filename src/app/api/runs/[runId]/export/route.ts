/**
 * X4 — Compliance Evidence Export. Returns the EU AI Act Art. 12 audit bundle
 * (assembled in SQL) as a downloadable JSON file. The bundle embeds the live
 * hash-chain verification so a regulator can independently recompute it.
 */
import { NextResponse } from "next/server";
import { complianceExport } from "@/lib/audit";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const bundle = await complianceExport(params.runId, DEMO_TENANT);
    if (!bundle) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="tracejudge-art12-${params.runId}.json"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
