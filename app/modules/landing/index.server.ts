import { db } from "~/db";
import { getLandingPage, type Db } from "./lib/landing";

export type { FeaturedCourse, LandingPage } from "./lib/landing";

/**
 * The figures and courses on the landing page (`/`), bound to a database.
 * The app uses `landing`; tests build their own against a test database.
 */
export function createLanding(database: Db) {
  return {
    /**
     * The newest published courses (at most three, each with its lesson
     * count) and the totals the hero shows. Drafts and archived courses are
     * left out of every figure.
     */
    get() {
      return getLandingPage(database);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const landing = /* @__PURE__ */ createLanding(db);
