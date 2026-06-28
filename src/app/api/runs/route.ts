import { NextResponse } from "next/server";
import { listRuns } from "@/lib/runs";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = await listRuns(DEMO_TENANT);
    return NextResponse.json({ runs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
