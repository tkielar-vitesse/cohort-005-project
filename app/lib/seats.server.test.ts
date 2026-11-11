import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { redeemSeat } from "./seats.server";
import { purchaseTeamLicence } from "./purchases.server";
import {
  getNotificationSubmissions,
  processNextNotification,
} from "./notification-submissions.server";
import {
  coupons,
  enrollments,
  users,
  courses,
  refunds,
  RefundStatus,
  teamMembers,
  TeamMemberRole,
  modules,
  lessons,
  lessonProgress,
  LessonProgressStatus,
  UserRole,
} from "~/db/schema";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function licence(ownerId = base.instructor.id) {
  return purchaseTeamLicence(db, {
    studentId: ownerId,
    courseId: base.course.id,
    amountPaid: 15800,
    country: "PL",
    quantity: 2,
  });
}

it("commits a Seat claim and Enrollment with two distinct obligations even for the same recipient", () => {
  const { seats } = licence();
  const result = redeemSeat(db, seats[0].code, base.user.id, "PL");
  expect(result.ok).toBe(true);
  expect(db.select().from(enrollments).all()).toMatchObject([
    { userId: base.user.id, courseId: base.course.id },
  ]);
  expect(
    db.select().from(coupons).where(eq(coupons.id, seats[0].id)).get()
  ).toMatchObject({
    redeemedByUserId: base.user.id,
    redeemedAt: expect.any(String),
  });
  const submissions = getNotificationSubmissions(db);
  expect(submissions).toHaveLength(2);
  expect(submissions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workflow: "cadence-seat-claimed",
        recipientId: base.instructor.id,
        actorId: base.user.id,
        data: expect.objectContaining({
          student_name: "Test User",
          course_title: "Test Course",
          remaining_seats: 1,
          url: "/team",
        }),
      }),
      expect.objectContaining({
        workflow: "cadence-enrollment",
        recipientId: base.instructor.id,
      }),
    ])
  );
  expect(submissions[0].eventKey).not.toBe(submissions[1].eventKey);
});

it.each(["cadence-enrollment", "cadence-seat-claimed"])(
  "rolls back all mutations when the %s intent fails",
  (workflow) => {
    const { seats } = licence();
    db.run(
      sql.raw(
        `CREATE TRIGGER reject_intent BEFORE INSERT ON notification_submissions WHEN NEW.workflow = '${workflow}' BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END`
      )
    );
    expect(() => redeemSeat(db, seats[0].code, base.user.id, "PL")).toThrow();
    expect(db.select().from(enrollments).all()).toEqual([]);
    expect(db.select().from(coupons).all()).toEqual(seats);
    expect(getNotificationSubmissions(db)).toEqual([]);
  }
);

it("rejects repeated claims and already enrolled Students without extra events or claimed Seats", () => {
  const { seats } = licence();
  redeemSeat(db, seats[0].code, base.user.id, "PL");
  expect(redeemSeat(db, seats[0].code, base.user.id, "PL")).toEqual({
    ok: false,
    error: "Seat has already been claimed",
  });
  expect(redeemSeat(db, seats[1].code, base.user.id, "PL")).toEqual({
    ok: false,
    error: "You are already enrolled in this course",
  });
  expect(getNotificationSubmissions(db)).toHaveLength(2);
  expect(
    db.select().from(coupons).where(eq(coupons.id, seats[1].id)).get()
  ).toEqual(seats[1]);
});

it.each(["owner", "instructor", "both"])(
  "applies %s self-exclusion independently",
  (actor) => {
    const owner = actor === "instructor" ? base.user.id : base.instructor.id;
    const student = actor === "owner" ? base.user.id : base.instructor.id;
    const buyer = actor === "owner" ? base.user.id : owner;
    const { seats } = licence(buyer);
    redeemSeat(db, seats[0].code, student, "PL");
    const workflows = getNotificationSubmissions(db).map(
      (submission) => submission.workflow
    );
    expect(workflows).toEqual(
      actor === "both"
        ? []
        : actor === "owner"
          ? ["cadence-enrollment"]
          : ["cadence-seat-claimed"]
    );
    expect(db.select().from(enrollments).all()).toHaveLength(1);
  }
);

