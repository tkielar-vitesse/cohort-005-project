import Knock from "@knocklabs/node";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { NotificationCredentials } from "./notifications";

export function knockConfig() {
  let file: NodeJS.ProcessEnv = {};
  try {
    file = parseEnv(readFileSync(".env", "utf8"));
  } catch {}
  const env = { ...file, ...process.env };
  if (
    env.KNOCK_ENVIRONMENT !== "development" ||
    !env.KNOCK_SECRET_API_KEY?.startsWith("sk_test_")
  )
    throw new Error("Knock Development configuration unavailable");
  for (const key of [
    "KNOCK_PUBLIC_API_KEY",
    "KNOCK_SIGNING_KEY",
    "KNOCK_FEED_CHANNEL_ID",
  ])
    if (!env[key])
      throw new Error("Knock Development configuration unavailable");
  return {
    secretKey: env.KNOCK_SECRET_API_KEY!,
    publicKey: env.KNOCK_PUBLIC_API_KEY!,
    signingKey: env.KNOCK_SIGNING_KEY!,
    channelId: env.KNOCK_FEED_CHANNEL_ID!,
  };
}
// The installed SDK signer predates explicit_grants and Feed/preference write grants.
// Sign the documented claims directly so unspecified resources remain inaccessible.
export function notificationCredentials(
  person: { id: number },
  config: { publicKey: string; signingKey: string; channelId: string },
  now = Math.floor(Date.now() / 1000)
): NotificationCredentials {
  const subject = String(person.id);
  const claims = {
    sub: subject,
    iat: now,
    exp: now + 900,
    explicit_grants: true,
    grants: {
      [`https://api.knock.app/v1/users/${subject}`]: {
        "user/feed_read": [{}],
        "user/feed_write": [{}],
        "preferences/read": [{}],
        "preferences/write": [{}],
      },
    },
  };
  const encoded = [{ alg: "RS256", typ: "JWT" }, claims]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  const pem = config.signingKey.includes("-----BEGIN")
    ? config.signingKey
    : Buffer.from(config.signingKey, "base64").toString("utf8");
  const token = `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), createPrivateKey(pem)).toString("base64url")}`;
  return {
    userId: subject,
    publicKey: config.publicKey,
    channelId: config.channelId,
    token,
    expiresAt: claims.exp * 1000,
  };
}
export class NotificationAdapterError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
  }
}
export function createKnockAdapter(client: Pick<Knock, "users" | "workflows">) {
  async function translate<T>(operation: () => PromiseLike<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : 0;
      throw new NotificationAdapterError(
        "Notification service unavailable",
        !status || status === 408 || status === 429 || status >= 500
      );
    }
  }
  return {
    identify(person: { id: number | string; name: string; email: string }) {
      return translate(() =>
        client.users.update(String(person.id), {
          name: person.name,
          email: person.email,
        })
      );
    },
    trigger(input: {
      workflow: string;
      recipientId: string;
      actorId: string;
      data: Record<string, unknown>;
      idempotencyKey: string;
    }) {
      return translate(() =>
        client.workflows.trigger(
          input.workflow,
          {
            recipients: [input.recipientId],
            actor: input.actorId,
            data: input.data,
          },
          { idempotencyKey: input.idempotencyKey }
        )
      );
    },
  };
}
export function knockAdapter() {
  return createKnockAdapter(
    new Knock({ apiKey: knockConfig().secretKey, maxRetries: 0 })
  );
}
