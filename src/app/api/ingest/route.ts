/**
 * Trace ingestion endpoint (architecture: "ingestion endpoint" in CLAUDE.md §3).
 * POST a run fixture (OTel GenAI-aligned events) and the full pipeline runs:
 * ingest -> hash chain -> drift -> circuit breaker. Returns the verdict.
 *
 * Body: a RunFixture (see src/lib/ingest.ts). Optionally { manifest: {agent,task} }
 * to (re)register intent in the same call.
 */
import { NextResponse } from "next/server";
import { processRun, type PipelineResult } from "@/lib/pipeline";
import { registerManifest } from "@/lib/ingest";
import { DEMO_TENANT } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenant = body.tenant_id ?? DEMO_TENANT;

    if (body.manifest?.agent && body.manifest?.task) {
      await registerManifest(body.manifest.agent, body.manifest.task, tenant);
    }
    if (!body.run_id || !Array.isArray(body.events)) {
      return NextResponse.json(
        { error: "expected a run fixture with run_id + events[]" },
        { status: 400 }
      );
    }
    const result: PipelineResult = await processRun(body, tenant);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
