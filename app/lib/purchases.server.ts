import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  enrollments,
  purchases,
  teams,
  teamMembers,
  coupons,
  TeamMemberRole,
} from "~/db/schema";
import type { NotificationDb } from "./notification-submissions.server";
import { createEnrollment } from "./enrollments.server";

/** Pricing and country resolution belong to the route; these are sale snapshots. */
export function purchaseCourse(
  db: NotificationDb,
  input: {
    studentId: number;
    courseId: number;
    amountPaid: number;
    country: string | null;
  }
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, input.studentId),
          eq(enrollments.courseId, input.courseId)
        )
      )
      .get();
    if (existing) return { created: false as const };
    const purchase = tx
      .insert(purchases)
      .values({
        userId: input.studentId,
        courseId: input.courseId,
        amountPaid: input.amountPaid,
        country: input.country,
      })
      .returning()
      .get();
    const { enrollment } = createEnrollment(tx, input);
    return { created: true as const, purchase, enrollment };
  });
}

/** A Team Licence grants Seats only, never an Enrollment for the buyer. */
export function purchaseTeamLicence(
  db: NotificationDb,
  input: {
    studentId: number;
    courseId: number;
    amountPaid: number;
    country: string | null;
    quantity: number;
  }
) {
  return db.transaction((tx) => {
    const purchase = tx
      .insert(purchases)
      .values({
        userId: input.studentId,
        courseId: input.courseId,
        amountPaid: input.amountPaid,
        country: input.country,
      })
      .returning()
      .get();
    const membership = tx
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, input.studentId),
          eq(teamMembers.role, TeamMemberRole.Admin)
        )
      )
      .get();
    const team = membership
      ? tx.select().from(teams).where(eq(teams.id, membership.teamId)).get()!
      : tx.insert(teams).values({}).returning().get();
    if (!membership)
      tx.insert(teamMembers)
        .values({
          teamId: team.id,
          userId: input.studentId,
          role: TeamMemberRole.Admin,
        })
        .run();
    const seats = [];
    for (let i = 0; i < input.quantity; i++) {
      seats.push(
        tx
          .insert(coupons)
          .values({
            teamId: team.id,
            courseId: input.courseId,
            purchaseId: purchase.id,
            code: randomBytes(12).toString("base64url"),
          })
          .returning()
          .get()
      );
    }
    return { purchase, team, coupons: seats };
  });
}
