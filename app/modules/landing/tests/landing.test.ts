import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLanding } from "../index.server";

let db: TestDb;
let instructorId: number;
let categoryId: number;
let baseCourseId: number;

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  instructorId = base.instructor.id;
  categoryId = base.category.id;
  baseCourseId = base.course.id;
  db.update(schema.courses)
    .set({ createdAt: "2026-01-15T00:00:00.000Z" })
    .run();
});

// ─── Fixtures ───
// Nothing in the app writes courses, modules or lessons through a module yet,
// so rows go in directly. Kept in one place so a schema change touches only
// this block.

let slugCounter = 0;

function addCourse(
  title: string,
  createdAt: string,
  status = CourseStatus.Published
) {
  slugCounter += 1;
  return db
    .insert(schema.courses)
    .values({
      title,
      slug: `landing-course-${slugCounter}`,
      description: `${title} description`,
      salesCopy: markdown(title),
      instructorId,
      categoryId,
      status,
      createdAt,
    })
    .returning()
    .get();
}

function addLessons(courseId: number, lessonCount: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  for (let position = 1; position <= lessonCount; position++) {
    db.insert(schema.lessons)
      .values({ moduleId: module.id, title: `Lesson ${position}`, position })
      .run();
  }
}

function addCategory(name: string) {
  db.insert(schema.categories).values({ name, slug: name.toLowerCase() }).run();
}

function getLanding() {
  return createLanding(db).get();
}

describe("landing", () => {
  it("features the three newest published courses, newest first", () => {
    addCourse("Oldest", "2020-01-01T00:00:00.000Z");
    addCourse("Middle", "2026-02-01T00:00:00.000Z");
    addCourse("Newest", "2026-03-01T00:00:00.000Z");
    addCourse("Draft", "2026-04-01T00:00:00.000Z", CourseStatus.Draft);
    addCourse("Archived", "2026-04-02T00:00:00.000Z", CourseStatus.Archived);

    const titles = getLanding().featuredCourses.map((c) => c.title);

    expect(titles).toEqual(["Newest", "Middle", "Test Course"]);
  });

  it("gives each featured course its instructor, category and lesson count", () => {
    const course = addCourse("With lessons", "2099-01-01T00:00:00.000Z");
    addLessons(course.id, 2);
    addLessons(course.id, 3);
    addLessons(baseCourseId, 1);

    const [first, second] = getLanding().featuredCourses;

    expect(first).toMatchObject({
      title: "With lessons",
      slug: course.slug,
      description: "With lessons description",
      instructorName: "Test Instructor",
      categoryName: "Programming",
      lessonCount: 5,
    });
    expect(second).toMatchObject({ id: baseCourseId, lessonCount: 1 });
  });

  it("gives a course with no lessons a lesson count of zero", () => {
    expect(getLanding().featuredCourses).toEqual([
      expect.objectContaining({ id: baseCourseId, lessonCount: 0 }),
    ]);
  });

  it("counts only published courses and their lessons", () => {
    const published = addCourse("Published", "2026-01-01T00:00:00.000Z");
    const draft = addCourse(
      "Draft",
      "2026-01-01T00:00:00.000Z",
      CourseStatus.Draft
    );
    addLessons(published.id, 4);
    addLessons(baseCourseId, 2);
    addLessons(draft.id, 7);
    addCategory("Design");

    expect(getLanding()).toMatchObject({
      totalCourses: 2,
      totalLessons: 6,
      totalCategories: 2,
    });
  });

  it("counts every published course, not only the featured ones", () => {
    for (let i = 0; i < 4; i++)
      addCourse(`Course ${i}`, `2026-0${i + 1}-01T00:00:00.000Z`);

    const page = getLanding();

    expect(page.featuredCourses).toHaveLength(3);
    expect(page.totalCourses).toBe(5);
  });

  it("returns empty figures when nothing is published", () => {
    db.update(schema.courses).set({ status: CourseStatus.Draft }).run();

    expect(getLanding()).toMatchObject({
      featuredCourses: [],
      totalCourses: 0,
      totalLessons: 0,
    });
  });
});
