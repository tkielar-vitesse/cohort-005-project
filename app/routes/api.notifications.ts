import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { openNotifications } from "~/lib/notifications.server";
import {
  knockConfig,
  knockAdapter,
  notificationCredentials,
} from "~/lib/knock.server";
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const result = await openNotifications(request, db, {
      identify: (person) => knockAdapter().identify(person),
      issue: (person) => notificationCredentials(person, knockConfig()),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Notifications unavailable. Try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
