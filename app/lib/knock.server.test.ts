import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { expect, it, vi } from "vitest";
import { notificationCredentials, createKnockAdapter } from "./knock.server";

it("issues short-lived RS256 credentials with explicit Feed/preferences grants and no profile writes", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = notificationCredentials(
    { id: 42 },
    {
      publicKey: "pk_test_key",
      channelId: "feed",
      signingKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
    1000
  );
  const [header, payload, signature] = credentials.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(JSON.parse(Buffer.from(header, "base64url").toString()).alg).toBe(
    "RS256"
  );
  expect(claims).toEqual({
    sub: "42",
    iat: 1000,
    exp: 1900,
    explicit_grants: true,
    grants: {
      "https://api.knock.app/v1/users/42": {
        "user/feed_read": [{}],
        "user/feed_write": [{}],
        "preferences/read": [{}],
        "preferences/write": [{}],
      },
    },
  });
  expect(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey(privateKey),
      Buffer.from(signature, "base64url")
    )
  ).toBe(true);
});

it("maps profile synchronization and immutable trigger identity without writing preferences", async () => {
  const update = vi.fn().mockResolvedValue({});
  const trigger = vi.fn().mockResolvedValue({ workflow_run_id: "run" });
  const adapter = createKnockAdapter({
    users: { update },
    workflows: { trigger },
  } as never);
  await adapter.identify({
    id: 12,
    name: "Current Name",
    email: "current@example.com",
  });
  expect(update).toHaveBeenCalledWith("12", {
    name: "Current Name",
    email: "current@example.com",
  });
  await expect(
    adapter.trigger({
      workflow: "cadence-discussion-reply",
      recipientId: "12",
      actorId: "2",
      data: { body: "Reply", url: "/courses/example/lessons/1" },
      idempotencyKey: "stable",
    })
  ).resolves.toEqual({ workflow_run_id: "run" });
  expect(trigger).toHaveBeenCalledWith(
    "cadence-discussion-reply",
    {
      recipients: ["12"],
      actor: "2",
      data: { body: "Reply", url: "/courses/example/lessons/1" },
      settings: { sandbox_mode: true },
    },
    { idempotencyKey: "stable" }
  );
});
it.each([
  [400, false],
  [401, false],
  [408, true],
  [429, true],
  [503, true],
  [undefined, true],
])(
  "translates vendor status %s into retryable=%s",
  async (status, retryable) => {
    const adapter = createKnockAdapter({
      users: { update: vi.fn().mockRejectedValue({ status }) },
    } as never);
    await expect(
      adapter.identify({ id: "1", name: "Name", email: "mail@example.com" })
    ).rejects.toMatchObject({ retryable });
  }
);
