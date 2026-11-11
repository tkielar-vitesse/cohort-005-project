// THROWAWAY: chosen header popover with unread-only dismissals, ?variant=A.
// Earlier layout alternatives are captured in commit 998ac91. Never merge as production code.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bell, MessageSquare, X } from "lucide-react";
import { Button } from "~/components/ui/button";

type Auth = {
  userId: string;
  publicKey: string;
  channelId: string | null;
  token: string;
};
type Context = {
  user: { name: string };
  credentials: Auth;
  replies: {
    id: number;
    recipientId: number;
    recipientName: string;
    body: string;
  }[];
};
type Item = {
  id: string;
  read_at: string | null;
  seen_at: string | null;
  inserted_at: string;
  data: { body?: string; url?: string; courseTitle?: string };
  source?: { key?: string };
  actors?: { name?: string }[];
};
type Feed = {
  entries: Item[];
  meta: { unread_count: number; unseen_count: number; total_count: number };
};

export function NotificationFeedPrototype({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  const [params] = useSearchParams();
  if (!import.meta.env.DEV || params.get("variant") !== "A") return children;
  return (
    <Prototype key={userId} userId={userId}>
      {children}
    </Prototype>
  );
}

function Prototype({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [context, setContext] = useState<Context | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replayResult, setReplayResult] = useState("");
  const dismissedIds = useRef(new Set<string>());
  const visible = open;

  useEffect(() => {
    const controller = new AbortController();
    const loadIdentity = () =>
      fetch("/api/notification-prototype", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Feed setup failed (${response.status}). Check Development credentials.`
            );
          setContext(await response.json());
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(String(e));
        });
    void loadIdentity();
    // Renew before the signed feed token's 15-minute expiry during long reviews.
    const interval = setInterval(loadIdentity, 10 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [userId]);

  const api = useCallback(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal
    ) => {
      if (!context) throw new Error("Loading identity");
      const auth = context.credentials;
      const response = await fetch(`https://api.knock.app/v1/${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${auth.publicKey}`,
          "X-Knock-User-Token": auth.token,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          `Knock ${response.status}. Refresh the page if the 15-minute token expired.`
        );
      return response.json();
    },
    [context]
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!context) return;
      const { userId, channelId } = context.credentials;
      if (!channelId)
        throw new Error(
          "KNOCK_FEED_CHANNEL_ID is missing; restart after setting it."
        );
      const next = await api(
        `users/${userId}/feeds/${channelId}?status=unread`,
        "GET",
        undefined,
        signal
      );
      if (!signal?.aborted) {
        // A poll started before dismissal must not put confirmed reads back.
        const stale = next.entries.filter((item: Item) =>
          dismissedIds.current.has(item.id)
        );
        next.entries = next.entries.filter(
          (item: Item) => !dismissedIds.current.has(item.id)
        );
        next.meta.unread_count = Math.max(
          0,
          next.meta.unread_count - stale.length
        );
        setFeed(next);
        setError("");
      }
    },
    [context, api]
  );

  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    const load = () =>
      refresh(controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    void load();
    const interval = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [context, refresh]);

  const shown = feed?.entries.filter((item) => !item.read_at) ?? [];
  const unseenIds = visible
    ? shown
        .filter((item) => !item.seen_at)
        .map((item) => item.id)
        .join(",")
    : "";
  useEffect(() => {
    if (!unseenIds) return;
    const controller = new AbortController();
    void api(
      "messages/batch/seen",
      "POST",
      { message_ids: unseenIds.split(",") },
      controller.signal
    )
      .then(() => refresh(controller.signal))
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [unseenIds, api, refresh]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  async function dismiss(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api("messages/batch/read", "POST", { message_ids: ids });
      ids.forEach((id) => dismissedIds.current.add(id));
      // Remove only after Knock confirms the read; retain the row on failure.
      setFeed(
        (previous) =>
          previous && {
            ...previous,
            entries: previous.entries.filter((item) => !ids.includes(item.id)),
            meta: {
              ...previous.meta,
              unread_count: Math.max(
                0,
                previous.meta.unread_count - ids.length
              ),
            },
          }
      );
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function follow(item: Item) {
    // Only local Cadence destinations; old spike items can lack a URL.
    const url = item.data?.url;
    if (
      !url ||
      !url.startsWith("/") ||
      url.startsWith("//") ||
      url.includes("\\")
    )
      return;
    setBusy(true);
    try {
      await api("messages/batch/read", "POST", { message_ids: [item.id] });
      await refresh();
      setOpen(false);
      const destination = new URL(url, window.location.origin);
      destination.searchParams.set("variant", "A");
      navigate(destination.pathname + destination.search + destination.hash);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const badge = feed?.meta.unread_count ?? 0;
  const trigger = (
    <button
      aria-label={`Notification Feed, ${feed ? `${badge} unread` : "loading unread count"}`}
      aria-expanded={visible}
      onClick={() => setOpen(!open)}
      className="relative flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm shadow-sm"
    >
      <Bell className="size-4" /> Notifications
      <span
        aria-hidden="true"
        className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground"
      >
        {!feed ? "…" : badge > 99 ? "99+" : badge}
      </span>
    </button>
  );

  const panel = (
    <section
      aria-label="Notification Feed"
      className="flex max-h-[75vh] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
    >
      <header className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-semibold">Notification Feed</h2>
          <p className="text-xs text-muted-foreground">
            {badge} unread
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close Notification Feed"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="overflow-y-auto">
        {error && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {!feed && !error && (
          <p className="p-8 text-sm text-muted-foreground">
            Loading Notifications…
          </p>
        )}
        {feed && !shown.length && (
          <div className="space-y-2 p-10 text-center">
            <Bell className="mx-auto size-6 text-muted-foreground" />
            <p className="font-medium">You’re all caught up</p>
            <p className="text-sm text-muted-foreground">
              New Notifications will appear here.
            </p>
          </div>
        )}
        {shown.map((item) => (
          <article
            key={item.id}
            className={`flex gap-3 border-b p-4 ${item.read_at ? "" : "bg-primary/5"}`}
          >
            <div className="mt-1 rounded-full bg-muted p-2 h-fit">
              <MessageSquare className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <button
                disabled={busy || !item.data?.url}
                onClick={() => void follow(item)}
                className="w-full text-left disabled:cursor-default"
              >
                <p
                  className={`text-sm ${item.read_at ? "font-normal" : "font-semibold"}`}
                >
                  {item.source?.key?.includes("enrollment")
                    ? "New Enrollment"
                    : "Discussion Reply"}
                </p>
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
            </div>
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={`Dismiss ${item.source?.key?.includes("enrollment") ? "New Enrollment" : "Discussion Reply"} Notification`}
              title="Dismiss Notification"
              onClick={() => void dismiss([item.id])}
            >
              <X className="size-4" />
            </Button>
          </article>
        ))}
      </div>
      {feed && feed.meta.unread_count > shown.length && (
        <p className="border-t p-3 text-xs text-muted-foreground">
          Showing {shown.length} of {feed.meta.unread_count} unread
          Notifications. Dismiss Notifications to see the next unread items.
        </p>
      )}
    </section>
  );

  return (
    <div className="min-h-full pb-28">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-sm text-muted-foreground">Cadence</span>
        {trigger}
      </div>
      {open && (
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div className="fixed right-4 top-16 z-40 w-[min(420px,calc(100vw-2rem))]">
          {panel}
        </div>
      )}
      {children}
      <details className="mx-6 mb-4 rounded border border-dashed p-3 text-xs">
        <summary>Prototype controls and live Knock state</summary>
        <p className="my-3">
          Throwaway Development prototype. Opening the feed marks displayed
          items seen; unread counts remain until you click a destination or
          dismiss a Notification with its cross. Dismissing marks it read in
          Knock and removes it from this unread-only feed. Read and seen changes
          persist in Knock. Polls every 5 seconds.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh().catch((e) => setError(String(e)))}
        >
          Refresh
        </Button>
        <p className="my-3">
          Replay an existing Discussion Reply, then switch to its author’s
          recipient in DevUI. Each click creates a fresh Development
          Notification, even if you already dismissed an earlier replay.
        </p>
        {context?.replies.map((reply) => (
          <button
            key={reply.id}
            disabled={busy}
            className="m-1 rounded border p-2 text-left"
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch("/api/notification-prototype", {
                  method: "POST",
                  body: new URLSearchParams({ replyId: String(reply.id) }),
                });
                if (!response.ok)
                  throw new Error(
                    "Replay failed. Check the Development workflow."
                  );
                setReplayResult(
                  `Replayed. Switch to ${reply.recipientName} in DevUI to inspect delivery.`
                );
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Replay Discussion Reply → {reply.recipientName}:{" "}
            {reply.body.slice(0, 50)}
          </button>
        ))}
        <p role="status">{replayResult}</p>
        <pre className="mt-3 max-h-48 overflow-auto">
          {JSON.stringify(
            {
              variant: "A",
              userId,
              unread: feed?.meta.unread_count,
              unseen: feed?.meta.unseen_count,
              entries: feed?.entries.map((item) => ({
                id: item.id,
                seen: !!item.seen_at,
                read: !!item.read_at,
                url: item.data?.url,
              })),
            },
            null,
            2
          )}
        </pre>
      </details>
      <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs text-background shadow-xl">
        PROTOTYPE · A · Unread Notifications
      </div>
    </div>
  );
}
