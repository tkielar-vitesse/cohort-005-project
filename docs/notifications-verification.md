# Development Notification verification

Tracking: [spec #36](https://github.com/tkielar-vitesse/cohort-005-project/issues/36), [verification #44](https://github.com/tkielar-vitesse/cohort-005-project/issues/44). Further hosted and browser verification is **pending at the user's request**. These instructions are a resume checklist, not evidence of a successful run. Do not close either issue on the strength of local tests.

## Evidence as of 2026-11-11

| Area                                              | Observed                                                                                                                                                                                                                                                                                                                                     | Still pending                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local domain, worker, adapter and state contracts | Migrated SQLite tests cover all seven types, atomic intents, actor exclusions, immutable retries, session identity and controlled Feed/preferences responses. See the seam map below.                                                                                                                                                        | Hosted delivery and rendered interactions are separate checks.                                                                                                                                                                                                              |
| Configuration                                     | The Development configuration apply loop completed for all seven workflows and environment defaults. A separate committed GET confirmed `cadence-refund-approved` active.                                                                                                                                                                    | A complete readback of all seven active committed resources, categories, channel coverage, preference overrides and defaults. The initial inspection stopped because GET returned an unwrapped resource; the inspector now accepts both shapes. No email previews were run. |
| Restricted access                                 | Earlier deliberate checks: missing/invalid session 401; people 1 and 2 own Feed 200, cross-person Feed 403; own preferences 200, cross-person preferences 403; profile write 403; unsigned Feed 400. Sanitized local evidence: `.outbox/notification-access-evidence.json` in the primary checkout (ignored, not distributed with the repo). | Repeat after configuration/auth changes; real DevUI switching, sign-out, expired credentials and late browser responses.                                                                                                                                                    |
| Sandbox semantics                                 | One isolated recipient (`990001`) received a Feed item with per-trigger `sandbox_mode: true` through the older prototype Feed-only workflow. The final adapter always uses this setting.                                                                                                                                                     | This does **not** prove final workflows, final defaults, opt-in, or any email rendering/delivery.                                                                                                                                                                           |
| Final hosted behavior                             | No complete final seven-type delivery/default/opt-in/email evidence recorded.                                                                                                                                                                                                                                                                | Every matrix row below, persistent read/count state, stored-destination authorization and all five email previews.                                                                                                                                                          |
| Browser                                           | Browser host was unavailable during implementation.                                                                                                                                                                                                                                                                                          | Entire rendered UI checklist below.                                                                                                                                                                                                                                         |
| Prototype cleanup                                 | `app/` inspection found no Notification prototype/replay/first-sync initialization references. Refund routes/services have no direct outcome or request-acknowledgement email calls; unrelated transactional transport remains. Throwaway branches remain separate.                                                                          | Repeat source inspection when integration changes.                                                                                                                                                                                                                          |

Local verification in the isolated `implement/notifications-44` worktree on 2026-11-11: `npm run typecheck` passed, followed by `npm run test` with no `.env` and all `KNOCK_*` process variables removed. Result: 484 passed, 2 failed of 486 tests (23 passing files, one failing file). Both failures are the existing Windows `spawnSync /bin/sh ENOENT` cases in `request-logger/agents.test.ts` at lines 1087 and 1118; they are unrelated to Notifications. Offline configuration CLI smoke checks (`--help` and `--preview` without `--live`) printed usage and exited successfully without requests. No further hosted or browser checks were performed.

Trigger acceptance means Cadence persisted a workflow-run ID and stopped retrying. It does not establish Feed/email delivery. Stable idempotency keys reduce duplicates without an exactly-once guarantee. Do not replay retained terminal submissions to make a verification run pass.

## Local checks, without credentials

Use a checkout with dependencies installed and **no `.env` file**. Do not run the app, worker or configuration command with `--live` during these checks. In PowerShell, remove Knock variables only from this shell before running:

```powershell
Get-ChildItem Env:KNOCK_* | Remove-Item
npm run typecheck
npm run test
```

The ordinary suite uses migrated in-memory SQLite and controlled external adapters/SDK stubs. It needs no hosted service. Removing process variables alone is insufficient if `.env` is present, because the runtime adapter reads that file. Use a clean worktree rather than moving or printing a credential file.

| Approved public seam                                                 | Local evidence                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raiseRefundRequest`, `approveRefundRequest`, `declineRefundRequest` | `app/lib/refunds.server.test.ts`: every current Platform Admin, buyer exclusion, Individual Purchase and Team Licence decisions, repeated/ineligible transitions, transaction rollback, privacy and retained snapshots.                                                             |
| `purchaseCourse`, `purchaseTeamLicence`, `createEnrollment`          | `app/lib/purchases.server.test.ts`: Individual Purchase Enrollment, no Enrollment for Team Licence alone, fresh Lapsed Enrollment, self-exclusion, retained progress, rollback and later outage.                                                                                    |
| `redeemSeat`                                                         | `app/lib/seats.server.test.ts`: owner targeting, separate Seat/Enrollment intents even for one recipient, remaining Seats, ineligible/repeated claims, rollback and later outage.                                                                                                   |
| `createDiscussionComment` and lesson/Instructor actions              | `app/lib/discussions.server.test.ts`, `app/lib/discussion-actions.test.ts`: Discussion Questions, Platform Admin authors, exact top-level author for replies, both action entry points, self-exclusion, Instructor top-level comments, edits/deletions and rollback.                |
| `processNextNotification`, `getNotificationSubmissions`              | `app/lib/notification-submissions.server.test.ts`: claims/recovery, fresh profile, immutable requests/keys, transient/invalid/ambiguous outcomes, increasing delay and shared exact 23-hour cutoff.                                                                                 |
| Cadence Knock adapter, session-derived opening                       | `app/lib/knock.server.test.ts`, `app/lib/notifications.server.test.ts`: SDK translation, sandbox setting, restricted signed claims, identity and missing/deleted session rejection.                                                                                                 |
| Notification session and preference contracts                        | `app/lib/notification-session.test.ts`, `app/lib/notifications.test.ts`: stale responses, failed read/save, seen versus read, dismissal/count refresh, credential refresh, capability union and unrelated preference preservation. Node state tests do not prove browser rendering. |

## Configuration prerequisites and resume commands

Keep credentials in ignored `.env` or environment variables. Runtime requires `KNOCK_ENVIRONMENT=development`, a Development `KNOCK_SECRET_API_KEY` (`sk_test_`), `KNOCK_PUBLIC_API_KEY`, RS256 `KNOCK_SIGNING_KEY`, and `KNOCK_FEED_CHANNEL_ID`. Set `CADENCE_APP_ORIGIN` to the actual Development origin, for example `http://127.0.0.1:5173`; it is captured in committed event payloads. Configuration inspection/apply also requires `KNOCK_SERVICE_TOKEN` (`knock_st_`) with access to this Development environment. Never paste keys, tokens, signing material or channel settings into evidence.

Create/select the in-app Feed and Knock built-in test email channel (`email_knock_limited`) in the same hosted application. Production email providers, DNS, custom sender identities, production provisioning and browser push are outside scope. The test channel owns its fixed sender. Keep seeded email identities unchanged.

The following command is safe offline and prints usage without reading `.env` or making requests:

```powershell
npx tsx scripts/configure-notifications.ts --help
```

**Only when hosted work is resumed**, inspect first. `--live` explicitly enables management requests. Inspect uses committed resources (`hide_uncommitted_changes=true`), prints catalogue-only defaults and selected non-secret workflow metadata, and accepts raw or wrapped workflow responses. Omitted `override_preferences`/`is_commercial` settings mean false; omitted categories mean an empty list. It does not assert hosted delivery.

```powershell
npx tsx scripts/configure-notifications.ts --live
```

Compare every row with this contract: all seven workflows active, each with the configured Feed step; email step only for approved, declined, opened, Discussion Question and Discussion Reply; no categories introducing hidden suppression; `override_preferences=false`, `is_commercial=false`; six environment-default Feed types on, Enrollment off; email default on for the five supported types and off for Seat/Enrollment. Verify the selected channel IDs/keys in the Development dashboard, including any filters/conditions not printed by the inspector. Do not infer effective delivery from a draft, an omitted field, or the existence of a workflow.

Only if the committed configuration needs correction, deliberately apply and then re-inspect:

```powershell
npx tsx scripts/configure-notifications.ts --live --apply
npx tsx scripts/configure-notifications.ts --live
```

`--apply` changes and activates all seven workflows and merges catalogue entries into environment defaults; it never writes recipient baselines. Review existing workflows before applying because it replaces their definitions. Recipient preferences must survive identification/profile refresh and environment-default changes. Workflow categories currently use an empty list; preferences use person-wide workflow channel-type choices.

For synthetic template-render requests only (no trigger or delivery):

```powershell
npx tsx scripts/configure-notifications.ts --live --preview
```

The command requests all five previews and reports successful API responses; it does not save or visually inspect rendered HTML. Inspect each rendered template in Knock's Development workflow editor/preview and capture sanitized evidence separately. Use real test course/lesson IDs when following preview links: synthetic examples are presentation fixtures.

Start the application and worker only after reviewing isolated fixtures and pending obligations:

```powershell
npm run db:migrate
npm run dev
```

In another terminal, from the same checkout/database:

```powershell
npm run notifications:worker -- --once
# Or, after reviewing all due obligations:
npm run notifications:worker
```

`--once` processes at most one due obligation; it is not scoped to a test recipient. Check `getNotificationSubmissions(db)` before running against an existing database. See [worker operations](notifications-worker.md) for claims, retries and cutoff behavior. Do not reseed a database whose state matters. Do not call workflow triggers directly as a substitute for the real domain action matrix below.

## Isolated domain-to-Feed matrix

Prepare a disposable Development database and unique test cohort: two Students A/B, Instructor I owning course C, Team Admin T owning a Team Licence, at least two current Platform Admins P/Q, and an overlapping Instructor/Team Admin. Use their **actual numeric Cadence person IDs as string Knock IDs**, never alternate email IDs or prototype recipients. Record the IDs locally without credentials. Start with new recipients with no preference baseline to test environment defaults; opening Notifications must only identify current name/email. Coordinate country/PPP, refund window and watched limits so fixtures satisfy existing rules.

For each action, record source/event/submission IDs, expected/excluded recipient IDs, acceptance/run IDs, actual Feed item IDs and count deltas, destination, preference state and time. Wait for worker acceptance and hosted Feed results separately. Poll for a bounded interval (for example 60 seconds); retain pending/error evidence instead of claiming success on timeout.

| Type / real public operation                                               | Fixture and exact recipient assertions                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refund Request approved / `approveRefundRequest` via Platform Admin review | A raises an eligible request on an Individual Purchase; P approves with optional note. Only buyer A receives the decision. Repeat with T's Team Licence. Verify course/Purchase/approval wording, optional decision note in Cadence, no payout claim. Repeating/failed decisions add nothing.                                                                                                                                                                           |
| Refund Request declined / `declineRefundRequest` via review                | Q declines another request with a note. Only its buyer receives the decision; Enrollment/Seats remain, ask-again behavior works. Repeat with Team Licence. A self-decision by a Platform Admin buyer produces no self Notification.                                                                                                                                                                                                                                     |
| New Open Refund Request / `raiseRefundRequest` via buyer action            | Every current Platform Admin P/Q receives one, buyer receives no acknowledgement. When a Platform Admin is buyer exclude that actor. Promote another person after commit: they get no old event. Another admin's later decision does not remove the earlier unread item.                                                                                                                                                                                                |
| Seat claimed / `redeemSeat` via `/redeem/:code`                            | B claims one of T's Seats. Only owner T receives Seat claimed with correct remaining Seats; another Team Admin gets none. A distinct Enrollment intent targets I. Repeat/held/refunded/already-enrolled/country-rejected claims add nothing.                                                                                                                                                                                                                            |
| New Enrollment / `purchaseCourse` / `createEnrollment`                     | A new Individual Purchase creates one Instructor I intent. Fresh recipient with no preferences: accepted trigger yields no Enrollment Feed item by environment default. Explicitly opt I in, save, then a different Student purchase yields one Feed item. Repeat through Seat redemption; Team Licence purchase alone yields none. After a legitimate lapse, a new Enrollment is a distinct event preserving progress. I's own Enrollment yields no self Notification. |
| New Discussion Question / `createDiscussionComment` via lesson             | A asks a top-level comment on C's lesson: only I receives it. Repeat as Platform Admin P: still I. I's own top-level comment yields none. Snippet and authenticated lesson destination are correct.                                                                                                                                                                                                                                                                     |
| New Discussion Reply / both lesson and `/instructor/questions` actions     | A owns a top-level Discussion Question; B replies via lesson and I via Instructor questions on separate events. Only A receives each; no other participants/followers. A's self-reply and a reply to I's top-level comment yield none. Edit/delete adds no event.                                                                                                                                                                                                       |

For each of the six default-on types: fresh recipient gets Feed; Receive off suppresses Feed and email; Receive on with Email off retains Feed for supported types. Repeat mutable outcomes and New Open Refund Request controls explicitly. For Enrollment: verify suppression **before any recipient save**, then explicit opt-in, reload, identify/profile edit, and a further event. For overlapping capabilities show all eligible controls together, with no Email control for Enrollment/Seat claimed. Create an unrelated preference first and confirm every Save preserves it. Verify profile/role changes use the same ID and preserve preferences/Feed rather than reinitializing them.

Keep `sandbox_mode: true` for triggers, including this matrix. This preserves Feed processing while preventing actual external email sends; earlier isolated prototype evidence supports only that vendor semantic. The final adapter enforces it. Do not remove it for verification. No actual email delivery is authorized by this checklist; a separately authorized account-member mailbox override and isolated Development test path would be needed for that optional check, without changing seeded identities.

## Browser and authorization checklist

Use actual DevUI selection and the running application. Capture sanitized screenshots/results, never Authorization headers or signed tokens. Use browser request blocking or a controlled unavailable service for failure cases; record how failures were induced.

- [ ] Without a selected person, `/api/notifications` rejects with 401 and no credentials. Invalid/deleted selection also rejects. Select A and a valid country in the floating DevUI; do not mistake the known session 401 for a provider outage.
- [ ] With signed A credentials, own Feed/preferences reads and writes work. Cross-person Feed/preferences reads **and writes** fail; client profile writes fail. Unsigned/malformed/expired credentials fail. Decode claims locally only: string A subject, short expiry, explicit Feed/preference grants, no broad/profile grants. Retain statuses only.
- [ ] Bell badge remains visible at zero, shows ellipsis while loading and 99+ cap. Popover title is Notifications, accessible labels work, and no person's name/history tabs/bulk-read controls appear.
- [ ] Loading, unavailable with retry, and caught-up are distinct. Identification/Feed failures leave Cadence usable and never appear caught up.
- [ ] Opening marks displayed unread items seen without reading. Closing/reopening preserves unread rows/count. Compare hosted read/seen state, then reload to prove persistence.
- [ ] Cross dismiss marks read and removes only after success without navigation. Body click marks read and navigates to stored Cadence destination only after success. Failed writes retain the row/count with retryable error. Slow polling cannot resurrect a confirmed dismissal.
- [ ] Create more unread items than one page. Dismiss visible items and confirm further unread items appear and count remains accurate across reloads.
- [ ] Settings shows the capability union, Receive and supported Email controls, explicit Save and honest success/error feedback. Failed Save keeps edits without success. Reload successful choices and verify hosted channel behavior with new events, preserving unrelated settings.
- [ ] Delay A's Feed, preferences and Save responses, then switch to B through DevUI. No A rows/preferences/credentials may appear in B's session or be restored by late responses. Repeat sign-out while requests are pending; ensure cached state clears. Switch back and verify A's persisted state.
- [ ] Wait for credential expiry/refresh (tokens last 15 minutes), including a switch during refresh. New credentials must follow the current session; failed refresh shows unavailable, without old-identity data.
- [ ] Reload after dismissal/body navigation: count/read state persists. Change source access or remove content after an intent commits, process it, then follow its stored destination. Current authenticated routes deny or show unavailable content; historical targeting grants no access. Test lesson Enrollment/PPP loss and Platform Admin review after role loss.

## Five email previews

Inspect approved, declined, New Open Refund Request, Discussion Question and Discussion Reply in the built-in test channel. For each, record workflow SHA, preview time, subject, sanitized rendered screenshot and resolved action/Settings URLs. Check HTML and plain text: Cadence wordmark, concise summary, exactly one primary action, Notification preferences footer, configured absolute origin, and no full discussion body, refund reason or decision note. Approval identifies course/Purchase/amount and describes a decision without asserting returned money. Decline identifies course/Purchase. The Feed must explain the ability to ask again; including this in the email is optional. New Open Refund Request identifies buyer/course/amount/Purchase. Discussion summaries identify actor/course/lesson. Outcome actions go to `/settings`, open requests to `/admin/refunds`, discussions to the existing lesson route; all require ordinary authentication. Confirm Seat/Enrollment workflows have no email step.

## Recording completion

Add dated observations to the evidence table only after performing each check. Keep committed configuration evidence, domain acceptance, hosted Feed delivery, browser behavior and email preview evidence distinct. Leave failures and unperformed checks marked pending, with reproduction details. Prototype opt-in/read-state evidence used a self-initialized baseline and cannot prove final defaults or email. Further hosted work remains pending until resumed; no production readiness or actual email delivery is claimed.
