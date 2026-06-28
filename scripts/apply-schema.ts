/**
 * Apply db/schema.sql to the configured database. Idempotent.
 * Local only (DB_MODE=local). For Aurora, the same file is applied during
 * provisioning — see DEPLOY.md.
 */
import "../src/lib/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query, closePool } from "../src/lib/db";

async function main() {
  const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
  await query(sql);
  console.log("✓ schema applied");
  await closePool();
}

main().catch((e) => {
  console.error("✗ schema failed:", e);
  process.exit(1);
});
