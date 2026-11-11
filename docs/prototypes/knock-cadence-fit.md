# Knock vendor-fit spike (throwaway)

Question: [Does Knock hold up against Cadence?](https://github.com/tkielar-vitesse/cohort-005-project/issues/29)

This branch is an integration prototype for the Notifications wayfinding map. Do not merge it into production. No vendor confirmation has been made.

## Run

1. Keep the provisioned Development credentials in ignored `.env`.
2. In Git Bash, run `bash reports/knock-feed-setup.sh` (local, ephemeral wizard). It captures `KNOCK_FEED_CHANNEL_ID` and walks through creating and committing the feed-only `cadence-prototype-discussion-reply` workflow. That workflow has one in-app feed step rendering `{{ data.body }}` and optionally using `{{ data.url }}` for its click action. No email or push steps.
3. Run `npm run prototype:knock` and open `/dashboard`. Select Sarah Chen in DevUI, then visit `/prototype/knock`.
4. Replay Sarah's existing Discussion Reply to Emma Wilson. This sends a real Development Notification through the Node SDK without inserting or editing app records. The trigger has a stable per-reply idempotency key. Replays use current stored reply content; this does not implement real-time comment events.
5. Switch to Emma Wilson in DevUI. Verify only her feed appears, refresh for asynchronous delivery, then mark the item seen and read. Watch the full response and unread/unseen counts.
6. Explore the explicit New Enrollment category preference buttons. They merge preferences and let the selected user opt into the feed while keeping email/push off.

Only the public key, user ID and a 15-minute signed user token reach the browser. Secret and signing keys stay in the `.server` module. The route and its action reject production mode; the local command binds loopback. Loaders/actions authenticate from the existing session, and the trigger derives its recipient from the stored Discussion Question. It rejects self-notifications and checks that the selected user authored the stored Discussion Reply. This prototype inherits the app's development session mechanism; it does not replace production login.

## Evidence (2026-11-11)

- Switching the real DevUI session endpoint between Sarah and Emma produces RS256 tokens with subjects `2` and `5`, respectively. Each token is accepted by Knock's user endpoint (404 because these app users have not yet been identified in Knock). The Sarah token requesting Emma's endpoint is rejected with 403. This proves session-bound signing and token acceptance, not a populated feed switch.
- The loader response contains neither the server API key nor the signing key.
- An isolated throwaway Development recipient successfully round-trips category × channel preferences using the public key and signed token: `new-enrollment` has feed/email/push all false, then feed true with email/push still false. Both writes and reads return 200. The isolated recipient is left in Development for inspection; it has no email or phone number.
- `npm run typecheck` passes.
- `npm run test`: 806 pass, four fail. Two pre-existing request-logger tests invoke `/bin/sh`, unavailable on this Windows host; the same failures appear again under an existing `.worktrees/notification-delivery` checkout.
- Wizard Bash syntax passes under Git Bash; shellcheck is unavailable. The interactive wizard has not been run by the agent.

## Still required before resolving the decision

- Dashboard channel/workflow provisioning: browser automation is unavailable in this session, and the existing runtime API key cannot configure workflows.
- Trigger the real catalogue Notification through the SDK, wait for delivery, and verify the recipient's feed rather than treating trigger acceptance as delivery.
- Exercise headless feed listing, unread count and seen/read writes against that delivered item, with signed public authentication. Verify switching users displays different feeds.
- Establish an environment default (or an explicit application initialization rule) with New Enrollment category channels off, then demonstrate the default, opt-in override and effective workflow delivery/suppression. The preference API round-trip alone does not prove default-off enforcement. Use a separate Development New Enrollment workflow with the matching category if testing delivery.
- Human interaction/review of this prototype, required by the wayfinder prototype ticket type.

Provisioning/access gaps are inconclusive, not a failed vendor check. Keep Knock provisional and the ticket open. If a completed check exposes a vendor capability failure, reopen the vendor choice and evaluate Courier as specified in the decision ticket.

## Sources

- [Signed user authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- [Headless feed setup and channel ID location](https://docs.knock.app/in-app-ui/react/headless/feed)
- [User, feed and preference API](https://docs.knock.app/api-reference/users)
- [Read and seen message operations](https://docs.knock.app/api-reference/messages)
- [Category preferences and environment defaults](https://docs.knock.app/preferences/overview)
- [Workflow design](https://docs.knock.app/designing-workflows/overview), [in-app templates](https://docs.knock.app/integrations/in-app/feeds), [committing workflow changes](https://docs.knock.app/version-control/commits)
