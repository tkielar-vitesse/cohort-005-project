import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  enqueueNotification,
  getNotificationSubmissions,
  processNextNotification,
} from "./notification-submissions.server";
import { eq } from "drizzle-orm";
import { users } from "~/db/schema";
import { NotificationAdapterError } from "./knock.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let now: number;
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  now = 1_000_000;
  enqueueNotification(db, {
    eventKey: "question:1",
    recipientId: base.instructor.id,
    actorId: base.user.id,
    workflow: "cadence-discussion-question",
    data: { body: "Original" },
  });
});

it("refreshes the current profile and retries ambiguous failures with identical trigger parameters and increasing delays", async () => {
  const adapter = {
    identify: vi.fn(async () => {}),
    trigger: vi
      .fn()
      .mockRejectedValue(new NotificationAdapterError("timeout", true)),
  };
  await processNextNotification(db, adapter, { now: () => now });
  const first = getNotificationSubmissions(db)[0];
  db.update(users)
    .set({ name: "Updated Instructor", email: "updated@example.com" })
    .where(eq(users.id, base.instructor.id))
    .run();
  now = first.nextAttemptAt;
  await processNextNotification(db, adapter, { now: () => now });
  const second = getNotificationSubmissions(db)[0];
  expect(adapter.identify.mock.calls.at(-1)).toEqual([
    {
      id: base.instructor.id,
      name: "Updated Instructor",
      email: "updated@example.com",
    },
  ]);
  expect(adapter.trigger.mock.calls[1]).toEqual(adapter.trigger.mock.calls[0]);
  expect(second.nextAttemptAt - now).toBeGreaterThan(
    first.nextAttemptAt - first.firstAttemptAt!
  );
});

it("identifies the committed recipient before submitting and ends responsibility at acceptance", async () => {
  const calls: string[] = [];
  const adapter = {
    identify: vi.fn(async () => {
      calls.push("identify");
    }),
    trigger: vi.fn(async () => {
      calls.push("trigger");
      return { workflow_run_id: "run-accepted" };
    }),
  };
  expect(await processNextNotification(db, adapter, { now: () => now })).toBe(
    true
  );
  expect(calls).toEqual(["identify", "trigger"]);
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "accepted",
    workflowRunId: "run-accepted",
    attempts: 1,
  });
  expect(await processNextNotification(db, adapter, { now: () => now })).toBe(
    false
  );
  expect(adapter.trigger).toHaveBeenCalledTimes(1);
});

it("shares identification and trigger's retry budget and rejects at exactly 23 hours", async () => {
  const adapter = {
    identify: vi
      .fn()
      .mockRejectedValue(
        new NotificationAdapterError("identify unavailable", true)
      ),
    trigger: vi.fn(async () => ({ workflow_run_id: "unexpected" })),
  };
  const logError = vi.fn();
  await processNextNotification(db, adapter, { now: () => now, logError });
  const first = getNotificationSubmissions(db)[0];
  expect(first.firstAttemptAt).toBe(1_000_000);
  expect(adapter.trigger).not.toHaveBeenCalled();
  now += 82_800_000 - 1;
  await processNextNotification(db, adapter, { now: () => now, logError });
  expect(getNotificationSubmissions(db)[0].state).toBe("pending");
  now += 1;
  await processNextNotification(db, adapter, { now: () => now, logError });
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "rejected",
    finishedAt: 83_800_000,
  });
  expect(adapter.identify).toHaveBeenCalledTimes(2);
  expect(logError).toHaveBeenCalledTimes(1);
  now += 100_000;
  await processNextNotification(db, adapter, { now: () => now, logError });
  expect(logError).toHaveBeenCalledTimes(1);
});

it("does not expire an old event before its first attempt", async () => {
  now += 100 * 86_400_000;
  const adapter = {
    identify: vi.fn(async () => {}),
    trigger: vi.fn(async () => ({ workflow_run_id: "old-event-accepted" })),
  };
  await processNextNotification(db, adapter, { now: () => now });
  expect(getNotificationSubmissions(db)[0].state).toBe("accepted");
});

it("does not trigger when identification crosses the exact cutoff", async () => {
  const adapter = {
    identify: vi.fn(async () => {
      now += 82_800_000;
    }),
    trigger: vi.fn(async () => ({ workflow_run_id: "unexpected" })),
  };
  const logError = vi.fn();
  await processNextNotification(db, adapter, { now: () => now, logError });
  expect(adapter.trigger).not.toHaveBeenCalled();
  expect(getNotificationSubmissions(db)[0].state).toBe("rejected");
  expect(logError).toHaveBeenCalledTimes(1);
});

it("does not claim the same obligation concurrently and recovers a lost worker after its lease expires", async () => {
  let release!: () => void;
  const first = {
    identify: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    ),
    trigger: vi.fn(async () => ({ workflow_run_id: "stale-run" })),
  };
  const restarted = {
    identify: vi.fn(async () => {}),
    trigger: vi.fn(async () => ({ workflow_run_id: "recovered-run" })),
  };
  const running = processNextNotification(db, first, { now: () => now });
  await vi.waitFor(() => expect(first.identify).toHaveBeenCalledOnce());
  expect(await processNextNotification(db, restarted, { now: () => now })).toBe(
    false
  );
  now += 60_000;
  expect(await processNextNotification(db, restarted, { now: () => now })).toBe(
    true
  );
  release();
  await running;
  expect(first.trigger).not.toHaveBeenCalled();
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "accepted",
    workflowRunId: "recovered-run",
    attempts: 2,
    firstAttemptAt: 1_000_000,
  });
});

it("retains and logs invalid requests immediately without retrying", async () => {
  const adapter = {
    identify: vi.fn(async () => {}),
    trigger: vi
      .fn()
      .mockRejectedValue(
        new NotificationAdapterError("invalid workflow", false)
      ),
  };
  const logError = vi.fn();
  await processNextNotification(db, adapter, { now: () => now, logError });
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "rejected",
    attempts: 1,
  });
  expect(logError).toHaveBeenCalledOnce();
  now += 100_000_000;
  expect(
    await processNextNotification(db, adapter, { now: () => now, logError })
  ).toBe(false);
  expect(adapter.trigger).toHaveBeenCalledOnce();
});

it("recovers an ambiguous hanging trigger with the same request and ignores its late result", async () => {
  vi.useFakeTimers();
  let release!: (value: { workflow_run_id: string }) => void;
  const adapter = {
    identify: vi.fn(async () => {}),
    trigger: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue({ workflow_run_id: "retry-run" }),
  };
  const running = processNextNotification(db, adapter, { now: () => now });
  await vi.advanceTimersByTimeAsync(30_000);
  await running;
  expect(getNotificationSubmissions(db)[0].state).toBe("pending");
  now = getNotificationSubmissions(db)[0].nextAttemptAt;
  await processNextNotification(db, adapter, { now: () => now });
  release({ workflow_run_id: "late-run" });
  await Promise.resolve();
  expect(adapter.trigger.mock.calls[1]).toEqual(adapter.trigger.mock.calls[0]);
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "accepted",
    workflowRunId: "retry-run",
  });
});
