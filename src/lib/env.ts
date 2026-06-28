/**
 * Minimal .env loader for non-Next contexts (tsx scripts, vitest).
 *
 * Next.js loads .env.local automatically, but standalone scripts and the test
 * runner do not. To keep zero extra dependencies we parse .env.local ourselves.
 * Values already present in process.env win (so CI / shell overrides are honored).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
    } catch {
      // file missing is fine
    }
  }
}

load();

export {};
