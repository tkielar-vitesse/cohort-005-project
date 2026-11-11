export const notificationTypes = [
  {
    key: "cadence-refund-approved",
    label: "Refund Request approved",
    email: true,
    defaultOn: true,
    roles: ["student", "instructor", "admin"],
  },
  {
    key: "cadence-refund-declined",
    label: "Refund Request declined",
    email: true,
    defaultOn: true,
    roles: ["student", "instructor", "admin"],
  },
  {
    key: "cadence-refund-opened",
    label: "New Open Refund Request",
    email: true,
    defaultOn: true,
    roles: ["admin"],
  },
  {
    key: "cadence-seat-claimed",
    label: "Seat claimed",
    email: false,
    defaultOn: true,
    roles: [],
  },
  {
    key: "cadence-enrollment",
    label: "New Enrollment",
    email: false,
    defaultOn: false,
    roles: ["instructor"],
  },
  {
    key: "cadence-discussion-question",
    label: "New Discussion Question",
    email: true,
    defaultOn: true,
    roles: ["instructor"],
  },
  {
    key: "cadence-discussion-reply",
    label: "New Discussion Reply",
    email: true,
    defaultOn: true,
    roles: ["student", "instructor", "admin"],
  },
];
export type PreferenceChoice = {
  key: string;
  receive: boolean;
  email: boolean;
};
export type PreferenceSet = {
  id?: string;
  workflows?: Record<
    string,
    | boolean
    | { channel_types?: Record<string, unknown>; [key: string]: unknown }
  > | null;
  [key: string]: unknown;
};
export function eligibleNotificationTypes(role: string, teamAdmin: boolean) {
  return notificationTypes.filter(
    (type) =>
      type.roles.includes(role) ||
      (teamAdmin && type.key === "cadence-seat-claimed")
  );
}
export function preferenceChoices(
  saved: PreferenceSet,
  types = notificationTypes
): PreferenceChoice[] {
  return types.map((type) => {
    const value = saved.workflows?.[type.key];
    const receive =
      typeof value === "boolean"
        ? value
        : typeof value?.channel_types?.in_app_feed === "boolean"
          ? value.channel_types.in_app_feed
          : type.defaultOn;
    const email =
      typeof value === "boolean"
        ? value
        : typeof value?.channel_types?.email === "boolean"
          ? value.channel_types.email
          : true;
    return { key: type.key, receive, email: type.email && email };
  });
}
// Knock merges this patch recursively; omitted workflows and channel settings
// remain under their current owner, including concurrent unrelated changes.
export function preferenceUpdate(
  choices: PreferenceChoice[],
  baseline: PreferenceChoice[] = []
): PreferenceSet {
  const workflows: NonNullable<PreferenceSet["workflows"]> = {};
  for (const choice of choices) {
    const type = notificationTypes.find((type) => type.key === choice.key);
    if (!type) throw new Error("Unknown Notification type");
    const previous = baseline.find((value) => value.key === choice.key);
    const channel_types: Record<string, boolean> = {};
    if (!previous || previous.receive !== choice.receive) {
      channel_types.in_app_feed = choice.receive;
      channel_types.email = choice.receive && type.email && choice.email;
    } else if (previous.email !== choice.email) {
      channel_types.email = choice.receive && type.email && choice.email;
    }
    if (Object.keys(channel_types).length)
      workflows[choice.key] = { channel_types };
  }
  return { workflows };
}
export type NotificationItem = {
  id: string;
  read_at?: string | null;
  seen_at?: string | null;
  inserted_at: string;
  data?: { title?: string; body?: string; url?: string; courseTitle?: string };
  source?: { key?: string };
};
export type NotificationFeed = {
  entries: NotificationItem[];
  meta: { unread_count: number };
};
export type NotificationCredentials = {
  userId: string;
  publicKey: string;
  channelId: string;
  token: string;
  expiresAt: number;
};
export function notificationDestination(url?: string) {
  return url &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !/[\\\u0000-\u0020]/.test(url)
    ? url
    : null;
}
