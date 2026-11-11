import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** Capture links at commit time, alongside the event's text. */
export function notificationData(
  input: {
    title: string;
    body: string;
    url: string;
    emailSummary: string;
    emailSubject: string;
  },
  appOrigin?: string
): Record<string, unknown> {
  let configuredOrigin: string | undefined;
  try {
    configuredOrigin = parseEnv(
      readFileSync(".env", "utf8")
    ).CADENCE_APP_ORIGIN;
  } catch {}
  const origin = new URL(
    appOrigin ??
      process.env.CADENCE_APP_ORIGIN ??
      configuredOrigin ??
      "http://localhost:5173"
  ).origin;
  return {
    title: input.title,
    body: input.body,
    url: input.url,
    email_summary: input.emailSummary,
    email_subject: input.emailSubject,
    action_url: `${origin}${input.url}`,
    settings_url: `${origin}/settings`,
  };
}
