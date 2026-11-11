import {
  preferenceChoices,
  preferenceUpdate,
  type NotificationCredentials,
  type NotificationFeed,
  type PreferenceSet,
  type PreferenceChoice,
  type notificationTypes,
} from "./notifications";
type Access = {
  credentials: NotificationCredentials;
  types: typeof notificationTypes;
};
export interface NotificationTransport {
  identify(): Promise<Access>;
  request<T>(
    credentials: NotificationCredentials,
    path: string,
    method?: string,
    body?: unknown
  ): Promise<T>;
}
export const notificationTransport: NotificationTransport = {
  async identify() {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) throw new Error("Notifications unavailable. Try again.");
    return response.json();
  },
  async request(credentials, path, method = "GET", body) {
    const response = await fetch(`https://api.knock.app/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.publicKey}`,
        "X-Knock-User-Token": credentials.token,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("Notifications unavailable. Try again.");
    return response.status === 204 ? undefined : response.json();
  },
};
export class NotificationSession {
  state: {
    credentials: NotificationCredentials | null;
    types: typeof notificationTypes;
    feed: NotificationFeed | null;
    error: string;
    preferences: PreferenceChoice[] | null;
    preferenceError: string;
    saved: boolean;
    saving: boolean;
  } = {
    credentials: null,
    types: [],
    feed: null,
    error: "",
    preferences: null,
    preferenceError: "",
    saved: false,
    saving: false,
  };
  private active = true;
  private listeners = new Set<() => void>();
  private dismissed = new Set<string>();
  private seen = new Set<string>();
  private poll = 0;
  private appliedPoll = 0;
  private identity: Promise<void> | null = null;
  constructor(
    private personId: string,
    private transport = notificationTransport
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(change: Partial<typeof this.state>) {
    if (!this.active) return;
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  dispose() {
    this.active = false;
    this.state = {
      ...this.state,
      credentials: null,
      feed: null,
      preferences: null,
    };
    this.listeners.clear();
  }
  async start() {
    if (!this.active) return;
    try {
      await this.credentials(true);
      await this.refresh();
    } catch {
      this.update({ error: "Notifications unavailable. Try again." });
    }
  }
  private async credentials(force = false) {
    if (!this.active) throw new Error("Session changed");
    if (
      !force &&
      this.state.credentials &&
      this.state.credentials.expiresAt > Date.now() + 60000
    )
      return this.state.credentials;
    if (!this.identity) {
      this.identity = this.transport
        .identify()
        .then((access) => {
          if (!this.active) return;
          if (access.credentials.userId !== this.personId) {
            this.update({ credentials: null, feed: null, preferences: null });
            throw new Error("Session changed");
          }
          this.update({ ...access, error: "" });
        })
        .finally(() => {
          this.identity = null;
        });
    }
    await this.identity;
    if (!this.active || !this.state.credentials)
      throw new Error("Session changed");
    return this.state.credentials;
  }
  private async request<T>(
    path: (credentials: NotificationCredentials) => string,
    method?: string,
    body?: unknown
  ) {
    const credentials = await this.credentials();
    return this.transport.request<T>(
      credentials,
      path(credentials),
      method,
      body
    );
  }
  async refresh() {
    const poll = ++this.poll;
    try {
      const feed = await this.request<NotificationFeed>(
        (c) => `users/${c.userId}/feeds/${c.channelId}?status=unread`
      );
      if (!this.active || poll < this.appliedPoll) return;
      this.appliedPoll = poll;
      const stale = feed.entries.filter((item) =>
        this.dismissed.has(item.id)
      ).length;
      this.update({
        feed: {
          entries: feed.entries.filter((item) => !this.dismissed.has(item.id)),
          meta: {
            ...feed.meta,
            unread_count: Math.max(0, feed.meta.unread_count - stale),
          },
        },
        error: "",
      });
    } catch {
      this.update({ error: "Notifications unavailable. Try again." });
    }
  }
  async markSeen() {
    const ids =
      this.state.feed?.entries
        .filter((item) => !item.seen_at && !this.seen.has(item.id))
        .map((item) => item.id) ?? [];
    if (!ids.length) return;
    ids.forEach((id) => this.seen.add(id));
    try {
      await this.request(() => "messages/batch/seen", "POST", {
        message_ids: ids,
      });
    } catch {
      ids.forEach((id) => this.seen.delete(id));
      this.update({ error: "Could not mark Notifications seen. Try again." });
    }
  }
  async read(id: string) {
    try {
      await this.request(() => "messages/batch/read", "POST", {
        message_ids: [id],
      });
      if (!this.active) return false;
      if (this.dismissed.has(id)) return true;
      this.dismissed.add(id);
      const feed = this.state.feed;
      if (feed)
        this.update({
          feed: {
            entries: feed.entries.filter((item) => item.id !== id),
            meta: {
              ...feed.meta,
              unread_count: Math.max(0, feed.meta.unread_count - 1),
            },
          },
          error: "",
        });
      void this.refresh();
      return true;
    } catch {
      this.update({ error: "Could not dismiss Notification. Try again." });
      return false;
    }
  }
  async loadPreferences() {
    try {
      const saved = await this.request<PreferenceSet>(
        (c) => `users/${c.userId}/preferences/default`
      );
      this.update({
        preferences: preferenceChoices(saved, this.state.types),
        preferenceError: "",
        saved: false,
      });
    } catch {
      this.update({
        preferenceError: "Notification preferences unavailable. Try again.",
      });
    }
  }
  editPreferences(preferences: PreferenceChoice[]) {
    this.update({ preferences, saved: false });
  }
  async savePreferences() {
    if (!this.state.preferences || this.state.saving) return;
    const choices = this.state.preferences;
    this.update({ saving: true, preferenceError: "", saved: false });
    try {
      const saved = await this.request<PreferenceSet>(
        (c) => `users/${c.userId}/preferences/default`
      );
      await this.request(
        (c) => `users/${c.userId}/preferences/default`,
        "PUT",
        {
          ...preferenceUpdate(saved, choices),
          __persistence_strategy__: "replace",
        }
      );
      this.update({ saved: true });
    } catch {
      this.update({
        preferenceError: "Could not save Notification preferences. Try again.",
      });
    } finally {
      this.update({ saving: false });
    }
  }
}
