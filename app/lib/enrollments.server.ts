import { and, eq } from "drizzle-orm";
import { courses, enrollments, users } from "~/db/schema";
import {
  enqueueNotification,
  type NotificationDb,
} from "./notification-submissions.server";
import { notificationData } from "./notification-content.server";

type Tx = Parameters<Parameters<NotificationDb["transaction"]>[0]>[0];
type Queryable = NotificationDb | Tx;

/** Call within the acquisition transaction (Individual Purchase or Seat claim).
 * Existing Enrollments create no event; a fresh Enrollment has its own event key. */
export function createEnrollment(
  tx: Queryable,
  input: { studentId: number; courseId: number }
) {
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
  if (existing) return { created: false as const, enrollment: existing };
  const course = tx
    .select()
    .from(courses)
    .where(eq(courses.id, input.courseId))
    .get();
  const student = tx
    .select()
    .from(users)
    .where(eq(users.id, input.studentId))
    .get();
  if (!course || !student) throw new Error("Course or Student not found");
  const enrollment = tx
    .insert(enrollments)
    .values({
      userId: input.studentId,
      courseId: input.courseId,
    })
    .returning()
    .get();
  const body = `${student.name} enrolled on ${course.title}.`;
  enqueueNotification(tx, {
    eventKey: `enrollment:${enrollment.id}`,
    workflow: "cadence-enrollment",
    recipientId: course.instructorId,
    actorId: student.id,
    data: {
      ...notificationData({
        title: "New Enrollment",
        body,
        url: `/courses/${course.slug}`,
        emailSummary: body,
        emailSubject: "New Enrollment",
      }),
      student_id: student.id,
      student_name: student.name,
      course_id: course.id,
      course_title: course.title,
      enrollment_id: enrollment.id,
    },
  });
  return { created: true as const, enrollment };
}
