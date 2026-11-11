import { and, eq } from "drizzle-orm";
import type { db as database } from "~/db";
import { teamMembers, TeamMemberRole, users } from "~/db/schema";
import { getCurrentUserId } from "./session";
import { eligibleNotificationTypes } from "./notifications";
import type { NotificationCredentials } from "./notifications";
export async function openNotifications(
  request: Request,
  db: typeof database,
  access: {
    identify(person: {
      id: number;
      name: string;
      email: string;
    }): Promise<unknown>;
    issue(person: { id: number }): NotificationCredentials | object;
  }
) {
  const id = await getCurrentUserId(request);
  const person = id
    ? db.select().from(users).where(eq(users.id, id)).get()
    : undefined;
  if (!person)
    throw new Response("Select a user from the DevUI panel", { status: 401 });
  await access.identify({
    id: person.id,
    name: person.name,
    email: person.email,
  });
  const teamAdmin = !!db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, person.id),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  return {
    credentials: access.issue({ id: person.id }) as NotificationCredentials,
    types: eligibleNotificationTypes(person.role, teamAdmin),
  };
}
