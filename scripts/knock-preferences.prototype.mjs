// THROWAWAY live Development verification; leaves its test recipient for inspection.
// Requires a committed, feed-only cadence-prototype-new-enrollment workflow
// carrying the category new-enrollment. Run: node scripts/knock-preferences.prototype.mjs
import Knock, { signUserToken } from "@knocklabs/node";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = parseEnv(readFileSync(".env", "utf8"));
if (env.KNOCK_ENVIRONMENT !== "development" || !env.KNOCK_SECRET_API_KEY?.startsWith("sk_test_") || !env.KNOCK_FEED_CHANNEL_ID) {
  throw new Error("Development credentials and feed channel required");
}
const client = new Knock({ apiKey: env.KNOCK_SECRET_API_KEY });
const id = `cadence-prototype-instructor-${randomUUID()}`;
const workflow = "cadence-prototype-new-enrollment";
const results = [];
const report = { at: new Date().toISOString(), recipientId: id, results };
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(JSON.stringify(results.at(-1)));
  if (!passed) throw new Error(`Verification failed: ${name}`);
}
const sleep = () => new Promise(resolve => setTimeout(resolve, 1000));
let headers;
async function signed(path, method = "GET", body) {
  const response = await fetch(`https://api.knock.app/v1/${path}`, {
    method, headers, signal: AbortSignal.timeout(20000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Signed request failed: HTTP ${response.status}`);
  return response.json();
}
const feedPath = `users/${id}/feeds/${env.KNOCK_FEED_CHANNEL_ID}`;
async function triggerAndFinish(phase, key = workflow) {
  const trigger = await client.workflows.trigger(key, {
    recipients: [id], data: { prototype: true, phase, body: `THROWAWAY ${phase}`, url: "/instructor" },
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    const page = await client.workflowRecipientRuns.list({ recipient: id, workflow: key });
    const run = page.items.find(run => run.workflow_run_id === trigger.workflow_run_id);
    if (run?.status === "completed") {
      const detail = await client.workflowRecipientRuns.get(run.id);
      return { trigger, run: detail, feed: await signed(feedPath) };
    }
    await sleep();
  }
  throw new Error("Workflow did not complete within the verification window");
}
function summary(result) {
  return { workflowRunId: result.trigger.workflow_run_id, status: result.run.status,
    errorCount: result.run.error_count, events: result.run.events.map(event => ({
      event: event.event, status: event.status, step: event.step_ref, data: event.data,
    })), feedItems: result.feed.entries.length };
}
function preferenceSuppressed(run) {
  return run.events.some(event => event.event === "preference_set_evaluated" && event.data?.opted_out === true);
}
try {
  // Application-owned default: initialize once when first syncing an Instructor.
  // This is not an environment default, and must precede every first trigger.
  await client.users.update(id, {
    name: "THROWAWAY Cadence Instructor preference verification",
    preferences: { default: { categories: { "new-enrollment": {
      channel_types: { in_app_feed: false, email: false, push: false },
    } } } },
  });
  const token = await signUserToken(id, { signingKey: env.KNOCK_SIGNING_KEY, expiresInSeconds: 600 });
  headers = { Authorization: `Bearer ${env.KNOCK_PUBLIC_API_KEY}`, "X-Knock-User-Token": token, "Content-Type": "application/json" };
  const preferences = await signed(`users/${id}/preferences/default`);
  const category = preferences.categories?.["new-enrollment"]?.channel_types;
  check("New Instructor starts with New Enrollment channels off", category?.in_app_feed === false && category?.email === false && category?.push === false, { category });

  const off = await triggerAndFinish("default-off");
  if (off.feed.entries.length) {
    check("Committed workflow carries the expected category", off.feed.entries[0].source.categories.includes("new-enrollment"), {
      source: off.feed.entries[0].source,
      hint: "Workflow → … → Manage workflow → categories; save and commit to Development",
    });
  }
  check("Completed default-off workflow suppresses feed delivery", off.run.error_count === 0 && off.feed.entries.length === 0 && preferenceSuppressed(off.run), summary(off));

  await signed(`users/${id}/preferences/default`, "PUT", {
    __persistence_strategy__: "merge", categories: { "new-enrollment": {
      channel_types: { in_app_feed: true, email: false, push: false },
    } },
  });
  // Subsequent user sync must omit the initialization baseline and preserve opt-in.
  await client.users.update(id, { name: "THROWAWAY Cadence Instructor preference verification" });
  const optedIn = await signed(`users/${id}/preferences/default`);
  const channels = optedIn.categories?.["new-enrollment"]?.channel_types;
  check("Signed feed opt-in survives subsequent user sync", channels?.in_app_feed === true && channels?.email === false && channels?.push === false, { channels });

  const on = await triggerAndFinish("opted-in");
  const item = on.feed.entries.find(item => item.data?.phase === "opted-in");
  check("Opt-in delivers category-tagged New Enrollment Notification", on.run.error_count === 0 && Boolean(item) && item.source.categories.includes("new-enrollment"), { ...summary(on), itemId: item?.id, source: item?.source });

  await signed(`users/${id}/preferences/default`, "PUT", {
    __persistence_strategy__: "merge", categories: { "new-enrollment": {
      channel_types: { in_app_feed: false, email: false, push: false },
    } },
  });
  const offAgain = await triggerAndFinish("opted-out-again");
  check("Opting out again suppresses only the new Notification", offAgain.run.error_count === 0 && offAgain.feed.entries.length === 1 && !offAgain.feed.entries.some(item => item.data?.phase === "opted-out-again") && preferenceSuppressed(offAgain.run), summary(offAgain));
  const other = await triggerAndFinish("unrelated-category", "cadence-prototype-discussion-reply");
  check("New Enrollment opt-out leaves unrelated Notifications enabled", other.run.error_count === 0 && other.feed.entries.some(item => item.data?.phase === "unrelated-category"), summary(other));
  report.passed = true;
} catch (error) {
  report.passed = false;
  // SDK errors can contain credential-bearing requests; print only known fields.
  report.error = { name: error.name, status: error.status, message: error.status ? "Knock SDK request failed" : error.message };
  console.log(JSON.stringify(report.error));
  process.exitCode = 1;
} finally {
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/knock-preferences-verification.json", JSON.stringify(report, null, 2));
}
