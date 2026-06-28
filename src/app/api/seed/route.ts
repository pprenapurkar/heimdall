/**
 * Restore the demo to a clean state: re-register the manifest and re-ingest all
 * three fixtures through the real pipeline. Used by the dashboard "Reset demo"
 * button (and handy after a tamper demo). Synthetic data only.
 */
import { NextResponse } from "next/server";
import { registerManifest } from "@/lib/ingest";
import { processRun } from "@/lib/pipeline";
import { DEMO_TENANT } from "@/lib/tenant";
import agentManifest from "../../../../fixtures/agent.json";
import green from "../../../../fixtures/green.json";
import yellow from "../../../../fixtures/yellow.json";
import red from "../../../../fixtures/red.json";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await registerManifest(
      agentManifest.agent as never,
      agentManifest.task as never,
      DEMO_TENANT
    );
    const results = [];
    for (const fx of [green, yellow, red]) {
      results.push(await processRun(fx as never, DEMO_TENANT));
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
