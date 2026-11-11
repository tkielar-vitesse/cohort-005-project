import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { purchaseCourse, purchaseTeamLicence } from "./purchases.server";
import {
  getNotificationSubmissions,
  processNextNotification,
} from "./notification-submissions.server";
import {
  enrollments,
  purchases,
  courses,
  users,
  modules,
  lessons,
  lessonProgress,
  LessonProgressStatus,
} from "~/db/schema";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

it("commits an Individual Purchase, Enrollment and Instructor submission together", () => {
  const result = purchaseCourse(db, {
    studentId: base.user.id,
    courseId: base.course.id,
    amountPaid: 7900,
    country: "PL",
  });
  expect(result.created).toBe(true);
  expect(db.select().from(purchases).all()).toMatchObject([
    {
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      country: "PL",
    },
  ]);
  expect(db.select().from(enrollments).all()).toMatchObject([
    { userId: base.user.id, courseId: base.course.id },
  ]);
  expect(getNotificationSubmissions(db)).toMatchObject([
    {
      workflow: "cadence-enrollment",
      recipientId: base.instructor.id,
      actorId: base.user.id,
      data: {
        title: "New Enrollment",
        body: "Test User enrolled on Test Course.",
        url: "/courses/test-course",
      },
    },
  ]);
});

it("a Team Licence creates Seats without enrolling its buyer or notifying the Instructor", () => {
  const result = purchaseTeamLicence(db, {
    studentId: base.user.id,
    courseId: base.course.id,
    amountPaid: 15800,
    country: "PL",
    quantity: 2,
  });
  expect(result.purchase.amountPaid).toBe(15800);
  expect(result.seats).toHaveLength(2);
  expect(
    result.seats.every((seat) => seat.purchaseId === result.purchase.id)
  ).toBe(true);
  expect(db.select().from(enrollments).all()).toEqual([]);
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("rolls back the Individual Purchase and Enrollment when the intent cannot be persisted", () => {
  db.run(
    sql`CREATE TRIGGER reject_enrollment_intent BEFORE INSERT ON notification_submissions BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END`
  );
  expect(() =>
    purchaseCourse(db, {
      studentId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      country: null,
    })
  ).toThrow();
  expect(db.select().from(purchases).all()).toEqual([]);
  expect(db.select().from(enrollments).all()).toEqual([]);
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("repeated purchases while already enrolled create no extra Purchase, Enrollment or event", () => {
  const input = {
    studentId: base.user.id,
    courseId: base.course.id,
    amountPaid: 7900,
    country: null,
  };
  purchaseCourse(db, input);
  expect(purchaseCourse(db, input)).toEqual({ created: false });
  expect(db.select().from(purchases).all()).toHaveLength(1);
  expect(db.select().from(enrollments).all()).toHaveLength(1);
  expect(getNotificationSubmissions(db)).toHaveLength(1);
});

it("creates a distinct event when a Lapsed Student enrolls again and preserves retained progress", () => {
  const input = {
    studentId: base.user.id,
    courseId: base.course.id,
    amountPaid: 7900,
    country: null,
  };
  purchaseCourse(db, input);
  const module = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "Module", position: 0 })
    .returning()
    .get();
  const lesson = db
    .insert(lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 0 })
    .returning()
    .get();
  const progress = db
    .insert(lessonProgress)
    .values({
      userId: base.user.id,
      lessonId: lesson.id,
      status: LessonProgressStatus.Completed,
    })
    .returning()
    .get();
  const first = getNotificationSubmissions(db)[0];
  db.delete(enrollments).run();
  purchaseCourse(db, input);
  const submissions = getNotificationSubmissions(db);
  expect(submissions).toHaveLength(2);
  expect(submissions[1].eventKey).not.toBe(first.eventKey);
  expect(submissions[1].idempotencyKey).not.toBe(first.idempotencyKey);
  expect(db.select().from(enrollments).all()).toHaveLength(1);
  expect(db.select().from(lessonProgress).all()).toEqual([progress]);
});

it("never notifies the Instructor about their own Enrollment", () => {
  purchaseCourse(db, {
    studentId: base.instructor.id,
    courseId: base.course.id,
    amountPaid: 7900,
    country: null,
  });
  expect(db.select().from(enrollments).all()).toHaveLength(1);
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("submits the committed Instructor and event snapshot after source changes despite a vendor outage", async () => {
  purchaseCourse(db, {
    studentId: base.user.id,
    courseId: base.course.id,
    amountPaid: 7900,
    country: null,
  });
  const original = getNotificationSubmissions(db)[0];
  db.update(courses)
    .set({ title: "Changed", slug: "changed", instructorId: base.user.id })
    .where(eq(courses.id, base.course.id))
    .run();
  db.update(users)
    .set({ name: "Changed Student" })
    .where(eq(users.id, base.user.id))
    .run();
  const trigger = vi.fn().mockRejectedValue(new Error("offline"));
  await processNextNotification(db, { identify: async () => {}, trigger });
  expect(trigger.mock.calls[0][0]).toMatchObject({
    workflow: "cadence-enrollment",
    recipientId: String(base.instructor.id),
    actorId: String(base.user.id),
    data: original.data,
    idempotencyKey: original.idempotencyKey,
  });
  expect(getNotificationSubmissions(db)[0]).toMatchObject({
    state: "pending",
    data: original.data,
  });
  expect(db.select().from(purchases).all()).toHaveLength(1);
  expect(db.select().from(enrollments).all()).toHaveLength(1);
});
