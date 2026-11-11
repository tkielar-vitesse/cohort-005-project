import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { comments, lessons, modules, users, UserRole } from "~/db/schema";
import { eq, sql } from "drizzle-orm";
import { createDiscussionComment } from "./discussions.server";
import {
  enqueueNotification,
  getNotificationSubmissions,
  processNextNotification,
} from "./notification-submissions.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(lessons)
    .values({ moduleId: module.id, title: "Transactions", position: 1 })
    .returning()
    .get().id;
});

it("keeps a committed Discussion Question successful during a later vendor outage", async () => {
  const adapter = {
    identify: vi.fn(async () => {
      expect(db.$client.inTransaction).toBe(false);
      throw new Error("Knock is unavailable");
    }),
    trigger: vi.fn(async () => ({ workflow_run_id: "unexpected" })),
  };
  const comment = createDiscussionComment(db, {
    userId: base.user.id,
    lessonId,
    parentId: null,
    body: "Question during an outage",
  });
  expect(adapter.identify).not.toHaveBeenCalled();
  await processNextNotification(db, adapter);
  expect(
    db.select().from(comments).where(eq(comments.id, comment.id)).get()?.body
  ).toBe("Question during an outage");
  expect(getNotificationSubmissions(db)[0].state).toBe("pending");
  expect(adapter.trigger).not.toHaveBeenCalled();
});

it("does not manufacture an event for the Instructor's own top-level comment", () => {
  createDiscussionComment(db, {
    userId: base.instructor.id,
    lessonId,
    parentId: null,
    body: "Welcome",
  });
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("includes Platform Admin questions and snapshots the committed details", () => {
  db.update(users)
    .set({ role: UserRole.Admin })
    .where(eq(users.id, base.user.id))
    .run();
  const comment = createDiscussionComment(db, {
    userId: base.user.id,
    lessonId,
    parentId: null,
    body: "Original question",
  });
  db.update(comments)
    .set({ body: "Changed", deletedAt: new Date().toISOString() })
    .where(eq(comments.id, comment.id))
    .run();
  db.update(users)
    .set({ name: "Changed name" })
    .where(eq(users.id, base.user.id))
    .run();
  expect(getNotificationSubmissions(db)[0].data.body).toContain("Test User");
  expect(getNotificationSubmissions(db)[0].data.body).toContain(
    "Original question"
  );
});

it("rolls back the comment when persisting its submission fails", () => {
  db.run(
    sql`CREATE TRIGGER reject_intent BEFORE INSERT ON notification_submissions BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END`
  );
  expect(() =>
    createDiscussionComment(db, {
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "Atomic question",
    })
  ).toThrow();
  expect(db.select().from(comments).all()).toEqual([]);
});

it("retains the original event and idempotency key when an event is repeated", () => {
  const comment = createDiscussionComment(db, {
    userId: base.user.id,
    lessonId,
    parentId: null,
    body: "One question",
  });
  const original = getNotificationSubmissions(db)[0];
  enqueueNotification(db, {
    ...original,
    data: { body: "Must not replace the snapshot" },
  });
  expect(getNotificationSubmissions(db)).toEqual([original]);
  expect(original.eventKey).toBe(`discussion-question:${comment.id}`);
});

it("commits a Discussion Question with an immutable Instructor submission", () => {
  const comment = createDiscussionComment(
    db,
    {
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How does this work?",
    },
    { appOrigin: "https://cadence.example" }
  );
  expect(comment.body).toBe("How does this work?");
  expect(getNotificationSubmissions(db)).toEqual([
    expect.objectContaining({
      recipientId: base.instructor.id,
      actorId: base.user.id,
      workflow: "cadence-discussion-question",
      data: expect.objectContaining({
        body: expect.stringContaining("How does this work?"),
        url: `/courses/test-course/lessons/${lessonId}`,
        action_url: `https://cadence.example/courses/test-course/lessons/${lessonId}`,
        settings_url: "https://cadence.example/settings",
      }),
    }),
  ]);
});
