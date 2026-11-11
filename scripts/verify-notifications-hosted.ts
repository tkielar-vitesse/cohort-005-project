// Deliberate hosted verification only. No domain/SDK import occurs before --live.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { NotificationFeed, PreferenceSet } from "../app/lib/notifications";
import type KnockClient from "@knocklabs/node";

if (!process.argv.includes("--live")) {
  console.log(
    "Usage: tsx scripts/verify-notifications-hosted.ts --live --runtime-env=<absolute .env path> [--inspect-evidence=<evidence.json>]\nCreates isolated migrated SQLite fixtures; all triggers remain sandboxed. No actual email delivery."
  );
} else {
  try {
    await main();
  } catch (error) {
    // SDK exceptions can carry request metadata: retain only safe assertion text.
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Hosted verification failed; inspect sanitized evidence and configuration."
    );
    process.exitCode = 1;
  }
}

async function main() {
  const envPath = process.argv
    .find((value) => value.startsWith("--runtime-env="))
    ?.slice(14);
  if (envPath) {
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(envPath, "utf8"))
    ))
      if (process.env[key] === undefined) process.env[key] = value;
  }
  const [
    { default: Knock },
    { createKnockAdapter, knockConfig, notificationCredentials },
    { createTestDb },
    s,
    { purchaseCourse, purchaseTeamLicence },
    { redeemSeat },
    { createDiscussionComment },
    refunds,
    submissions,
    preferences,
  ] = await Promise.all([
    import("@knocklabs/node"),
    import("../app/lib/knock.server"),
    import("../app/test/setup"),
    import("../app/db/schema"),
    import("../app/lib/purchases.server"),
    import("../app/lib/seats.server"),
    import("../app/lib/discussions.server"),
    import("../app/lib/refunds.server"),
    import("../app/lib/notification-submissions.server"),
    import("../app/lib/notifications"),
  ]);
  const config = knockConfig();
  const client = new Knock({ apiKey: config.secretKey, maxRetries: 0 });
  const inspectPath = process.argv
    .find((value) => value.startsWith("--inspect-evidence="))
    ?.slice(19);
  if (inspectPath) return auditEvidence(client, inspectPath);
  // Observe the final adapter contract before forwarding the unmodified request.
  const originalTrigger = client.workflows.trigger.bind(client.workflows);
  let sandboxAssertions = 0;
  client.workflows.trigger = ((...args: Parameters<typeof originalTrigger>) => {
    assert.equal(args[1].settings?.sandbox_mode, true);
    sandboxAssertions++;
    return originalTrigger(...args);
  }) as typeof originalTrigger;
  const adapter = createKnockAdapter(client);
  const db = createTestDb();
  const run = Date.now();
  const directory = resolve(".outbox/hosted-domains", String(run));
  mkdirSync(directory, { recursive: true });
  const people = Object.fromEntries(
    ["I", "A", "B", "T", "P", "Q"].map((name, offset) => {
      const person = db
        .insert(s.users)
        .values({
          id: run * 10 + offset,
          name: `Hosted ${name} ${run}`,
          email: `${run}-${name.toLowerCase()}@cadence-test.invalid`,
          role:
            name === "I"
              ? s.UserRole.Instructor
              : ["P", "Q"].includes(name)
                ? s.UserRole.Admin
                : s.UserRole.Student,
        })
        .returning()
        .get();
      return [name, person];
    })
  );
  const person = (name: string) => {
    const result = people[name];
    assert.ok(result, `Unknown fixture ${name}`);
    return result;
  };
  const category = db
    .insert(s.categories)
    .values({ name: "Hosted verification", slug: `hosted-${run}` })
    .returning()
    .get();
  let courseIndex = 0;
  function course() {
    const row = db
      .insert(s.courses)
      .values({
        title: `Hosted course ${run} ${++courseIndex}`,
        slug: `hosted-${run}-${courseIndex}`,
        description: "Isolated verification fixture",
        salesCopy: "Verification",
        instructorId: person("I").id,
        categoryId: category.id,
        status: s.CourseStatus.Published,
        price: 7900,
        pppEnabled: false,
      })
      .returning()
      .get();
    const module = db
      .insert(s.modules)
      .values({ courseId: row.id, title: "Verification", position: 1 })
      .returning()
      .get();
    const lesson = db
      .insert(s.lessons)
      .values({ moduleId: module.id, title: "Hosted lesson", position: 1 })
      .returning()
      .get();
    return { ...row, lessonId: lesson.id };
  }
  const accepted: unknown[] = [];
  const phases: unknown[] = [];
  const expected = new Map<string, number>();
  const workflows = preferences.notificationTypes.map((type) => type.key);
  const payloads: Record<string, Record<string, unknown>> = {};
  const feeds: Record<string, NotificationFeed> = {};
  let previousSubmissionId = 0;
  const disabled = new Set<string>();
  let enrollmentOn = false;
  function snapshot() {
    writeFileSync(
      resolve(directory, "evidence.json"),
      JSON.stringify(
        {
          run,
          people: Object.fromEntries(
            Object.entries(people).map(([key, value]) => [key, value.id])
          ),
          sandboxAssertions,
          accepted,
          phases,
          feeds: Object.fromEntries(
            Object.entries(feeds).map(([id, value]) => [
              id,
              {
                meta: value.meta,
                entries: value.entries.map((entry) => ({
                  id: entry.id,
                  source: entry.source,
                  data: entry.data,
                  inserted_at: entry.inserted_at,
                  read_at: entry.read_at,
                  seen_at: entry.seen_at,
                })),
              },
            ])
          ),
          expected: Object.fromEntries(expected),
          pending: submissions
            .getNotificationSubmissions(db)
            .filter((row) => row.state !== "accepted"),
        },
        null,
        2
      )
    );
    writeFileSync(
      resolve(directory, "domain-payloads.json"),
      JSON.stringify(payloads, null, 2)
    );
  }
  async function feed(id: number) {
    const credentials = notificationCredentials({ id }, config);
    const response = await fetch(
      `https://api.knock.app/v1/users/${id}/feeds/${config.channelId}?page_size=50`,
      {
        headers: {
          Authorization: `Bearer ${credentials.publicKey}`,
          "X-Knock-User-Token": credentials.token,
        },
      }
    );
    assert.equal(response.status, 200, `Feed status for ${id}`);
    return (await response.json()) as NotificationFeed;
  }
  async function finish(
    label: string,
    expectedRecipients?: Record<string, number[]>
  ) {
    const rows = submissions
      .getNotificationSubmissions(db)
      .filter((row) => row.id > previousSubmissionId);
    if (expectedRecipients)
      assert.ok(
        rows.every((row) => Object.hasOwn(expectedRecipients, row.workflow)),
        `${label}: unexpected workflow`
      );
    if (expectedRecipients)
      for (const [workflow, ids] of Object.entries(expectedRecipients))
        assert.deepEqual(
          rows
            .filter((row) => row.workflow === workflow)
            .map((row) => row.recipientId)
            .sort(),
          [...ids].sort(),
          `${label} exact ${workflow} recipients`
        );
    for (const row of rows) {
      assert.notEqual(row.recipientId, row.actorId);
      payloads[row.workflow] ??= row.data;
      const key = `${row.recipientId}/${row.workflow}`;
      if (
        !disabled.has(row.workflow) &&
        (row.workflow !== "cadence-enrollment" || enrollmentOn)
      )
        expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    for (let attempt = 0; attempt < rows.length; attempt++)
      await submissions.processNextNotification(db, adapter);
    const outcomes = submissions
      .getNotificationSubmissions(db)
      .filter((row) => row.id > previousSubmissionId);
    accepted.push({
      label,
      submissions: outcomes.map(
        ({
          id,
          eventKey,
          recipientId,
          actorId,
          workflow,
          state,
          workflowRunId,
          data,
        }) => ({
          id,
          eventKey,
          recipientId,
          actorId,
          workflow,
          state,
          workflowRunId,
          destination: data.url,
        })
      ),
    });
    snapshot();
    assert.ok(
      outcomes.every((row) => row.state === "accepted" && row.workflowRunId),
      `${label}: worker acceptance incomplete; inspect evidence`
    );
    const started = Date.now();
    let matches = false;
    do {
      matches = true;
      for (const p of Object.values(people)) {
        const result = await feed(p.id);
        feeds[String(p.id)] = result;
        for (const workflow of workflows) {
          const actual = result.entries.filter(
            (entry) => entry.source?.key === workflow
          ).length;
          if (actual !== (expected.get(`${p.id}/${workflow}`) ?? 0))
            matches = false;
        }
      }
      snapshot();
      if (matches && Date.now() - started >= 12_000) break;
      await new Promise((done) => setTimeout(done, 2000));
    } while (Date.now() - started < 60_000);
    phases.push({
      label,
      accepted: outcomes.length,
      feedMatched: matches,
      polledMilliseconds: Date.now() - started,
    });
    previousSubmissionId = outcomes.at(-1)?.id ?? previousSubmissionId;
    snapshot();
    assert.ok(
      matches,
      `${label}: exact hosted Feed counts did not match within 60 seconds`
    );
    console.log(
      `${label}: ${outcomes.length} accepted; exact Feed recipient/type counts matched`
    );
  }
  async function save(name: string, receive: boolean, email: boolean) {
    const id = String(person(name).id);
    const before = (await client.users.getPreferences(
      id,
      "default"
    )) as unknown as PreferenceSet;
    const choices = preferences.preferenceChoices(before).map((choice) => ({
      ...choice,
      receive,
      email:
        email &&
        preferences.notificationTypes.find((type) => type.key === choice.key)
          ?.email === true,
    }));
    const patch = preferences.preferenceUpdate(
      choices,
      preferences.preferenceChoices(before)
    );
    // Same native recursive patch as Settings; never replace the preference set.
    await client.users.setPreferences(id, "default", {
      ...patch,
      __persistence_strategy__: "merge",
    });
    const after = await client.users.getPreferences(id, "default");
    phases.push({ label: `preferences-${name}`, patch, readback: after });
    snapshot();
  }
  function buy(name: string, c = course()) {
    const result = purchaseCourse(db, {
      studentId: person(name).id,
      courseId: c.id,
      amountPaid: 7900,
      country: "PL",
    });
    assert.ok(result.created);
    return { purchase: result.purchase, course: c };
  }
  function licence(name: string, c = course()) {
    return {
      ...purchaseTeamLicence(db, {
        studentId: person(name).id,
        courseId: c.id,
        amountPaid: 15800,
        country: "PL",
        quantity: 2,
      }),
      course: c,
    };
  }
  function refund(
    name: string,
    kind: "individual" | "team",
    approved: boolean
  ) {
    const sale = kind === "individual" ? buy(name) : licence(name);
    const request = refunds.raiseRefundRequest(
      db,
      sale.purchase.id,
      person(name).id,
      "Synthetic private refund reason",
      new Date()
    );
    assert.ok(request.ok);
    const result = approved
      ? refunds.approveRefundRequest(
          db,
          request.refundRequestId,
          person("P").id,
          "Synthetic private approval note",
          new Date()
        )
      : refunds.declineRefundRequest(
          db,
          request.refundRequestId,
          person("Q").id,
          "Synthetic private decline note",
          new Date()
        );
    assert.ok(result.ok);
    return { sale, request };
  }
  function discussion() {
    const c = course();
    const question = createDiscussionComment(db, {
      userId: person("A").id,
      lessonId: c.lessonId,
      parentId: null,
      body: "Synthetic concise Discussion Question",
    });
    createDiscussionComment(db, {
      userId: person("B").id,
      lessonId: c.lessonId,
      parentId: question.id,
      body: "Synthetic concise Discussion Reply",
    });
    return { c, question };
  }
  function batch() {
    refund("A", "individual", true);
    refund("A", "individual", false);
    refund("T", "team", true);
    refund("T", "team", false);
    const team = licence("T");
    assert.ok(redeemSeat(db, team.seats[0].code, person("B").id, "PL").ok);
    discussion();
  }
  try {
    // Fresh people are identified without any preference write or first-sync initializer.
    for (const p of Object.values(people)) await adapter.identify(p);
    const first = buy("A");
    await finish("fresh-enrollment-default-off", {
      "cadence-enrollment": [person("I").id],
    });
    const freshPreferences = await client.users.getPreferences(
      String(person("I").id),
      "default"
    );
    phases.push({
      label: "fresh-preferences-before-any-recipient-save",
      preferences: freshPreferences,
    });
    // Preserve an unrelated native preference through later Settings saves/profile sync.
    for (const p of Object.values(people)) {
      const baseline = await client.users.setPreferences(
        String(p.id),
        "default",
        { channel_types: { sms: false }, __persistence_strategy__: "merge" }
      );
      assert.equal(baseline.channel_types?.sms, false);
    }
    await save("I", true, true);
    enrollmentOn = true;
    buy("B", first.course);
    await finish("explicit-enrollment-opt-in", {
      "cadence-enrollment": [person("I").id],
    });
    batch();
    await finish("all-seven-default-on-and-both-purchase-kinds", {
      "cadence-refund-approved": [person("A").id, person("T").id],
      "cadence-refund-declined": [person("A").id, person("T").id],
      "cadence-refund-opened": Array(4)
        .fill([person("P").id, person("Q").id])
        .flat(),
      "cadence-seat-claimed": [person("T").id],
      "cadence-enrollment": Array(3).fill(person("I").id),
      "cadence-discussion-question": [person("I").id],
      "cadence-discussion-reply": [person("A").id],
    });
    // Real approval lapses A; a new purchase creates a distinct Enrollment.
    const lapsed = buy("A");
    const raised = refunds.raiseRefundRequest(
      db,
      lapsed.purchase.id,
      person("A").id,
      "Synthetic lapse",
      new Date()
    );
    assert.ok(raised.ok);
    assert.ok(
      refunds.approveRefundRequest(
        db,
        raised.refundRequestId,
        person("P").id,
        null,
        new Date()
      ).ok
    );
    buy("A", lapsed.course);
    const own = course();
    buy("I", own);
    const selfQuestion = createDiscussionComment(db, {
      userId: person("I").id,
      lessonId: own.lessonId,
      parentId: null,
      body: "Instructor own top level comment",
    });
    createDiscussionComment(db, {
      userId: person("B").id,
      lessonId: own.lessonId,
      parentId: selfQuestion.id,
      body: "Reply to Instructor top level comment",
    });
    const { c, question } = discussion();
    createDiscussionComment(db, {
      userId: person("A").id,
      lessonId: c.lessonId,
      parentId: question.id,
      body: "Question author self reply",
    });
    createDiscussionComment(db, {
      userId: person("I").id,
      lessonId: c.lessonId,
      parentId: question.id,
      body: "Instructor reply via shared action domain",
    });
    createDiscussionComment(db, {
      userId: person("P").id,
      lessonId: c.lessonId,
      parentId: null,
      body: "Platform Admin Discussion Question",
    });
    const selfAdmin = buy("P");
    const selfRaised = refunds.raiseRefundRequest(
      db,
      selfAdmin.purchase.id,
      person("P").id,
      "Platform Admin buyer",
      new Date()
    );
    assert.ok(selfRaised.ok);
    assert.ok(
      refunds.approveRefundRequest(
        db,
        selfRaised.refundRequestId,
        person("P").id,
        null,
        new Date()
      ).ok
    );
    await finish("reenrollment-and-actor-exclusions", {
      "cadence-enrollment": Array(3).fill(person("I").id),
      "cadence-refund-opened": [person("P").id, person("Q").id, person("Q").id],
      "cadence-refund-approved": [person("A").id],
      "cadence-discussion-question": [person("I").id, person("I").id],
      "cadence-discussion-reply": [person("A").id, person("A").id],
    });
    for (const name of Object.keys(people)) await save(name, false, false);
    workflows.forEach((workflow) => disabled.add(workflow));
    batch();
    await finish("receive-off-all-seven-including-mutable-refunds");
    for (const name of Object.keys(people)) await save(name, true, false);
    disabled.clear();
    batch();
    await finish("receive-on-email-off-feed-retained");
    // Overlap: Instructor owns a Team Licence and retains both capabilities.
    const overlap = licence("I");
    assert.ok(redeemSeat(db, overlap.seats[0].code, person("B").id, "PL").ok);
    await finish("overlapping-instructor-team-admin-distinct-events", {
      "cadence-seat-claimed": [person("I").id],
      "cadence-enrollment": [person("I").id],
    });
    for (const p of Object.values(people)) {
      await adapter.identify({ ...p, name: `${p.name} refreshed` });
      const after = await client.users.getPreferences(String(p.id), "default");
      assert.equal(after.channel_types?.sms, false);
      assert.ok(
        preferences
          .preferenceChoices(after as unknown as PreferenceSet)
          .every((choice) => choice.receive && !choice.email)
      );
      phases.push({
        label: `profile-refresh-preserved-preferences-${p.id}`,
        preferences: after,
      });
    }
    assert.equal(
      sandboxAssertions,
      submissions.getNotificationSubmissions(db).length
    );
    phases.push({
      label: "complete",
      noActualEmailDelivery: true,
      sandboxModeAlwaysTrue: true,
    });
    snapshot();
    await auditEvidence(client, resolve(directory, "evidence.json"));
    console.log(`Sanitized evidence: ${directory}`);
  } finally {
    snapshot();
    db.$client.close();
  }
}

