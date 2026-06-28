// Block until the Docker Postgres is accepting connections.
import pg from "pg";
import { readFileSync } from "node:fs";

function envUrl() {
  try {
    const text = readFileSync(".env.local", "utf8");
    const m = text.match(/^DATABASE_URL=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  return "postgres://tracejudge:tracejudge@localhost:5433/tracejudge";
}

const url = process.env.DATABASE_URL ?? envUrl();
const deadline = Date.now() + 60_000;

while (true) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    console.log("✓ database is ready");
    process.exit(0);
  } catch (e) {
    await client.end().catch(() => {});
    if (Date.now() > deadline) {
      console.error("✗ database not ready after 60s:", e.message);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
