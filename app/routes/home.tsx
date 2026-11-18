import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import {
  BookOpen,
  ArrowRight,
  User,
  Moon,
  Sun,
  Layers,
  ListChecks,
  TrendingUp,
} from "lucide-react";
import { CourseImage } from "~/components/course-image";
import { DevUI } from "~/components/dev-ui";
import { getCurrentUserId, getDevCountry } from "~/lib/session";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { users } from "~/db/schema";
import { landing } from "~/modules/landing/index.server";

function getAllUsers() {
  return db.select().from(users).all();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

const features = [
  {
    icon: Layers,
    title: "Structured modules",
    body: "Every course is broken into short lessons, in the order you need them.",
  },
  {
    icon: ListChecks,
    title: "Quizzes that check you",
    body: "Test what you just learned before moving on to the next lesson.",
  },
  {
    icon: TrendingUp,
    title: "Progress you can see",
    body: "Pick up exactly where you left off, on any course, at any time.",
  },
];

export function meta() {
  return [
    { title: "Cadence — Learn at your own pace" },
    {
      name: "description",
      content:
        "A modern course platform for developers. Browse courses, track your progress, and learn at your own pace.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const page = landing.get();
  const users = getAllUsers();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? getUserById(currentUserId) : null;
  const devCountry = await getDevCountry(request);
  const countryTierInfo = getCountryTierInfo(devCountry);

  return {
    ...page,
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      : null,
    devCountry,
    countryTierInfo,
    countries: COUNTRIES,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    featuredCourses,
    totalCourses,
    totalLessons,
    totalCategories,
    users,
    currentUser,
    devCountry,
    countryTierInfo,
    countries,
  } = loaderData;
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleDarkMode() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("cadence-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="text-xl font-bold tracking-tight">
            Cadence
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              to="/courses"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Courses
            </Link>
            <button
              onClick={toggleDarkMode}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </button>
            {currentUser ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log In
                </Link>
                <Button asChild size="sm">
                  <Link to="/signup">Sign Up</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-br from-muted via-background to-background"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.2fr_1fr] lg:py-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              Self-paced courses for developers
            </p>
            <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl">
              Learn to code,
              <br />
              <span className="text-muted-foreground">at your own pace</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Structured courses built by experienced instructors. Track your
              progress, take quizzes, and build real-world skills.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/courses">
                  Browse Courses
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                {currentUser ? (
                  <Link to="/dashboard">Go to your dashboard</Link>
                ) : (
                  <Link to="/signup">Create a free account</Link>
                )}
              </Button>
            </div>
            <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-8">
              {[
                { label: "Courses", value: totalCourses },
                { label: "Lessons", value: totalLessons },
                { label: "Categories", value: totalCategories },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-sm text-muted-foreground">
                    {stat.label}
                  </dt>
                  <dd className="text-3xl font-bold tracking-tight">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <ul className="grid gap-4">
            {features.map((feature) => (
              <li
                key={feature.title}
                className="flex gap-4 rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <feature.icon className="size-5" />
                </div>
                <div>
                  <h2 className="font-semibold">{feature.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {featuredCourses.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Newest Courses
              </h2>
              <p className="mt-2 text-muted-foreground">
                Fresh from our instructors
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/courses">
                View all
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredCourses.map((course) => (
              <Link
                key={course.id}
                to={`/courses/${course.slug}`}
                className="group"
              >
                <Card className="h-full overflow-hidden pt-0 transition-shadow group-hover:shadow-md">
                  <CourseImage
                    src={course.coverImageUrl}
                    alt={course.title}
                    className="aspect-video w-full object-cover"
                  />
                  <CardHeader>
                    <h3 className="font-semibold leading-snug group-hover:text-primary">
                      {course.title}
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {course.description}
                    </p>
                  </CardContent>
                  <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="size-3" />
                      {course.instructorName ?? "Instructor"}
                    </span>
                    <span className="flex items-center gap-1">
                      <BookOpen className="size-3" />
                      {course.lessonCount} lessons
                    </span>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-foreground">Cadence</p>
            <p>Learn at your own pace.</p>
          </div>
          <nav className="flex gap-6">
            <Link to="/courses" className="hover:text-foreground">
              Courses
            </Link>
            {currentUser ? (
              <Link to="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="hover:text-foreground">
                  Log In
                </Link>
                <Link to="/signup" className="hover:text-foreground">
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        </div>
      </footer>

      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={devCountry}
        countryTierInfo={countryTierInfo}
        countries={countries}
      />
    </div>
  );
}
