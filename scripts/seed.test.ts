import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("reseeds a database containing legacy Refund Requests and can run again", () => {
  const directory = mkdtempSync(join(tmpdir(), "cadence-seed-"));
  const filename = join(directory, "data.db");
  const fixture = new Database(filename);
  fixture.pragma("foreign_keys = ON");
  fixture.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE purchases (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    CREATE TABLE refund_requests (id INTEGER PRIMARY KEY, purchase_id INTEGER REFERENCES purchases(id));
    INSERT INTO users VALUES (1);
    INSERT INTO purchases VALUES (1, 1);
    INSERT INTO refund_requests VALUES (1, 1);
  `);
  fixture.close();
  try {
    for (let run = 0; run < 2; run++) {
      const output = execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)
          ),
          fileURLToPath(new URL("./seed.ts", import.meta.url)),
        ],
        { cwd: directory, encoding: "utf8", timeout: 30000 }
      );
      expect(output).toContain("Tables created.");
      expect(output).toContain("✓ Seed complete!");
      const seeded = new Database(filename, { readonly: true });
      try {
        expect(
          seeded
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name = 'refund_requests'"
            )
            .get()
        ).toBeUndefined();
        expect(
          seeded.prepare("SELECT id FROM refunds LIMIT 1").get()
        ).toBeDefined();
        expect(seeded.pragma("foreign_key_check")).toEqual([]);
      } finally {
        seeded.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
