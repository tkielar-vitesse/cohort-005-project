import { randomUUID } from "node:crypto";
import { and, eq, lte, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";

export type NotificationDb = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<NotificationDb["transaction"]>[0]>[0];
type Queryable = NotificationDb | Tx;
export type NotificationIntent = {
  eventKey: string;
  recipientId: number;
  actorId: number;
  workflow: string;
  data: Record<string, unknown>;
};

/** Call inside the domain transaction. Repeated event/recipient pairs retain
 * the original payload and key. No network work is performed here. */
export function enqueueNotification(db: Queryable, intent: NotificationIntent) {
  if (intent.recipientId === intent.actorId) return;
  db.insert(schema.notificationSubmissions)
    .values({
      eventKey: intent.eventKey,
      recipientId: intent.recipientId,
      actorId: intent.actorId,
      workflow: intent.workflow,
      data: intent.data,
      idempotencyKey: randomUUID(),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({
      target: [
        schema.notificationSubmissions.eventKey,
        schema.notificationSubmissions.recipientId,
      ],
    })
    .run();
}

export function getNotificationSubmissions(db: Queryable) {
  return db
    .select()
    .from(schema.notificationSubmissions)
    .orderBy(schema.notificationSubmissions.id)
    .all();
}

export type SubmissionAdapter = {
  identify(person: {
    id: number | string;
    name: string;
    email: string;
  }): PromiseLike<unknown>;
  trigger(input: {
    workflow: string;
    recipientId: string;
    actorId: string;
    data: Record<string, unknown>;
    idempotencyKey: string;
  }): PromiseLike<{ workflow_run_id: string }>;
};
export const SUBMISSION_BUDGET_MS = 23 * 60 * 60 * 1000;
export const SUBMISSION_LEASE_MS = 60_000;

/** Claims and processes one due obligation. Safe to run concurrently. The claim
 * commits before any adapter work, and an expired claim is recoverable. */
export async function processNextNotification(
  db: NotificationDb,
  adapter: SubmissionAdapter,
  options: {
    now?: () => number;
    logError?: (details: { submissionId: number; reason: string }) => void;
  } = {}
) {
  const now = options.now ?? Date.now;
  const logError =
    options.logError ??
    ((details) => console.error("Notification submission rejected", details));
  const table = schema.notificationSubmissions;
  const expire = () => {
    const rows = db
      .update(table)
      .set({
        state: "rejected",
        finishedAt: now(),
        lastError: "23-hour submission budget exhausted",
        claimToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          or(eq(table.state, "pending"), eq(table.state, "processing")),
          lte(table.firstAttemptAt, now() - SUBMISSION_BUDGET_MS)
        )
      )
      .returning({ id: table.id })
      .all();
    for (const row of rows)
      logError({
        submissionId: row.id,
        reason: "23-hour submission budget exhausted",
      });
    return rows.length;
  };
  const expired = expire();
  const token = randomUUID();
  const claimed = db.transaction(
    (tx) => {
      const due = tx
        .select()
        .from(table)
        .where(
          or(
            and(eq(table.state, "pending"), lte(table.nextAttemptAt, now())),
            and(eq(table.state, "processing"), lte(table.leaseUntil, now()))
          )
        )
        .orderBy(table.id)
        .limit(1)
        .get();
      if (!due) return;
      return tx
        .update(table)
        .set({
          state: "processing",
          claimToken: token,
          leaseUntil: now() + SUBMISSION_LEASE_MS,
          firstAttemptAt: due.firstAttemptAt ?? now(),
          attempts: due.attempts + 1,
        })
        .where(eq(table.id, due.id))
        .returning()
        .get();
    },
    { behavior: "immediate" }
  );
  if (!claimed) return expired > 0;
  const firstAttemptAt = claimed.firstAttemptAt;
  if (firstAttemptAt === null)
    throw new Error("Claim has no processing start time");
  const deadline = firstAttemptAt + SUBMISSION_BUDGET_MS;
  const owned = and(
    eq(table.id, claimed.id),
    eq(table.claimToken, token),
    eq(table.state, "processing")
  );
  const stillOwned = () => {
    expire();
    return !!db.select({ id: table.id }).from(table).where(owned).get();
  };
  const heartbeat = setInterval(() => {
    if (stillOwned())
      db.update(table)
        .set({ leaseUntil: now() + SUBMISSION_LEASE_MS })
        .where(owned)
        .run();
  }, SUBMISSION_LEASE_MS / 3);
  heartbeat.unref();
  // Bound hangs and ambiguous timeouts; a late vendor response cannot mutate a
  // reclaimed record. Stable keys are still required for possible acceptance.
  async function attempt<T>(operation: () => PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Notification attempt timed out")),
            Math.max(0, Math.min(30_000, deadline - now()))
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const recipient = db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, claimed.recipientId))
    .get();
  try {
    if (!stillOwned()) return true;
    if (!recipient)
      throw Object.assign(new Error("Recipient profile unavailable"), {
        retryable: false,
      });
    await attempt(() => adapter.identify(recipient));
    if (!stillOwned()) return true;
    const result = await attempt(() =>
      adapter.trigger({
        workflow: claimed.workflow,
        recipientId: String(claimed.recipientId),
        actorId: String(claimed.actorId),
        data: claimed.data,
        idempotencyKey: claimed.idempotencyKey,
      })
    );
    if (!stillOwned()) return true;
    db.update(table)
      .set({
        state: "accepted",
        workflowRunId: result.workflow_run_id,
        finishedAt: now(),
        claimToken: null,
        leaseUntil: null,
        lastError: null,
      })
      .where(owned)
      .run();
  } catch (error) {
    if (!stillOwned()) return true;
    const retryable = !(
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      error.retryable === false
    );
    const reason = retryable
      ? "Notification service temporarily unavailable"
      : "Invalid Notification submission";
    const delay = Math.min(
      60 * 60 * 1000,
      1000 * 2 ** Math.min(claimed.attempts - 1, 12)
    );
    db.update(table)
      .set({
        state: retryable ? "pending" : "rejected",
        nextAttemptAt: Math.min(now() + delay, deadline),
        lastError: reason,
        finishedAt: retryable ? null : now(),
        claimToken: null,
        leaseUntil: null,
      })
      .where(owned)
      .run();
    if (!retryable) logError({ submissionId: claimed.id, reason });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
