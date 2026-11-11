import { setTimeout } from "node:timers/promises";
import { db } from "../app/db";
import { knockAdapter } from "../app/lib/knock.server";
import { processNextNotification } from "../app/lib/notification-submissions.server";

const adapter = knockAdapter();
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const once = process.argv.includes("--once");
do {
  try {
    const processed = await processNextNotification(db, adapter);
    if (!processed && !once && !stopping) await setTimeout(1_000);
  } catch {
    // Keep transient local failures from creating a busy loop. A committed claim
    // remains recoverable after its lease; no credential/payload is logged.
    console.error(
      "Notification worker processing failed; retrying after lease recovery"
    );
    if (once) process.exitCode = 1;
    if (!once && !stopping) await setTimeout(1_000);
  }
} while (!once && !stopping);
