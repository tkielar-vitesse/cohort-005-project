# Knock vendor-fit spike (throwaway)

Question: [Does Knock hold up against Cadence?](https://github.com/tkielar-vitesse/cohort-005-project/issues/29)

This branch is an integration prototype for the Notifications wayfinding map. Do not merge it into production. **Verdict: all four vendor-fit checks pass; confirm Knock.**

## Run

1. Keep the provisioned Development credentials in ignored `.env`.
2. In Git Bash, run `bash reports/knock-feed-setup.sh` (local, ephemeral wizard). It captures `KNOCK_FEED_CHANNEL_ID` and walks through creating and committing the feed-only `cadence-prototype-discussion-reply` workflow. That workflow has one in-app feed step rendering `{{ data.body }}` and optionally using `{{ data.url }}` for its click action. No email or push steps.
3. Run `npm run prototype:knock` and open `/dashboard`. Select Sarah Chen in DevUI, then visit `/prototype/knock`.
4. Replay Sarah's existing Discussion Reply to Emma Wilson. This sends a real Development Notification through the Node SDK without inserting or editing app records. The trigger has a stable per-reply idempotency key. Replays use current stored reply content; this does not implement real-time comment events.
5. Switch to Emma Wilson in DevUI. Verify only her feed appears, refresh for asynchronous delivery, then mark the item seen and read. Watch the full response and unread/unseen counts.
6. Explore the explicit New Enrollment category preference buttons. They merge preferences and let the selected user opt into the feed while keeping email/push off.

Only the public key, user ID and a 15-minute signed user token reach the browser. Secret and signing keys stay in the `.server` module. The route and its action reject production mode; the local command binds loopback. Loaders/actions authenticate from the existing session, and the trigger derives its recipient from the stored Discussion Question. It rejects self-notifications and checks that the selected user authored the stored Discussion Reply. This prototype inherits the app's development session mechanism; it does not replace production login.

## Evidence (2026-11-11)

The developer completed channel/workflow provisioning and committed the New Enrollment category assignment during the live exchange. [Captured live API evidence](knock-verification.json) includes completed workflow runs, preference evaluation events, message IDs and feed/count changes.

| Required check | Result |
| --- | --- |
| Signed user authentication and DevUI switching | Pass: the selected Cadence session determines the RS256 subject; authenticated users get distinct feeds; cross-user feed reads and message writes return 403. |
| Node SDK trigger of a catalogue Notification | Pass: replaying Sarah's existing Discussion Reply through the app action delivers to its Discussion Question author. A fresh replay to user `6` grows that user's feed from one item to two. |
| Headless feed API | Pass: signed public-key requests list items and metadata; mark seen changes unseen count `2 → 1` while unread stays `2`; mark read changes unread `2 → 1`. |
| Category × channel preferences with default-off and opt-in | Pass: initialize an isolated Instructor with New Enrollment feed/email/push off; a completed workflow suppresses delivery with `opted_out_of_categories`; signed feed-only opt-in delivers an item tagged `new-enrollment`; opting out again suppresses delivery while preserving the old item. An unrelated Discussion Reply workflow still delivers. |

The preference spike uses **explicit initialization at first recipient sync**, not an environment default: the first `users.update` includes the category baseline; later syncs omit that baseline and preserve the user's opt-in. This proves vendor support for the required behavior. Production synchronization and initialization must be designed before implementation; do not blindly reset preferences on every sync or let a first trigger race ahead of initialization. Knock's unspecified preferences default to enabled.

Run `node scripts/knock-preferences.prototype.mjs` to repeat the preference sequence against a fresh isolated Development recipient. It requires an active, committed, feed-only `cadence-prototype-new-enrollment` workflow with category `new-enrollment`, using the same feed channel and `{{ data.body }}` content. It waits for completed workflow runs and checks preference evaluation reasons, rather than inferring suppression from an empty feed alone. Recipients have no email/phone, and remain in Development for inspection.

Initial setup exposed an uncommitted workflow category change: runtime messages reported `categories: []` and were delivered despite the stored category opt-out. Once the developer committed the assignment, the complete off/on/off sequence passed. This was configuration, not a vendor capability failure. Future setup checks must inspect the committed category, not only the draft visible in the dashboard.

Earlier authentication/provisioning checks:

- Switching the real DevUI session endpoint between Sarah and Emma produces RS256 tokens with subjects `2` and `5`, respectively. Each token is accepted by Knock's user endpoint (404 because these app users have not yet been identified in Knock). The Sarah token requesting Emma's endpoint is rejected with 403. This proves session-bound signing and token acceptance, not a populated feed switch.
- The loader response contains neither the server API key nor the signing key.
- An isolated throwaway Development recipient successfully round-trips category × channel preferences using the public key and signed token: `new-enrollment` has feed/email/push all false, then feed true with email/push still false. Both writes and reads return 200. The isolated recipient is left in Development for inspection; it has no email or phone number.
- `npm run typecheck` passes.
- `npm run test`: 806 pass, four fail. Two pre-existing request-logger tests invoke `/bin/sh`, unavailable on this Windows host; the same failures appear again under an existing `.worktrees/notification-delivery` checkout.
- Wizard Bash syntax passes under Git Bash; shellcheck is unavailable. The developer completed the interactive wizard.

## Boundaries of this decision

- This confirms Knock for the four checks in the decision ticket. It does not implement production Notifications.
- Feed appearance, final channel choices, delivery retries/storage, recipient sync and production preference UX remain separate map decisions.
- No email delivery or browser push was tested or provisioned here; those are outside this spike's acceptance checks.

Keep the prototype on its throwaway branch as the primary source; open no implementation PR from it. Courier fallback is not needed: no vendor capability check failed.

## Sources

- [Signed user authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- [Headless feed setup and channel ID location](https://docs.knock.app/in-app-ui/react/headless/feed)
- [User, feed and preference API](https://docs.knock.app/api-reference/users)
- [Read and seen message operations](https://docs.knock.app/api-reference/messages)
- [Category preferences and environment defaults](https://docs.knock.app/preferences/overview)
- [Workflow design](https://docs.knock.app/designing-workflows/overview), [in-app templates](https://docs.knock.app/integrations/in-app/feeds), [committing workflow changes](https://docs.knock.app/version-control/commits)
