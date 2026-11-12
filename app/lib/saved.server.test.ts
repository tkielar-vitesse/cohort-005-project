import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { lessons, modules } from "~/db/schema";
import {
  getBookmark,
  toggleBookmark,
  getNote,
  saveNote,
  getSavedForUser,
} from "./saved.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let first: number;
let second: number;
const earlier = new Date("2026-10-01T12:00:00Z");
const later = new Date("2026-10-02T12:00:00Z");

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  first = db
    .insert(lessons)
    .values({ moduleId: module.id, title: "First", position: 1 })
    .returning()
    .get().id;
  second = db
    .insert(lessons)
    .values({ moduleId: module.id, title: "Second", position: 2 })
    .returning()
    .get().id;
});
afterEach(() => vi.useRealTimers());

it("toggles a single bookmark without affecting another Student", () => {
  expect(toggleBookmark(db, base.user.id, first)).toBe(true);
  expect(getBookmark(db, base.user.id, first)).toBeDefined();
  toggleBookmark(db, base.instructor.id, first);
  expect(toggleBookmark(db, base.user.id, first)).toBe(false);
  expect(getBookmark(db, base.user.id, first)).toBeUndefined();
  expect(getBookmark(db, base.instructor.id, first)).toBeDefined();
  toggleBookmark(db, base.user.id, first);
  expect(getSavedForUser(db, base.user.id).savedBookmarks).toHaveLength(1);
});

it("replaces a single plain-text note, preserving creation time and advancing last edit", () => {
  saveNote(db, base.user.id, first, "  # My note\n*literal*  ", earlier);
  expect(getNote(db, base.user.id, first)?.body).toBe("# My note\n*literal*");
  saveNote(db, base.user.id, first, "Replacement", later);
  expect(getNote(db, base.user.id, first)).toMatchObject({
    body: "Replacement",
    createdAt: earlier.toISOString(),
    updatedAt: later.toISOString(),
  });
  expect(getSavedForUser(db, base.user.id).savedNotes).toHaveLength(1);
  expect(getNote(db, base.instructor.id, first)).toBeUndefined();
});

it("accepts 2,000 characters and refuses 2,001 without replacing the saved note", () => {
  saveNote(db, base.user.id, first, "x".repeat(2000), earlier);
  expect(() =>
    saveNote(db, base.user.id, first, "x".repeat(2001), later)
  ).toThrow();
  expect(getNote(db, base.user.id, first)?.body).toHaveLength(2000);
});

it("lists only the owner's rows, newest first, with Lesson and Course details", () => {
  vi.useFakeTimers();
  vi.setSystemTime(earlier);
  toggleBookmark(db, base.user.id, first);
  saveNote(db, base.user.id, first, "Older", earlier);
  vi.setSystemTime(later);
  toggleBookmark(db, base.user.id, second);
  saveNote(db, base.user.id, second, "Newer", later);
  toggleBookmark(db, base.instructor.id, first);
  saveNote(db, base.instructor.id, first, "Private", later);
  const saved = getSavedForUser(db, base.user.id);
  for (const rows of [saved.savedBookmarks, saved.savedNotes]) {
    expect(rows.map((row) => row.lessonTitle)).toEqual(["Second", "First"]);
    expect(
      rows.every(
        (row) =>
          row.courseTitle === base.course.title &&
          row.courseSlug === base.course.slug
      )
    ).toBe(true);
  }
  saveNote(db, base.user.id, first, "Edited", new Date("2026-10-03T12:00:00Z"));
  expect(
    getSavedForUser(db, base.user.id).savedNotes.map((row) => row.body)
  ).toEqual(["Edited", "Newer"]);
});
