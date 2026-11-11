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
export function preferenceUpdate(
  saved: PreferenceSet,
  choices: PreferenceChoice[]
): PreferenceSet {
  const workflows = { ...saved.workflows };
  for (const choice of choices) {
    const type = notificationTypes.find((type) => type.key === choice.key);
    if (!type) throw new Error("Unknown Notification type");
    const previous = workflows[choice.key];
    workflows[choice.key] = {
      ...(typeof previous === "object" ? previous : {}),
      channel_types: {
        ...(typeof previous === "object" ? previous.channel_types : {}),
        in_app_feed: choice.receive,
        email: choice.receive && type.email && choice.email,
      },
    };
  }
  const { id: _, ...rest } = saved;
  return { ...rest, workflows };
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
