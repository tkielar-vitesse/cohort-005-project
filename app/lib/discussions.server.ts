import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "./comments";
import {
  enqueueNotification,
  type NotificationDb,
} from "./notification-submissions.server";
import { notificationData } from "./notification-content.server";

/** Both lesson and Instructor posting entry points use this atomic operation.
 * Route actions retain their current authentication and authorization checks. */
export function createDiscussionComment(
  db: NotificationDb,
  input: {
    userId: number;
    lessonId: number;
    parentId: number | null;
    body: string;
  },
  options: { appOrigin?: string } = {}
) {
  const body = input.body.trim();
  if (body.length < MIN_COMMENT_LENGTH)
    throw new Error("Comment cannot be empty");
  if (body.length > MAX_COMMENT_LENGTH)
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  return db.transaction((tx) => {
    const context = tx
      .select({
        instructorId: courses.instructorId,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        lessonTitle: lessons.title,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, input.lessonId))
      .get();
    if (!context) throw new Error("Lesson not found");
    if (input.parentId !== null) {
      const parent = tx
        .select()
        .from(comments)
        .where(eq(comments.id, input.parentId))
        .get();
      if (!parent) throw new Error("Parent comment not found");
      if (parent.lessonId !== input.lessonId)
        throw new Error("Parent comment belongs to a different lesson");
      if (parent.parentId !== null)
        throw new Error("Replies can only be one level deep");
    }
    const comment = tx
      .insert(comments)
      .values({ ...input, body })
      .returning()
      .get();
    if (input.parentId === null && context.instructorId !== input.userId) {
      const actor = tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .get()!;
      const url = `/courses/${context.courseSlug}/lessons/${input.lessonId}`;
      const summary = `${actor.name} asked a Discussion Question in ${context.courseTitle} — ${context.lessonTitle}.`;
      enqueueNotification(tx, {
        eventKey: `discussion-question:${comment.id}`,
        workflow: "cadence-discussion-question",
        recipientId: context.instructorId,
        actorId: input.userId,
        data: notificationData(
          {
            title: "New Discussion Question",
            body: `${summary} ${body.slice(0, 280)}`,
            url,
            emailSummary: summary,
            emailSubject: "New Discussion Question on Cadence",
          },
          options.appOrigin
        ),
      });
    }
    return comment;
  });
}
