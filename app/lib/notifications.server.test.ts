import { expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { setCurrentUserId } from "./session";
import { openNotifications } from "./notifications.server";

it("uses only a valid current session identity and synchronizes current profile without preferences", async () => {
  const db = createTestDb();
  const { user } = seedBaseData(db);
  const identify = vi.fn().mockResolvedValue(undefined);
  const issue = vi
    .fn()
    .mockReturnValue({ userId: String(user.id), token: "signed" });
  await expect(
    openNotifications(
      new Request("http://localhost/api/notifications?userId=99"),
      db,
      { identify, issue }
    )
  ).rejects.toMatchObject({ status: 401 });
  expect(issue).not.toHaveBeenCalled();
  const cookie = await setCurrentUserId(
    new Request("http://localhost"),
    user.id
  );
  const result = await openNotifications(
    new Request("http://localhost/api/notifications?userId=99", {
      headers: { Cookie: cookie },
    }),
    db,
    { identify, issue }
  );
  expect(result.credentials.userId).toBe(String(user.id));
  expect(identify).toHaveBeenCalledWith({
    id: user.id,
    name: user.name,
    email: user.email,
  });
});

it("does not issue credentials for a deleted session-selected person or failed identification", async () => {
  const db = createTestDb();
  const { user } = seedBaseData(db);
  const identify = vi.fn().mockRejectedValue(new Error("Knock unavailable"));
  const issue = vi.fn();
  const cookie = await setCurrentUserId(new Request("http://localhost"), 99999);
  await expect(
    openNotifications(
      new Request("http://localhost/api/notifications", {
        headers: { Cookie: cookie },
      }),
      db,
      { identify, issue }
    )
  ).rejects.toMatchObject({ status: 401 });
  const validCookie = await setCurrentUserId(
    new Request("http://localhost"),
    user.id
  );
  await expect(
    openNotifications(
      new Request("http://localhost/api/notifications", {
        headers: { Cookie: validCookie },
      }),
      db,
      { identify, issue }
    )
  ).rejects.toThrow("Knock unavailable");
  expect(issue).not.toHaveBeenCalled();
});
