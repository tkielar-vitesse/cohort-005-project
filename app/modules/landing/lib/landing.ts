import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import { categories, courses, lessons, modules, users } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

export const FEATURED_COURSE_COUNT = 3;

export type FeaturedCourse = {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  instructorName: string;
  categoryName: string;
  lessonCount: number;
};

export type LandingPage = {
  featuredCourses: FeaturedCourse[];
  totalCourses: number;
  totalLessons: number;
  totalCategories: number;
};

const published = eq(courses.status, schema.CourseStatus.Published);

function newestPublishedCourses(db: Db) {
  return (
    db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        description: courses.description,
        coverImageUrl: courses.coverImageUrl,
        instructorName: users.name,
        categoryName: categories.name,
      })
      .from(courses)
      .innerJoin(users, eq(courses.instructorId, users.id))
      .innerJoin(categories, eq(courses.categoryId, categories.id))
      .where(published)
      // id breaks ties so courses created in the same instant keep a stable order.
      .orderBy(desc(courses.createdAt), desc(courses.id))
      .limit(FEATURED_COURSE_COUNT)
      .all()
  );
}

function lessonCountsByCourse(db: Db, courseIds: number[]) {
  const rows = db
    .select({ courseId: modules.courseId, lessonCount: count(lessons.id) })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)
    .all();
  return new Map(rows.map((row) => [row.courseId, row.lessonCount]));
}

function countPublishedCourses(db: Db) {
  const [row] = db.select({ n: count() }).from(courses).where(published).all();
  return row.n;
}

function countPublishedLessons(db: Db) {
  const [row] = db
    .select({ n: count() })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(published)
    .all();
  return row.n;
}

function countCategories(db: Db) {
  const [row] = db.select({ n: count() }).from(categories).all();
  return row.n;
}

export function getLandingPage(db: Db): LandingPage {
  const newest = newestPublishedCourses(db);
  const lessonCounts = lessonCountsByCourse(
    db,
    newest.map((course) => course.id)
  );

  return {
    featuredCourses: newest.map((course) => ({
      ...course,
      lessonCount: lessonCounts.get(course.id) ?? 0,
    })),
    totalCourses: countPublishedCourses(db),
    totalLessons: countPublishedLessons(db),
    totalCategories: countCategories(db),
  };
}
