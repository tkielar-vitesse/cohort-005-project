import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { Bell, X } from "lucide-react";
import { NotificationSession } from "~/lib/notification-session";
import {
  notificationDestination,
  notificationTypes,
  type NotificationItem,
} from "~/lib/notifications";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";

const NotificationsContext = createContext<NotificationSession | null>(null);
export function NotificationsProvider({
  personId,
  children,
}: {
  personId: number;
  children: ReactNode;
}) {
  const [session] = useState(() => new NotificationSession(String(personId)));
  useLayoutEffect(() => {
    session.activate();
    void session.start();
    const interval = setInterval(() => {
      void session.refresh();
    }, 15000);
    return () => {
      clearInterval(interval);
      session.dispose();
    };
  }, [session]);
  return (
    <NotificationsContext.Provider value={session}>
      {children}
    </NotificationsContext.Provider>
  );
}
function useNotifications() {
  const session = useContext(NotificationsContext);
  if (!session) throw new Error("Notifications require a current person");
  return [
    session,
    useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot),
  ] as const;
}
function title(item: NotificationItem) {
  return (
    notificationTypes.find((type) => type.key === item.source?.key)?.label ??
    item.data?.title ??
    "Notification"
  );
}
export function NotificationBell() {
  const [session, state] = useNotifications();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const count = state.feed?.meta.unread_count;
  const entries = state.feed?.entries ?? [];
  useEffect(() => {
    if (open) void session.openFeed();
  }, [open, session]);
  useEffect(() => {
    if (open && !state.error) void session.markSeen();
  }, [open, state.feed, session]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function read(item: NotificationItem, follow: boolean) {
    if (busy) return;
    setBusy(item.id);
    const success = await session.read(item.id);
    setBusy(null);
    const destination = notificationDestination(item.data?.url);
    if (success && follow && destination) {
      setOpen(false);
      navigate(destination);
    }
  }
  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        aria-label={`Notifications, ${count === undefined ? (state.error ? "unavailable" : "loading unread count") : `${count} unread`}`}
        aria-expanded={open}
        aria-controls="notification-feed"
        onClick={() => setOpen(!open)}
      >
        <Bell className="size-4" /> Notifications{" "}
        <span
          aria-hidden="true"
          className="rounded-full bg-primary px-2 text-primary-foreground"
        >
          {count === undefined
            ? state.error
              ? "!"
              : "…"
            : count > 99
              ? "99+"
              : count}
        </span>
      </button>
      {open && (
        <>
          <button
            aria-label="Close Notifications"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <section
            id="notification-feed"
            aria-label="Notifications"
            className="absolute right-0 top-12 z-40 max-h-[75vh] w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-background shadow-xl"
          >
            <header className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold">Notifications</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close Notifications"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </header>
            {state.error && (
              <div role="alert" className="p-4 text-sm">
                <p>{state.error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    void session.openFeed();
                  }}
                >
                  Retry
                </Button>
              </div>
            )}
            {!state.feed && !state.error && (
              <p className="p-8 text-sm">Loading Notifications…</p>
            )}
            {state.feed && !state.error && !entries.length && (
              <p className="p-8 text-center">You’re all caught up</p>
            )}
            {entries.map((item) => (
              <article
                key={item.id}
                className="flex gap-2 border-b bg-primary/5 p-4"
              >
                <button
                  disabled={!!busy || !notificationDestination(item.data?.url)}
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    void read(item, true);
                  }}
                >
                  <p className="text-sm font-semibold">{title(item)}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                    {item.data?.body ??
                      item.data?.courseTitle ??
                      "An update is available in Cadence."}
                  </p>
                  <time
                    className="mt-2 block text-xs text-muted-foreground"
                    dateTime={item.inserted_at}
                  >
                    {new Date(item.inserted_at).toLocaleString()}
                  </time>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!!busy}
                  aria-label={`Dismiss ${title(item)} Notification`}
                  onClick={() => {
                    void read(item, false);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </article>
            ))}
            {count !== undefined && count > entries.length && (
              <p className="p-3 text-xs text-muted-foreground">
                Showing {entries.length} of {count} unread Notifications.
                Dismiss Notifications to see more.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export function NotificationPreferences() {
  const [session, state] = useNotifications();
  useEffect(() => {
    void session.loadPreferences();
  }, [session]);
  return (
    <Card className="mt-8 max-w-2xl" id="notifications">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Your choices apply across courses and teams.
        </p>
      </CardHeader>
      <CardContent>
        {state.preferenceError && (
          <div role="alert">
            <p>{state.preferenceError}</p>
            <Button
              variant="outline"
              onClick={() => {
                void session.loadPreferences();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {!state.preferences && !state.preferenceError && (
          <p>Loading Notification preferences…</p>
        )}
        {state.preferences && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void session.savePreferences();
            }}
            className="space-y-4"
          >
            {state.preferences.map((choice) => {
              const type = state.types.find((type) => type.key === choice.key);
              if (!type) return null;
              return (
                <fieldset
                  disabled={state.saving}
                  key={choice.key}
                  className="space-y-2 border-b pb-4"
                >
                  <legend className="text-sm font-semibold">
                    {type.label}
                  </legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={choice.receive}
                      onChange={(event) =>
                        session.editPreferences(
                          (state.preferences ?? []).map((value) =>
                            value.key === choice.key
                              ? { ...value, receive: event.target.checked }
                              : value
                          )
                        )
                      }
                    />
                    Receive notifications
                  </label>
                  {type.email && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={choice.email}
                        disabled={!choice.receive}
                        onChange={(event) =>
                          session.editPreferences(
                            (state.preferences ?? []).map((value) =>
                              value.key === choice.key
                                ? { ...value, email: event.target.checked }
                                : value
                            )
                          )
                        }
                      />
                      Email
                    </label>
                  )}
                </fieldset>
              );
            })}
            <Button type="submit" disabled={state.saving}>
              {state.saving ? "Saving…" : "Save Notification preferences"}
            </Button>
            {state.saved && (
              <p role="status">Notification preferences saved.</p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
