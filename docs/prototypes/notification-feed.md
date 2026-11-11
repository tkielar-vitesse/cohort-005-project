# Notification Feed UI prototype — throwaway

Question: [What does the Notification Feed look like in Cadence?](https://github.com/tkielar-vitesse/cohort-005-project/issues/27).

Chosen layout: **A — header popover**, inside the existing Cadence shell, alongside the actual page data. The original comparison is preserved at commit `998ac91`:

- A: header bell/popover; compact, keeps the page visible.
- B: header entry/slide-over; wider reading surface with a backdrop.
- C: persistent right column; keeps Notifications alongside the page (below it at narrower widths).

## Run and review

Run `npm run prototype:notifications` with the already-provisioned Knock Development credentials in ignored `.env`. Open `/dashboard?variant=A` and select a user in DevUI. Only the selected layout is active now; the alternatives and switcher remain in the earlier commit. This is a development-only prototype; the API rejects production and the prototype does not render in production.

Select Emma Wilson or James Park for existing real Discussion Reply Notifications. Sarah Chen has an empty feed and two stored Discussion Replies available in the expandable prototype controls. Those controls can replay existing replies through the committed feed-only Knock workflow; switch to the named recipient to see delivery. Each replay click uses a fresh event key and creates a new Development Notification, including after an earlier replay was read or dismissed. This restores the same helper used by the earlier vendor-fit spike. It writes no Cadence database records and sends no email or push.

The popover uses the real headless feed and signed session identity. There are no simulated feed items. Polling is every five seconds. Only the public key and a short-lived signed user token reach the browser. Credentials refresh every ten minutes, ahead of the fifteen-minute token expiry. DevUI identity changes clear the old feed and cancel pending polling requests.

Behavior chosen in the human review:

- Badge counts **unread**, capped visually at 99+, and remains visible at zero (loading displays an ellipsis). Seen does not clear it.
- Opening the popover marks the displayed rows seen. They remain unread. Closing the popover does not dismiss its Notifications.
- Row click marks read and navigates to its stored local Cadence destination. Read failures leave the row in place and surface an error.
- Show **unread Notifications only**, with no All/Unread tabs or read-history view. Fetch using Knock's `status=unread` filter so read history cannot crowd unread rows off the first page ([API reference](https://docs.knock.app/api-reference/users)).
- Each row has a cross to dismiss it. Dismissal marks it **read** in Knock and removes it from the UI after the write succeeds; it is not deletion or archival. A failed write keeps the Notification visible. Confirmed dismissals are protected from stale in-flight polls.
- No separate mark read/unread or bulk-read controls in this chosen sketch.
- Empty/loading/error states and real read/seen/count state remain available in the prototype controls.
- This sketch shows the first unread page only. Dismissing rows refreshes the unread page to bring in the next items; a note indicates any additional unread Notifications.

Read/seen changes persist in Knock Development. This deliberately overrides the prototype skill's default in-memory state to answer the ticket's explicit real-vendor question. This UI does not change delivery or preferences.

## Verification on 2026-11-11

- `npm run typecheck`: passes.
- `npm run test`: 806 pass, four fail. Two pre-existing request-logger tests call `/bin/sh`, unavailable on Windows; both are also discovered in `.worktrees/notification-delivery`.
- Actual session-switch endpoint → prototype loader → signed Knock feed GET: Sarah Chen, Emma Wilson and James Park all return 200. Feed totals are 0, 1 and 2 respectively. Existing entries contain real bodies and local lesson destinations. Sarah has two replayable stored Discussion Replies; Emma has one.
- Initial server rendering of `/dashboard?variant=A` returned 200 and included the prototype for all three selected identities.
- Browser host unavailable. No visual inspection or browser interaction is claimed. Client click/keyboard/read/seen behavior still needs human review.
- After the chosen-layout update: typecheck passes; tests remain 806 passing with the same four Windows shell failures. Live signed API verification temporarily marked an already-read Emma Notification unread, verified `status=unread` returned it, marked it read through the dismissal endpoint, and verified it disappeared from the unread result and the badge returned to zero. Its original read state was restored. Server rendering returns 200 with the selected unread prototype. This verifies the vendor operations, not a browser click.

## Replay repair verification

The original replay key was fixed per stored Discussion Reply. Knock therefore reused an already-read Notification, which the chosen unread-only Feed correctly hid. Replays now use a fresh UUID per explicit click. Live verification replayed the same stored Sarah Chen Discussion Reply twice: Emma Wilson’s unread count increased from 0 to 2. Both fresh Notifications were left unread for human review. Typecheck passes; tests remain 806 passing and four existing Windows shell failures. No browser verification is claimed.

## Decision status

Final human review accepted the updated prototype: “This looks good now.” The popover title and accessibility labels use **Notifications**, the popover omits the selected person's name, and the header button always shows the unread-count badge. These final presentation changes are captured in commit `5590e2b`.

Human verdict: “Use prototype A, but add cross icons to remove notifications. Do not divide between all and unread. Make it unread notifications only and then mark them as read and remove from the UI after dismissing.” This resolves the layout and dismissal decision. Row navigation and opening/seen behavior remain as proposed above.

Keep this on `prototype/notification-feed`, do not merge, and open no implementation PR. The wayfinder destination is a PRD; production implementation belongs after that handoff.
