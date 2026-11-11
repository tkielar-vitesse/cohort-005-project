// THROWAWAY: session-bound credentials and replay from the vendor-fit spike.
import type { Route } from "./+types/api.notification-prototype";
import {
  credentials,
  currentUser,
  replies,
  triggerReply,
} from "~/lib/knock.prototype.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await currentUser(request);
  return Response.json(
    {
      user,
      credentials: await credentials(user.id),
      replies: replies(user.id),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function action({ request }: Route.ActionArgs) {
  const user = await currentUser(request);
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new Response("Invalid origin", { status: 403 });
  const form = await request.formData();
  try {
    return Response.json(
      await triggerReply(user.id, Number(form.get("replyId")))
    );
  } catch {
    return Response.json(
      {
        error: "Replay failed; check the committed Knock Development workflow.",
      },
      { status: 502 }
    );
  }
}
