import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./comments.server";
import { bookmarks, notes, lessons, modules, courses } from "~/db/schema";

export const noteBodySchema = z.string().trim().max(2000);

export function getBookmark(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

export function toggleBookmark(db: Db, userId: number, lessonId: number) {
  return db.transaction(() => {
    const existing = getBookmark(db, userId, lessonId);
    if (existing) {
      db.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();
      return false;
    }
    db.insert(bookmarks).values({ userId, lessonId }).run();
    return true;
  });
}

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
) {
  const trimmed = noteBodySchema.parse(body);
  const timestamp = now.toISOString();
  return db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning()
    .get();
}

const lessonRef = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
  courseId: courses.id,
};

// Only call for the signed-in owner. Access filtering belongs to the route,
// where the request's country and course content access are available.
export function getSavedForUser(db: Db, userId: number) {
  const savedBookmarks = db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRef })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt))
    .all();
  const savedNotes = db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRef,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
    .all();
  return { savedBookmarks, savedNotes };
}