it.each([RefundStatus.Open, RefundStatus.Approved])(
  "rejects a Seat affected by an %s Refund Request",
  (status) => {
    const { seats: seats, purchase } = licence();
    db.insert(refunds)
      .values({ purchaseId: purchase.id, reason: "Refund", status })
      .run();
    if (status === RefundStatus.Approved)
      db.update(coupons).set({ refundedAt: new Date().toISOString() }).run();
    expect(redeemSeat(db, seats[0].code, base.user.id, "PL").ok).toBe(false);
    expect(db.select().from(enrollments).all()).toEqual([]);
    expect(getNotificationSubmissions(db)).toEqual([]);
  }
);

it("rejects a country mismatch and unknown Seat without changing anything", () => {
  const { seats } = licence();
  expect(redeemSeat(db, seats[0].code, base.user.id, "GB").ok).toBe(false);
  expect(redeemSeat(db, "missing", base.user.id, "PL")).toEqual({
    ok: false,
    error: "Seat not found",
  });
  expect(db.select().from(coupons).all()).toEqual(seats);
  expect(db.select().from(enrollments).all()).toEqual([]);
  expect(getNotificationSubmissions(db)).toEqual([]);
});

it("notifies the Purchase owner rather than other Team Admins and snapshots remaining Seats per claim", () => {
  const { seats: seats, team } = licence();
  const other = db
    .insert(users)
    .values({
      name: "Other Admin",
      email: "other@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId: other.id, role: TeamMemberRole.Admin })
    .run();
  redeemSeat(db, seats[0].code, base.user.id, "PL");
  redeemSeat(db, seats[1].code, other.id, "PL");
  const claims = getNotificationSubmissions(db).filter(
    (s) => s.workflow === "cadence-seat-claimed"
  );
  expect(claims.map((s) => s.recipientId)).toEqual([
    base.instructor.id,
    base.instructor.id,
  ]);
  expect(claims.map((s) => s.data.remaining_seats)).toEqual([1, 0]);
  expect(claims[0].eventKey).not.toBe(claims[1].eventKey);
  expect(getNotificationSubmissions(db)).toHaveLength(4);
});

it("creates a fresh Enrollment for a Lapsed Student without losing progress", () => {
  const { seats } = licence();
  redeemSeat(db, seats[0].code, base.user.id, "PL");
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
  db.delete(enrollments).run();
  expect(redeemSeat(db, seats[1].code, base.user.id, "PL").ok).toBe(true);
  const events = getNotificationSubmissions(db).filter(
    (s) => s.workflow === "cadence-enrollment"
  );
  expect(events).toHaveLength(2);
  expect(events[0].eventKey).not.toBe(events[1].eventKey);
  expect(db.select().from(lessonProgress).all()).toEqual([progress]);
});

it("keeps committed snapshots and redemption intact when later submission fails", async () => {
  const { seats } = licence();
  redeemSeat(db, seats[0].code, base.user.id, "PL");
  const original = getNotificationSubmissions(db);
  db.update(courses)
    .set({ title: "Changed", instructorId: base.user.id })
    .run();
  db.update(users)
    .set({ name: "Changed" })
    .where(eq(users.id, base.user.id))
    .run();
  const trigger = vi.fn().mockRejectedValue(new Error("offline"));
  await processNextNotification(db, { identify: async () => {}, trigger });
  await processNextNotification(db, { identify: async () => {}, trigger });
  expect(trigger.mock.calls.map(([input]) => input.data)).toEqual(
    original.map((s) => s.data)
  );
  expect(getNotificationSubmissions(db).map((s) => s.recipientId)).toEqual([
    base.instructor.id,
    base.instructor.id,
  ]);
  expect(db.select().from(enrollments).all()).toHaveLength(1);
  expect(
    db.select().from(coupons).where(eq(coupons.id, seats[0].id)).get()
  ).toMatchObject({ redeemedByUserId: base.user.id });
});
