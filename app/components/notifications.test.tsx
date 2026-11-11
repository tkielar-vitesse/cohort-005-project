// @vitest-environment jsdom
import { deferred } from "~/test/deferred";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import {
  NotificationsProvider,
  NotificationBell,
  NotificationPreferences,
} from "./notifications";
import { notificationTransport } from "~/lib/notification-session";

it("loads unread Notifications through StrictMode effect replay and fences abandoned identities", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const access = (userId: string) => ({
    credentials: {
      userId,
      publicKey: "public",
      channelId: "feed",
      token: "signed",
      expiresAt: Date.now() + 900000,
    },
    types: [
      {
        key: "cadence-enrollment",
        label: "New Enrollment",
        email: false,
        defaultOn: false,
        roles: ["instructor"],
      },
    ],
  });
  const abandoned = deferred<ReturnType<typeof access>>();
  const identify = vi
    .spyOn(notificationTransport, "identify")
    .mockImplementationOnce(() => abandoned.promise)
    .mockResolvedValue(access("1"));
  const request = vi.spyOn(notificationTransport, "request").mockResolvedValue({
    entries: [],
    meta: { unread_count: 7 },
    workflows: {},
  });
  try {
    await act(async () => {
      root.render(
        <StrictMode>
          <MemoryRouter>
            <NotificationsProvider personId={1}>
              <NotificationBell />
              <NotificationPreferences />
            </NotificationsProvider>
          </MemoryRouter>
        </StrictMode>
      );
    });
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Notifications, 7 unread"
    );
    expect(host.querySelectorAll("input[type=checkbox]")).toHaveLength(1);
    expect(host.textContent).toContain("New Enrollment");
    await act(async () => {
      abandoned.resolve(access("2"));
    });
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Notifications, 7 unread"
    );
    expect(
      request.mock.calls.every(([credentials]) => credentials.userId === "1")
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    identify.mockRestore();
    request.mockRestore();
  }
});
