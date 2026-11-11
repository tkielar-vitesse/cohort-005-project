import { describe, expect, it } from "vitest";
import {
  notificationTypes,
  preferenceChoices,
  preferenceUpdate,
  eligibleNotificationTypes,
} from "./notifications";

describe("person-wide Notification preferences", () => {
  it("suppresses both channels when Receive notifications is off and preserves unrelated choices", () => {
    const saved = {
      workflows: { unrelated: false },
      categories: { other: false },
    };
    const next = preferenceUpdate(saved, [
      { key: "cadence-refund-approved", receive: false, email: true },
    ]);
    expect(next).toMatchObject({
      workflows: {
        unrelated: false,
        "cadence-refund-approved": {
          channel_types: { in_app_feed: false, email: false },
        },
      },
      categories: { other: false },
    });
  });
});

it("shows the union of role and overlapping Team Admin capabilities", () => {
  expect(
    eligibleNotificationTypes("instructor", true).map((type) => type.key)
  ).toEqual([
    "cadence-refund-approved",
    "cadence-refund-declined",
    "cadence-seat-claimed",
    "cadence-enrollment",
    "cadence-discussion-question",
    "cadence-discussion-reply",
  ]);
  expect(
    eligibleNotificationTypes("admin", true).map((type) => type.key)
  ).toContain("cadence-refund-opened");
  expect(
    eligibleNotificationTypes("student", false).map((type) => type.key)
  ).not.toContain("cadence-seat-claimed");
});
it("defaults Enrollment off without persisting or resetting a person's explicit choice", () => {
  expect(
    preferenceChoices({}).find((choice) => choice.key === "cadence-enrollment")
  ).toEqual({ key: "cadence-enrollment", receive: false, email: false });
  expect(
    preferenceChoices({ workflows: { "cadence-enrollment": true } }).find(
      (choice) => choice.key === "cadence-enrollment"
    )?.receive
  ).toBe(true);
  expect(notificationTypes.filter((type) => type.email)).toHaveLength(5);
});
