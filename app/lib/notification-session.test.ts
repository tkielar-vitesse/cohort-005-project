import { expect, it, vi } from "vitest";
import { NotificationSession } from "./notification-session";
const item = {
  id: "one",
  inserted_at: "2026-01-01",
  data: { url: "/settings" },
};
const auth = {
  credentials: {
    userId: "1",
    publicKey: "public",
    channelId: "feed",
    token: "signed",
    expiresAt: Date.now() + 900000,
  },
  types: [],
};
it("ignores late identity responses after switching people", async () => {
  let resolve!: (value: typeof auth) => void;
  const transport = {
    identify: () =>
      new Promise<typeof auth>((r) => {
        resolve = r;
      }),
    request: vi.fn(),
  };
  const session = new NotificationSession("1", transport);
  const pending = session.start();
  session.dispose();
  resolve(auth);
  await pending;
  expect(session.state.credentials).toBeNull();
  expect(transport.request).not.toHaveBeenCalled();
});

it("keeps rows and unread count on failed read, and confirms a dismissal only once", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [item], meta: { unread_count: 3 } });
  const session = new NotificationSession("1", {
    identify: async () => auth,
    request,
  });
  await session.start();
  request.mockRejectedValueOnce(new Error("offline"));
  expect(await session.read("one")).toBe(false);
  expect(session.state.feed?.entries).toEqual([item]);
  expect(session.state.error).toContain("Could not dismiss");
  request.mockImplementation((_c, path) =>
    path.includes("feeds") ? new Promise(() => {}) : Promise.resolve({})
  );
  await session.read("one");
  await session.read("one");
  expect(session.state.feed?.meta.unread_count).toBe(2);
});

it("never restores a confirmed dismissal from a poll started before the write", async () => {
  let stale!: (feed: unknown) => void;
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [item], meta: { unread_count: 1 } });
  const session = new NotificationSession("1", {
    identify: async () => auth,
    request,
  });
  await session.start();
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        stale = resolve;
      })
  );
  const pending = session.refresh();
  await Promise.resolve();
  await Promise.resolve();
  request.mockResolvedValue({ entries: [], meta: { unread_count: 0 } });
  await session.read("one");
  stale({ entries: [item], meta: { unread_count: 1 } });
  await pending;
  expect(session.state.feed).toEqual({
    entries: [],
    meta: { unread_count: 0 },
  });
});
it("opening marks displayed items seen without marking them read", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [item], meta: { unread_count: 1 } });
  const session = new NotificationSession("1", {
    identify: async () => auth,
    request,
  });
  await session.start();
  request.mockClear();
  await session.markSeen();
  expect(request).toHaveBeenCalledWith(
    auth.credentials,
    "messages/batch/seen",
    "POST",
    { message_ids: ["one"] }
  );
  expect(session.state.feed?.meta.unread_count).toBe(1);
});
it("failed preference saves retain edits and never report success", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [], meta: { unread_count: 0 } });
  const session = new NotificationSession("1", {
    identify: async () => ({
      ...auth,
      types: [
        {
          key: "cadence-enrollment",
          label: "New Enrollment",
          email: false,
          defaultOn: false,
          roles: ["instructor"],
        },
      ],
    }),
    request,
  });
  await session.start();
  request.mockResolvedValue({ workflows: { unrelated: false } });
  await session.loadPreferences();
  session.editPreferences([
    { key: "cadence-enrollment", receive: true, email: false },
  ]);
  request
    .mockResolvedValueOnce({ workflows: { unrelated: false } })
    .mockRejectedValueOnce(new Error("offline"));
  await session.savePreferences();
  expect(session.state.saved).toBe(false);
  expect(session.state.preferenceError).toContain("Could not save");
  expect(session.state.preferences).toEqual([
    { key: "cadence-enrollment", receive: true, email: false },
  ]);
});
it("refreshes credentials from the session and clears state on identity mismatch", async () => {
  const identify = vi.fn().mockResolvedValue(auth);
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [item], meta: { unread_count: 1 } });
  const session = new NotificationSession("1", { identify, request });
  await session.start();
  identify.mockResolvedValue({
    ...auth,
    credentials: { ...auth.credentials, userId: "2" },
  });
  await session.start();
  expect(session.state.credentials).toBeNull();
  expect(session.state.feed).toBeNull();
  expect(session.state.preferences).toBeNull();
  expect(session.state.error).toContain("unavailable");
});

it("saves person-wide workflow preferences while preserving unrelated settings", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [], meta: { unread_count: 0 } });
  const session = new NotificationSession("1", {
    identify: async () => ({
      ...auth,
      types: [
        {
          key: "cadence-enrollment",
          label: "New Enrollment",
          email: false,
          defaultOn: false,
          roles: ["instructor"],
        },
      ],
    }),
    request,
  });
  await session.start();
  request.mockResolvedValue({
    id: "default",
    workflows: { unrelated: false },
    categories: { marketing: false },
  });
  await session.loadPreferences();
  session.editPreferences([
    { key: "cadence-enrollment", receive: true, email: false },
  ]);
  await session.savePreferences();
  expect(request).toHaveBeenLastCalledWith(
    auth.credentials,
    "users/1/preferences/default",
    "PUT",
    {
      __persistence_strategy__: "replace",
      workflows: {
        unrelated: false,
        "cadence-enrollment": {
          channel_types: { in_app_feed: true, email: false },
        },
      },
      categories: { marketing: false },
    }
  );
  expect(session.state.saved).toBe(true);
});