async function auditEvidence(client: KnockClient, evidencePath: string) {
  const { z } = await import("zod");
  const evidence = z
    .object({
      run: z.number(),
      people: z.record(z.number()),
      accepted: z.array(
        z.object({
          label: z.string(),
          submissions: z.array(
            z.object({
              workflowRunId: z.string(),
              recipientId: z.number(),
              workflow: z.string(),
            })
          ),
        })
      ),
    })
    .parse(JSON.parse(readFileSync(evidencePath, "utf8")));
  const details = [];
  for (const id of Object.values(evidence.people)) {
    for await (const run of client.workflowRecipientRuns.list({
      recipient: String(id),
      starting_at: new Date(evidence.run - 60_000).toISOString(),
    })) {
      const phase = evidence.accepted.find((phase) =>
        phase.submissions.some(
          (submission) => submission.workflowRunId === run.workflow_run_id
        )
      );
      if (!phase) continue;
      const detail = await client.workflowRecipientRuns.get(run.id);
      const messages = [];
      for await (const message of client.messages.list({
        workflow_run_id: run.workflow_run_id,
      })) {
        const events = [];
        for await (const event of client.messages.listEvents(message.id))
          events.push({
            id: event.id,
            type: event.type,
            data: event.data,
            inserted_at: event.inserted_at,
          });
        const logs = [];
        for await (const log of client.messages.listDeliveryLogs(message.id))
          logs.push({
            id: log.id,
            service_name: log.service_name,
            responseStatus: log.response.status,
            inserted_at: log.inserted_at,
          });
        messages.push({
          id: message.id,
          channel: message.channel,
          status: message.status,
          events,
          deliveryLogs: logs,
        });
      }
      details.push({
        phase: phase.label,
        id: run.id,
        workflowRunId: run.workflow_run_id,
        workflow: run.workflow,
        recipient: run.recipient,
        status: detail.status,
        errorCount: detail.error_count,
        events: detail.events.map(
          ({ id, event, status, data, step_ref, step_type }) => ({
            id,
            event,
            status,
            data,
            step_ref,
            step_type,
          })
        ),
        messages,
      });
    }
  }
  const output = resolve(evidencePath, "../workflow-outcomes.json");
  writeFileSync(
    output,
    JSON.stringify({ run: evidence.run, details }, null, 2)
  );
  assert.equal(
    details.length,
    evidence.accepted.reduce(
      (count, phase) => count + phase.submissions.length,
      0
    ),
    "Every accepted submission needs a hosted recipient run"
  );
  assert.ok(
    details.every((run) => run.status === "completed" && !run.errorCount),
    "Hosted runs must complete without errors; inspect workflow-outcomes.json"
  );
  const emailWorkflows = [
    "cadence-refund-approved",
    "cadence-refund-declined",
    "cadence-refund-opened",
    "cadence-discussion-question",
    "cadence-discussion-reply",
  ];
  for (const run of details) {
    const suppressed =
      run.phase === "fresh-enrollment-default-off" ||
      run.phase === "receive-off-all-seven-including-mutable-refunds";
    const emailOff = run.phase === "receive-on-email-off-feed-retained";
    const feedMessages = run.messages.filter(
      (message) => message.channel?.type === "in_app_feed"
    );
    const emailMessages = run.messages.filter(
      (message) => message.channel?.type === "email"
    );
    assert.equal(
      feedMessages.length,
      suppressed ? 0 : 1,
      `${run.phase}/${run.workflow}: Feed delivery count`
    );
    if (suppressed)
      assert.ok(
        run.events.some(
          (event) =>
            event.event === "preference_set_evaluated" &&
            event.step_ref === "feed" &&
            event.data?.opted_out === true
        )
      );
    if (emailWorkflows.includes(run.workflow)) {
      assert.equal(
        emailMessages.length,
        suppressed || emailOff ? 0 : 1,
        `${run.phase}/${run.workflow}: email message count`
      );
      if (suppressed || emailOff)
        assert.ok(
          run.events.some(
            (event) =>
              event.event === "preference_set_evaluated" &&
              event.step_ref === "email" &&
              event.data?.opted_out === true
          )
        );
    } else assert.equal(emailMessages.length, 0);
    for (const message of feedMessages)
      assert.equal(message.status, "delivered");
    for (const message of emailMessages) {
      assert.equal(message.status, "not_sent");
      assert.ok(
        message.events.some((event) => event.type === "message.not_sent")
      );
      assert.equal(message.deliveryLogs.length, 0);
    }
  }
  console.log(
    `Hosted recipient run completion and message statuses: ${details.length} recorded`
  );
}
