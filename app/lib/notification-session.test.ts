import { deferred } from "~/test/deferred";
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
  const identity = deferred<typeof auth>();
  const transport = {
    identify: () => identity.promise,
    request: vi.fn(),
  };
  const session = new NotificationSession("1", transport);
  const pending = session.start();
  session.dispose();
  identity.resolve(auth);
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
  const stale = deferred<unknown>();
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [item], meta: { unread_count: 1 } });
  const session = new NotificationSession("1", {
    identify: async () => auth,
    request,
  });
  await session.start();
  request.mockImplementationOnce(() => stale.promise);
  const pending = session.refresh();
  await Promise.resolve();
  await Promise.resolve();
  request.mockResolvedValue({ entries: [], meta: { unread_count: 0 } });
  await session.read("one");
  stale.resolve({ entries: [item], meta: { unread_count: 1 } });
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
  request.mockRejectedValueOnce(new Error("offline"));
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
  expect(session.state.preferenceError).toContain("unavailable");
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
      __persistence_strategy__: "merge",
      workflows: {
        "cadence-enrollment": {
          channel_types: { in_app_feed: true, email: false },
        },
      },
    }
  );
  expect(session.state.saved).toBe(true);
});

it("synchronizes current profile on each Feed and preferences opening without writing preferences", async () => {
  const identify = vi.fn().mockResolvedValue(auth);
  const request = vi.fn().mockResolvedValue({ workflows: {} });
  const session = new NotificationSession("1", { identify, request });
  await session.start();
  identify.mockClear();
  request.mockClear();
  await session.openFeed();
  await session.openFeed();
  await session.loadPreferences();
  await session.loadPreferences();
  expect(identify).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.every(([, , method]) => method === undefined)).toBe(
    true
  );
  identify.mockRejectedValueOnce(new Error("offline"));
  await session.openFeed();
  expect(session.state.error).toContain("unavailable");
  identify.mockRejectedValueOnce(new Error("offline"));
  await session.loadPreferences();
  expect(session.state.preferenceError).toContain("unavailable");
});

it("clears a saving session on effect restart and ignores its late completion", async () => {
  const saved = deferred<unknown>();
  const request = vi.fn().mockResolvedValue({
    entries: [],
    meta: { unread_count: 0 },
    workflows: {},
  });
  const session = new NotificationSession("1", {
    identify: async () => auth,
    request,
  });
  await session.start();
  await session.loadPreferences();
  request.mockImplementationOnce(() => saved.promise);
  const pending = session.savePreferences();
  await Promise.resolve();
  await Promise.resolve();
  expect(session.state.saving).toBe(true);
  session.dispose();
  session.activate();
  await session.start();
  expect(session.state.saving).toBe(false);
  saved.resolve({});
  await pending;
  expect(session.state.saved).toBe(false);
  expect(session.state.preferenceError).toBe("");
});

it.each(["Feed", "preferences"])(
  "ignores late %s results after abandoning and restarting the effect",
  async (surface) => {
    const old = deferred<unknown>();
    const request = vi.fn().mockResolvedValue({
      entries: [],
      meta: { unread_count: 2 },
      workflows: {},
    });
    const session = new NotificationSession("1", {
      identify: async () => auth,
      request,
    });
    await session.start();
    request.mockClear();
    request.mockImplementationOnce(() => old.promise);
    const pending =
      surface === "Feed" ? session.refresh() : session.loadPreferences();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    session.dispose();
    session.activate();
    await session.start();
    old.resolve({
      entries: [item],
      meta: { unread_count: 99 },
      workflows: { "cadence-enrollment": true },
    });
    await pending;
    expect(session.state.feed?.meta.unread_count).toBe(2);
    expect(session.state.preferences).toBeNull();
    expect(session.state.error).toBe("");
  }
);

it("fences an outstanding Feed when identification discovers another person", async () => {
  const late = deferred<unknown>();
  const identify = vi.fn().mockResolvedValue(auth);
  const request = vi
    .fn()
    .mockResolvedValue({ entries: [], meta: { unread_count: 0 } });
  const session = new NotificationSession("1", { identify, request });
  await session.start();
  request.mockImplementationOnce(() => late.promise);
  const pending = session.refresh();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  identify.mockResolvedValue({
    ...auth,
    credentials: { ...auth.credentials, userId: "2" },
  });
  await session.start();
  late.resolve({ entries: [item], meta: { unread_count: 1 } });
  await pending;
  expect(session.state.credentials).toBeNull();
  expect(session.state.feed).toBeNull();
  expect(session.state.error).toContain("unavailable");
  expect(session.state.preferenceError).toContain("unavailable");
});
