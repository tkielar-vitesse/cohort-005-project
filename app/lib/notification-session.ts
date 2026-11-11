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
  private generation = 0;
  private listeners = new Set<() => void>();
  private dismissed = new Set<string>();
  private seen = new Set<string>();
  private poll = 0;
  private appliedPoll = 0;
  private preferenceBaseline: PreferenceChoice[] = [];
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
  private update(
    change: Partial<typeof this.state>,
    generation = this.generation
  ) {
    if (!this.active || generation !== this.generation) return;
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.reset();
  }
  private reset() {
    this.generation++;
    this.identity = null;
    this.state = {
      types: [],
      error: "",
      preferenceError: "",
      saving: false,
      saved: false,
      credentials: null,
      feed: null,
      preferences: null,
    };
    this.preferenceBaseline = [];
    this.dismissed.clear();
    this.seen.clear();
  }
  async start() {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
    if (!this.active) return;
    try {
      await this.credentials(true);
      if (generation === this.generation && this.active) await this.refresh();
    } catch {
      update({ error: "Notifications unavailable. Try again." });
    }
  }
  async openFeed() {
    const generation = this.generation;
    await this.start();
    if (generation === this.generation && this.active && !this.state.error)
      await this.markSeen();
  }
  private async credentials(force = false) {
    const generation = this.generation;
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
          if (!this.active || generation !== this.generation) return;
          if (access.credentials.userId !== this.personId) {
            this.reset();
            this.update({ error: "Notifications unavailable. Try again." });
            throw new Error("Session changed");
          }
          this.update({ ...access, error: "" });
        })
        .finally(() => {
          if (generation === this.generation) this.identity = null;
        });
    }
    await this.identity;
    if (
      !this.active ||
      generation !== this.generation ||
      !this.state.credentials
    )
      throw new Error("Session changed");
    return this.state.credentials;
  }
  private async request<T>(
    path: (credentials: NotificationCredentials) => string,
    method?: string,
    body?: unknown
  ) {
    const generation = this.generation;
    const credentials = await this.credentials();
    if (generation !== this.generation || !this.active)
      throw new Error("Session changed");
    const result = await this.transport.request<T>(
      credentials,
      path(credentials),
      method,
      body
    );
    if (generation !== this.generation || !this.active)
      throw new Error("Session changed");
    return result;
  }
  async refresh() {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
    const poll = ++this.poll;
    try {
      const feed = await this.request<NotificationFeed>(
        (c) => `users/${c.userId}/feeds/${c.channelId}?status=unread`
      );
      if (
        generation !== this.generation ||
        !this.active ||
        poll < this.appliedPoll
      )
        return;
      this.appliedPoll = poll;
      const stale = feed.entries.filter((item) =>
        this.dismissed.has(item.id)
      ).length;
      update({
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
      update({ error: "Notifications unavailable. Try again." });
    }
  }
  async markSeen() {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
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
      if (generation !== this.generation || !this.active) return;
      ids.forEach((id) => this.seen.delete(id));
      update({ error: "Could not mark Notifications seen. Try again." });
    }
  }
  async read(id: string) {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
    try {
      await this.request(() => "messages/batch/read", "POST", {
        message_ids: [id],
      });
      if (generation !== this.generation || !this.active) return false;
      if (this.dismissed.has(id)) return true;
      this.dismissed.add(id);
      const feed = this.state.feed;
      if (feed)
        update({
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
      update({ error: "Could not dismiss Notification. Try again." });
      return false;
    }
  }
  async loadPreferences() {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
    try {
      await this.credentials(true);
      const saved = await this.request<PreferenceSet>(
        (c) => `users/${c.userId}/preferences/default`
      );
      if (generation !== this.generation || !this.active) return;
      this.preferenceBaseline = preferenceChoices(saved, this.state.types);
      update({
        preferences: this.preferenceBaseline,
        preferenceError: "",
        saved: false,
      });
    } catch {
      update({
        preferenceError: "Notification preferences unavailable. Try again.",
      });
    }
  }
  editPreferences(preferences: PreferenceChoice[]) {
    this.update({ preferences, saved: false });
  }
  async savePreferences() {
    const generation = this.generation;
    const update = (change: Partial<typeof this.state>) =>
      this.update(change, generation);
    if (!this.state.preferences || this.state.saving) return;
    const choices = this.state.preferences;
    update({ saving: true, preferenceError: "", saved: false });
    try {
      await this.request(
        (c) => `users/${c.userId}/preferences/default`,
        "PUT",
        {
          ...preferenceUpdate(choices, this.preferenceBaseline),
          __persistence_strategy__: "merge",
        }
      );
      if (generation !== this.generation || !this.active) return;
      this.preferenceBaseline = choices;
      update({ saved: true });
    } catch {
      update({
        preferenceError: "Could not save Notification preferences. Try again.",
      });
    } finally {
      update({ saving: false });
    }
  }
}
