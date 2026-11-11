import { useEffect, useState } from "react";
import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/knock.prototype";
import { credentials, currentUser, replies, triggerReply } from "~/lib/knock.prototype.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await currentUser(request);
  return Response.json({ user, credentials: await credentials(user.id), replies: replies(user.id) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await currentUser(request);
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new Response("Invalid origin", { status: 403 });
  }
  const form = await request.formData();
  try {
    return Response.json(await triggerReply(user.id, Number(form.get("replyId"))), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    // Avoid reflecting SDK request headers or other credential-bearing details.
    return Response.json({ error: "Knock trigger failed. Check the committed Development workflow and API logs." }, { status: 502 });
  }
}

type Feed = { entries: { id: string; read_at: string | null; seen_at: string | null; data: unknown }[];
  meta: { unread_count: number; unseen_count: number; total_count: number }; page_info: unknown };
type Data = { user: { id: number; name: string; role: string };
  credentials: { userId: string; publicKey: string; channelId: string | null; token: string };
  replies: { id: number; recipientId: number; recipientName: string; body: string }[] };

export default function KnockPrototype() {
  const data = useLoaderData() as Data;
  // A user switch unmounts all feed state and cancels the old user's requests.
  return <Spike key={data.credentials.userId + data.credentials.token} data={data} />;
}

function Spike({ data }: { data: Data }) {
  const result = useActionData();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [preferences, setPreferences] = useState<unknown>(null);
  const [status, setStatus] = useState("Ready");
  const [controller] = useState(() => new AbortController());
  const auth = data.credentials;
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`https://api.knock.app/v1/${path}`, {
      method, signal: controller.signal,
      headers: { Authorization: `Bearer ${auth.publicKey}`, "X-Knock-User-Token": auth.token,
        "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(`Knock ${response.status}: ${value.code ?? "request failed"}`);
    return value;
  }
  async function refresh() {
    if (auth.channelId) setFeed(await api(`users/${auth.userId}/feeds/${auth.channelId}`));
    setPreferences(await api(`users/${auth.userId}/preferences/default`));
  }
  async function run(operation: () => Promise<void>) {
    try { await operation(); setStatus("Complete"); }
    catch (error) { if (!controller.signal.aborted) setStatus(String(error)); }
  }
  useEffect(() => {
    void run(refresh);
    return () => controller.abort();
  }, []);
  async function preference(enabled: boolean) {
    await api(`users/${auth.userId}/preferences/default`, "PUT", {
      __persistence_strategy__: "merge",
      categories: { "new-enrollment": { channel_types: { in_app_feed: enabled, email: false, push: false } } },
    });
    await refresh();
  }
  return <main className="p-8 space-y-5">
    <h1 className="text-2xl font-bold">Knock vendor-fit prototype — throwaway</h1>
    <p>Can Knock authenticate the selected Cadence user, deliver a Discussion Reply Notification,
      expose feed state, and store category × channel preferences? This is a live Development spike.</p>
    <p>Selected: {data.user.name} ({data.user.id}, {data.user.role}). Authentication: server-signed RS256, 15-minute expiry.</p>
    {!auth.channelId && <p>Run the dashboard wizard to set KNOCK_FEED_CHANNEL_ID, then restart the server.</p>}
    <p>Walkthrough: select an Instructor with a Discussion Reply → replay it → switch to the named recipient in DevUI → refresh → mark seen, then read.</p>
    <Form method="post" className="flex gap-3">
      <select name="replyId" aria-label="Discussion Reply">
        {data.replies.map(r => <option key={r.id} value={r.id}>Discussion Reply {r.id} → {r.recipientName} ({r.recipientId})</option>)}
      </select>
      <button disabled={!data.replies.length} className="border p-2">Replay Discussion Reply via Node SDK</button>
    </Form>
    <p>One trigger per existing Discussion Reply (stable idempotency key). App data stays unchanged.</p>
    <pre>{JSON.stringify(result, null, 2)}</pre>
    <button className="border p-2" onClick={() => void run(refresh)}>Refresh feed and preferences</button>
    <p role="status">{status}</p>
    <h2>Feed state — unread: {feed?.meta.unread_count ?? "—"}, unseen: {feed?.meta.unseen_count ?? "—"}</h2>
    {feed?.entries.map(item => <article key={item.id} className="border p-3 space-x-3">
      <pre>{JSON.stringify(item, null, 2)}</pre>
      {(["seen", "read"] as const).map(state => <button className="border p-2" key={state}
        onClick={() => void run(async () => { await api(`messages/${item.id}/${state}`, "PUT"); await refresh(); })}>
        Mark {state}
      </button>)}
    </article>)}
    <h2>New Enrollment → Instructor preferences</h2>
    <p>These buttons write an explicit category baseline for the selected user and opt them into its feed channel.
      They do not configure the environment default or prove delivery suppression; those checks remain required.</p>
    <button className="border p-2" onClick={() => void run(() => preference(false))}>Set category channels off</button>{" "}
    <button className="border p-2" onClick={() => void run(() => preference(true))}>Opt into feed only</button>
    <pre>{JSON.stringify(preferences, null, 2)}</pre>
    <details><summary>Full feed response</summary><pre>{JSON.stringify(feed, null, 2)}</pre></details>
  </main>;
}
