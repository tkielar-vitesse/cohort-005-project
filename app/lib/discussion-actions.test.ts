import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { comments, courses, lessons, modules } from "~/db/schema";
import { setCurrentUserId } from "./session";
import { getNotificationSubmissions } from "./notification-submissions.server";
import { action as lessonAction } from "~/routes/courses.$slug.lessons.$lessonId";
import { action as instructorAction } from "~/routes/instructor.questions";
import { sql } from "drizzle-orm";

// Replace only the database connection: actions, authentication, access checks,
// transactions and submission persistence all run normally against migrated SQLite.
vi.mock("~/db", () => ({
  get db() {
    return db;
  },
}));
let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let questionId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(modules)
    .values({
      courseId: base.course.id,
      title: "Basics",
      position: 1,
    })
    .returning()
    .get();
  lessonId = db
    .insert(lessons)
    .values({
      moduleId: module.id,
      title: "Transactions",
      position: 1,
    })
    .returning()
    .get().id;
  questionId = db
    .insert(comments)
    .values({
      userId: base.user.id,
      lessonId,
      body: "A Discussion Question",
    })
    .returning()
    .get().id;
});

it.each([
  ["lesson", false],
  ["Instructor", false],
  ["lesson", true],
  ["Instructor", true],
] as const)(
  "%s action atomically persists a Discussion Reply (submission failure: %s)",
  async (entryPoint, submissionFails) => {
    if (submissionFails)
      db.run(
        sql`CREATE TRIGGER reject_reply_intent BEFORE INSERT ON notification_submissions BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END`
      );
    const cookie = await setCurrentUserId(
      new Request("http://localhost"),
      base.instructor.id
    );
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { Cookie: cookie },
      body: new URLSearchParams(
        entryPoint === "lesson"
          ? {
              intent: "create-comment",
              parentId: String(questionId),
              body: "An explanation",
            }
          : {
              intent: "reply",
              commentId: String(questionId),
              body: "An explanation",
            }
      ),
    });
    const args = {
      request,
      params: { slug: base.course.slug, lessonId: String(lessonId) },
      context: {},
      url: new URL(request.url),
      pattern:
        entryPoint === "lesson"
          ? "/courses/:slug/lessons/:lessonId"
          : "/instructor/questions",
    };
    const result =
      entryPoint === "lesson"
        ? await lessonAction(args as Parameters<typeof lessonAction>[0])
        : await instructorAction({ ...args, params: {} } as Parameters<
            typeof instructorAction
          >[0]);
    if (submissionFails) {
      expect(result).toEqual(expect.objectContaining({ ok: false }));
      expect(db.select().from(comments).all()).toHaveLength(1);
      expect(getNotificationSubmissions(db)).toEqual([]);
      return;
    }
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(getNotificationSubmissions(db)).toEqual([
      expect.objectContaining({
        recipientId: base.user.id,
        actorId: base.instructor.id,
        workflow: "cadence-discussion-reply",
        data: expect.objectContaining({
          body: expect.stringContaining("An explanation"),
        }),
      }),
    ]);
  }
);

it("editing and deleting a Discussion Reply creates no Notification", async () => {
  const reply = db
    .insert(comments)
    .values({
      userId: base.instructor.id,
      lessonId,
      parentId: questionId,
      body: "Original",
    })
    .returning()
    .get();
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    base.instructor.id
  );
  for (const intent of ["edit-comment", "delete-comment"]) {
    const result = await lessonAction({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { Cookie: cookie },
        body: new URLSearchParams({
          intent,
          commentId: String(reply.id),
          body: "Edited",
        }),
      }),
      params: { slug: base.course.slug, lessonId: String(lessonId) },
      context: {},
    } as Parameters<typeof lessonAction>[0]);
    expect(result).toEqual({ ok: true });
  }
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("rejects a lesson from a different course before creating a Discussion Reply", async () => {
  const otherCourse = db
    .insert(courses)
    .values({
      ...base.course,
      id: undefined,
      slug: "other-course",
      instructorId: base.user.id,
    })
    .returning()
    .get();
  const otherModule = db
    .insert(modules)
    .values({
      courseId: otherCourse.id,
      title: "Private",
      position: 1,
    })
    .returning()
    .get();
  const otherLesson = db
    .insert(lessons)
    .values({
      moduleId: otherModule.id,
      title: "Private lesson",
      position: 1,
    })
    .returning()
    .get();
  const otherQuestion = db
    .insert(comments)
    .values({
      userId: base.instructor.id,
      lessonId: otherLesson.id,
      body: "Private question",
    })
    .returning()
    .get();
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    base.instructor.id
  );
  await expect(
    lessonAction({
      request: new Request("http://localhost", {
        method: "POST",
        headers: { Cookie: cookie },
        body: new URLSearchParams({
          intent: "create-comment",
          parentId: String(otherQuestion.id),
          body: "Unauthorized reply",
        }),
      }),
      params: { slug: base.course.slug, lessonId: String(otherLesson.id) },
      context: {},
    } as Parameters<typeof lessonAction>[0])
  ).rejects.toMatchObject({ init: { status: 404 } });
  expect(db.select().from(comments).all()).toHaveLength(2);
  expect(getNotificationSubmissions(db)).toEqual([]);
});
