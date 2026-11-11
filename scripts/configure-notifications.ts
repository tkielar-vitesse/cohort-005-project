// Deliberate Development-only configuration, never part of the app or test startup.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { notificationTypes } from "../app/lib/notifications";

const env = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
if (env.KNOCK_ENVIRONMENT !== "development") {
  throw new Error(
    "Notification configuration requires KNOCK_ENVIRONMENT=development"
  );
}
if (!env.KNOCK_SERVICE_TOKEN?.startsWith("knock_st_")) {
  throw new Error("Add KNOCK_SERVICE_TOKEN to ignored .env (never commit it)");
}
const apply = process.argv.includes("--apply");
const origin = new URL(env.CADENCE_APP_ORIGIN ?? "http://localhost:5173")
  .origin;

async function management(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://control.knock.app/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.KNOCK_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Do not print response bodies: channel settings can contain secrets.
    throw new Error(
      `Knock management ${method} ${path.split("?")[0]}: HTTP ${response.status}`
    );
  }
  return response.status === 204 ? {} : response.json();
}

const channels = await management(
  "/channels?limit=100&include[]=environment_settings"
);
const feed = channels.entries.find(
  (c: { id: string; type: string }) =>
    c.id === env.KNOCK_FEED_CHANNEL_ID && c.type === "in_app_feed"
);
const email = channels.entries.find(
  (c: { provider: string; type: string; archived_at: string | null }) =>
    c.type === "email" && c.provider === "email_knock_limited" && !c.archived_at
);
if (!feed || !email)
  throw new Error(
    "Configure an in-app Feed and the built-in Knock test email channel first"
  );

// No sender override: Knock's built-in test channel owns its fixed sender.
const emailTemplate = {
  subject: "{{ data.email_subject }}",
  settings: { layout_key: null },
  html_body:
    '<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,sans-serif;color:#292524"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff"><p style="font-size:24px;font-weight:bold">Cadence</p><p>{{ data.email_summary | escape }}</p><p style="margin:28px 0"><a style="background:#292524;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px" href="{{ data.action_url | escape }}">Open Cadence</a></p><hr><p style="font-size:12px"><a href="{{ data.settings_url | escape }}">Notification preferences</a></p></main></body></html>',
  text_body:
    "Cadence\n\n{{ data.email_summary }}\n\nOpen Cadence: {{ data.action_url }}\n\nNotification preferences: {{ data.settings_url }}",
};
const previewSummaries: Record<string, string> = {
  "cadence-refund-approved":
    "Your Refund Request for TypeScript Fundamentals, Purchase #123 ($49.00), was approved. This confirms the decision; it does not confirm money has been returned.",
  "cadence-refund-declined":
    "Your Refund Request for TypeScript Fundamentals, Purchase #123, was declined. Read the decision in Cadence; you can ask again.",
  "cadence-refund-opened":
    "Sarah Chen raised a Refund Request for TypeScript Fundamentals, Purchase #123 ($49.00).",
  "cadence-discussion-question":
    "Sarah Chen asked a Discussion Question in TypeScript Fundamentals, lesson Getting started.",
  "cadence-discussion-reply":
    "Emma Wilson posted a Discussion Reply in TypeScript Fundamentals, lesson Getting started.",
};

if (apply) {
  // Read/merge existing environment choices; never write recipient baselines.
  const current = await management("/environments/development/defaults");
  const preferences = current.preference_set ?? {};
  const workflows = { ...preferences.workflows };
  for (const type of notificationTypes) {
    workflows[type.key] = {
      channel_types: {
        in_app_feed: type.defaultOn,
        email: type.email && type.defaultOn,
      },
    };
  }
  await management("/environments/development/defaults", "PUT", {
    preference_set: { ...preferences, workflows },
  });
  for (const type of notificationTypes) {
    const steps: unknown[] = [
      {
        type: "channel",
        ref: "feed",
        channel_key: feed.key,
        channel_type: "in_app_feed",
        template: {
          markdown_body: "{{ data.body }}",
          action_url: "{{ data.url }}",
        },
      },
    ];
    if (type.email)
      steps.push({
        type: "channel",
        ref: "email",
        channel_key: email.key,
        channel_type: "email",
        template: emailTemplate,
      });
    await management(
      `/workflows/${type.key}?environment=development&commit=true&commit_message=Cadence+Development+Notifications`,
      "PUT",
      {
        workflow: {
          name: type.label,
          categories: [],
          steps,
          trigger_frequency: "every_trigger",
          settings: { override_preferences: false, is_commercial: false },
        },
      }
    );
    await management(
      `/workflows/${type.key}/activate?environment=development`,
      "PUT",
      { status: true }
    );
  }
}

// Inspect committed resources, not drafts. Print only non-secret evidence.
const defaults = await management(
  "/environments/development/defaults?hide_uncommitted_changes=true"
);
console.log(
  JSON.stringify(
    {
      environment: "development",
      mode: apply ? "applied" : "inspect",
      defaults: defaults.preference_set,
    },
    null,
    2
  )
);
for (const type of notificationTypes) {
  const result = await management(
    `/workflows/${type.key}?environment=development&hide_uncommitted_changes=true`
  );
  const workflow = result.workflow ?? result;
  console.log(
    JSON.stringify({
      key: type.key,
      active: workflow.active,
      sha: workflow.sha,
      categories: workflow.categories,
      settings: workflow.settings,
      steps: workflow.steps.map(
        (s: { ref: string; channel_key: string; channel_type: string }) => ({
          ref: s.ref,
          channel: s.channel_key,
          type: s.channel_type,
        })
      ),
    })
  );
  if (process.argv.includes("--preview") && type.email) {
    const data = {
      body: "Feed details stay in Cadence.",
      url: "/settings",
      email_subject: type.label,
      email_summary: previewSummaries[type.key],
      action_url: `${origin}${type.key === "cadence-refund-opened" ? "/admin/refunds" : type.key.startsWith("cadence-discussion") ? "/courses/typescript-fundamentals/lessons/1" : "/settings"}`,
      settings_url: `${origin}/settings`,
    };
    await management(
      `/workflows/${type.key}/steps/email/preview_template?environment=development`,
      "POST",
      {
        recipient: {
          id: "cadence-template-preview",
          name: "Development preview",
          email: "preview@example.invalid",
        },
        data,
      }
    );
    console.log(`${type.key}: email template preview rendered (no delivery)`);
  }
}
