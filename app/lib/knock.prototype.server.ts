// THROWAWAY vendor-fit spike. Development only; never promote to production.
import Knock, { signUserToken } from "@knocklabs/node";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { getSqlite } from "~/db";
import { getCurrentUserId } from "~/lib/session";

export const workflow = "cadence-prototype-discussion-reply";
export function config() {
  if (!import.meta.env.DEV) throw new Response("Not found", { status: 404 });
  const env = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
  for (const key of ["KNOCK_SECRET_API_KEY", "KNOCK_PUBLIC_API_KEY", "KNOCK_SIGNING_KEY"]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  if (env.KNOCK_ENVIRONMENT !== "development" || !env.KNOCK_SECRET_API_KEY!.startsWith("sk_test_")) {
    throw new Error("Prototype requires Knock Development credentials");
  }
  return env;
}

export async function currentUser(request: Request) {
  config();
  const id = await getCurrentUserId(request);
  const user = getSqlite().prepare("SELECT id, name, role FROM users WHERE id = ?").get(id ?? -1) as
    { id: number; name: string; role: string } | undefined;
  if (!user) throw new Response("Select a user from the DevUI panel", { status: 401 });
  return user;
}

export async function credentials(userId: number) {
  const env = config();
  return {
    userId: String(userId),
    publicKey: env.KNOCK_PUBLIC_API_KEY!,
    channelId: env.KNOCK_FEED_CHANNEL_ID ?? null,
    token: await signUserToken(String(userId), {
      signingKey: env.KNOCK_SIGNING_KEY!, expiresInSeconds: 900,
    }),
  };
}

// Replay a real, existing Discussion Reply without writing to the app database.
export function replies(actorId: number) {
  return getSqlite().prepare(`
    SELECT r.id, r.body, q.user_id AS recipientId, u.name AS recipientName,
           l.id AS lessonId, c.slug AS courseSlug
    FROM comments r JOIN comments q ON q.id = r.parent_id
    JOIN users u ON u.id = q.user_id JOIN lessons l ON l.id = r.lesson_id
    JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
    WHERE r.user_id = ? AND q.user_id != r.user_id AND q.parent_id IS NULL
      AND q.user_id != c.instructor_id AND r.deleted_at IS NULL AND q.deleted_at IS NULL
    ORDER BY r.id
  `).all(actorId) as {
    id: number; body: string; recipientId: number; recipientName: string;
    lessonId: number; courseSlug: string;
  }[];
}

export async function triggerReply(actorId: number, replyId: number) {
  const reply = replies(actorId).find(r => r.id === replyId);
  if (!reply) throw new Response("Choose an existing Discussion Reply authored by the selected user", { status: 400 });
  const env = config();
  const client = new Knock({ apiKey: env.KNOCK_SECRET_API_KEY! });
  // No emails/phone numbers: this spike uses a feed-only workflow.
  const result = await client.workflows.trigger(workflow, {
    actor: { id: String(actorId) }, recipients: [{ id: String(reply.recipientId) }],
    data: {
      prototype: true, reply_id: reply.id, body: reply.body,
      url: `/courses/${reply.courseSlug}/lessons/${reply.lessonId}`,
    },
  }, { idempotencyKey: `cadence-prototype-reply-${reply.id}` });
  return { ...result, recipientId: reply.recipientId, replyId: reply.id };
}
