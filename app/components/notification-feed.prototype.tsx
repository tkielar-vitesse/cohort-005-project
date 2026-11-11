// THROWAWAY: three Notification Feed layouts in the real app shell, ?variant=A|B|C.
// Shared real Knock state; presentation only differs. Never merge as production code.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCheck,
  MessageSquare,
  X,
} from "lucide-react";
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
const variants = ["A", "B", "C"];
const names = ["Header popover", "Slide-over panel", "Persistent column"];

export function NotificationFeedPrototype({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  const [params] = useSearchParams();
  if (!import.meta.env.DEV || !variants.includes(params.get("variant") ?? ""))
    return children;
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
  const [params, setParams] = useSearchParams();
  const variant = params.get("variant") ?? "A";
  const [context, setContext] = useState<Context | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replayResult, setReplayResult] = useState("");
  const visible = variant === "C" || open;

  useEffect(() => {
    const controller = new AbortController();
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
    return () => controller.abort();
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
        `users/${userId}/feeds/${channelId}`,
        "GET",
        undefined,
        signal
      );
      if (!signal?.aborted) {
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

  const shown =
    feed?.entries.filter((item) => !unreadOnly || !item.read_at) ?? [];
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
      if (!(event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      event.preventDefault();
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(
            "variant",
            variants[
              (variants.indexOf(variant) +
                (event.key === "ArrowRight" ? 1 : 2)) %
                3
            ]
          );
          return next;
        },
        { replace: true }
      );
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [variant, setParams]);

  async function mark(ids: string[], state: "read" | "unread") {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api(`messages/batch/${state}`, "POST", { message_ids: ids });
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
      destination.searchParams.set("variant", variant);
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
      aria-label={`Notification Feed, ${badge} unread`}
      aria-expanded={visible}
      onClick={() => setOpen(!open)}
      className="relative flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm shadow-sm"
    >
      <Bell className="size-4" />{" "}
      {variant === "B" ? "Notification Feed" : "Notifications"}
      {badge > 0 && (
        <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
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
            {badge} unread · {context?.user.name ?? "Loading identity…"}
          </p>
        </div>
        {variant !== "C" && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close Notification Feed"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        )}
      </header>
      <div className="flex items-center justify-between gap-2 border-b p-3 text-xs">
        <div className="flex gap-1">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              onClick={() => setUnreadOnly(value)}
              aria-pressed={unreadOnly === value}
              className={`rounded px-3 py-1 ${unreadOnly === value ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {value ? "Unread" : "All"}
            </button>
          ))}
        </div>
        <button
          disabled={busy || !shown.some((item) => !item.read_at)}
          onClick={() =>
            void mark(
              shown.filter((item) => !item.read_at).map((item) => item.id),
              "read"
            )
          }
          className="flex items-center gap-1 disabled:opacity-40"
        >
          <CheckCheck className="size-4" /> Read displayed
        </button>
      </div>
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
            <p className="font-medium">
              {unreadOnly ? "You’re all caught up" : "No Notifications yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {unreadOnly
                ? "Read Notifications are in All."
                : "Updates that concern you will appear here."}
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
              <div className="mt-2 flex items-center justify-between text-xs">
                <button
                  disabled={busy}
                  className="underline underline-offset-4"
                  onClick={() =>
                    void mark([item.id], item.read_at ? "unread" : "read")
                  }
                >
                  Mark {item.read_at ? "unread" : "read"}
                </button>
                {!item.read_at && (
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-primary" />
                    Unread
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {feed && feed.meta.total_count > feed.entries.length && (
        <p className="border-t p-3 text-xs text-muted-foreground">
          Showing the latest {feed.entries.length} of {feed.meta.total_count}.
          Older history is outside this sketch.
        </p>
      )}
    </section>
  );

  return (
    <div className="min-h-full pb-28">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-sm text-muted-foreground">Cadence</span>
        {variant !== "C" ? (
          trigger
        ) : (
          <span className="text-sm">Notification Feed · {badge} unread</span>
        )}
      </div>
      {variant === "A" && open && (
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
      )}
      {variant === "A" && open && (
        <div className="fixed right-4 top-16 z-40 w-[min(420px,calc(100vw-2rem))]">
          {panel}
        </div>
      )}
      {variant === "B" && open && (
        <div
          className="fixed inset-0 z-30 bg-black/25"
          onClick={() => setOpen(false)}
        />
      )}
      {variant === "B" && open && (
        <div
          role="region"
          aria-label="Notification side panel"
          className="fixed inset-y-4 right-4 z-40 w-[min(480px,calc(100vw-2rem))]"
        >
          {panel}
        </div>
      )}
      {variant === "C" ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>{children}</div>
          <aside className="p-4 xl:sticky xl:top-0">{panel}</aside>
        </div>
      ) : (
        children
      )}
      <details className="mx-6 mb-4 rounded border border-dashed p-3 text-xs">
        <summary>Prototype controls and live Knock state</summary>
        <p className="my-3">
          Throwaway Development prototype. Opening the feed marks displayed
          items seen; unread counts remain until you click a destination or mark
          read. Read and seen changes persist in Knock. Polls every 5 seconds.
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
          recipient in DevUI. Each stored reply has one stable replay key;
          previously replayed replies will not create duplicates.
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
              variant,
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
      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-3 py-2 text-background shadow-xl">
        <button
          aria-label="Previous variant"
          onClick={() =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set(
                  "variant",
                  variants[(variants.indexOf(variant) + 2) % 3]
                );
                return next;
              },
              { replace: true }
            )
          }
        >
          <ArrowLeft className="size-5" />
        </button>
        <span className="whitespace-nowrap text-xs">
          PROTOTYPE · {variant} · {names[variants.indexOf(variant)]}
        </span>
        <button
          aria-label="Next variant"
          onClick={() =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set(
                  "variant",
                  variants[(variants.indexOf(variant) + 1) % 3]
                );
                return next;
              },
              { replace: true }
            )
          }
        >
          <ArrowRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
