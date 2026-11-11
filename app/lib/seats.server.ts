import { and, eq, isNull } from "drizzle-orm";
import { coupons, courses, enrollments, purchases, users } from "~/db/schema";
import { createEnrollment } from "./enrollments.server";
import { getSeatAvailability } from "./refunds.server";
import { notificationData } from "./notification-content.server";
import {
  enqueueNotification,
  type NotificationDb,
} from "./notification-submissions.server";

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

/** Claim and acquisition obligations commit together, without vendor I/O. */
export function redeemSeat(
  db: NotificationDb,
  code: string,
  studentId: number,
  country: string
): RedeemResult {
  return db.transaction(
    (tx): RedeemResult => {
      const seat = tx
        .select()
        .from(coupons)
        .where(eq(coupons.code, code))
        .get();
      if (!seat) return { ok: false, error: "Coupon not found" };
      if (seat.redeemedByUserId !== null)
        return { ok: false, error: "Coupon has already been redeemed" };
      const availability = getSeatAvailability(tx, seat);
      if (availability === "on_hold") return { ok: false, error: SEAT_ON_HOLD };
      if (availability === "refunded")
        return { ok: false, error: SEAT_REFUNDED };
      const existing = tx
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.userId, studentId),
            eq(enrollments.courseId, seat.courseId)
          )
        )
        .get();
      if (existing)
        return { ok: false, error: "You are already enrolled in this course" };
      const purchase = tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, seat.purchaseId))
        .get();
      const course = tx
        .select()
        .from(courses)
        .where(eq(courses.id, seat.courseId))
        .get();
      const student = tx
        .select()
        .from(users)
        .where(eq(users.id, studentId))
        .get();
      if (!purchase || !course || !student)
        throw new Error("Seat acquisition data missing");
      if (purchase.country && purchase.country !== country)
        return {
          ok: false,
          error:
            "This coupon can only be redeemed from the same country as the purchaser",
        };

      tx.update(coupons)
        .set({
          redeemedByUserId: studentId,
          redeemedAt: new Date().toISOString(),
        })
        .where(eq(coupons.id, seat.id))
        .run();
      const { enrollment } = createEnrollment(tx, {
        studentId,
        courseId: seat.courseId,
      });
      const remainingSeats = tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(
          and(
            eq(coupons.purchaseId, purchase.id),
            isNull(coupons.redeemedByUserId),
            isNull(coupons.redeemedAt),
            isNull(coupons.refundedAt)
          )
        )
        .all().length;
      const body = `${student.name} claimed a Seat on ${course.title}. ${remainingSeats} Seats remaining.`;
      enqueueNotification(tx, {
        eventKey: `seat-claimed:${seat.id}`,
        workflow: "cadence-seat-claimed",
        recipientId: purchase.userId,
        actorId: studentId,
        data: {
          ...notificationData({
            title: "Seat claimed",
            body,
            url: "/team",
            emailSummary: body,
            emailSubject: "Seat claimed",
          }),
          student_id: studentId,
          student_name: student.name,
          course_id: course.id,
          course_title: course.title,
          seat_id: seat.id,
          purchase_id: purchase.id,
          remaining_seats: remainingSeats,
        },
      });
      return { ok: true, enrollment };
    },
    { behavior: "immediate" }
  );
}
