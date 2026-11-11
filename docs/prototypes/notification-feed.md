# Notification Feed UI prototype — throwaway

Question: [What does the Notification Feed look like in Cadence?](https://github.com/tkielar-vitesse/cohort-005-project/issues/27).

Three layouts inside the existing Cadence shell, alongside the actual page data:

- A: header bell/popover; compact, keeps the page visible.
- B: header entry/slide-over; wider reading surface with a backdrop.
- C: persistent right column; keeps Notifications alongside the page (below it at narrower widths).

## Run and review

Run `npm run prototype:notifications` with the already-provisioned Knock Development credentials in ignored `.env`. Open `/dashboard?variant=A` and select a user in DevUI. The bottom arrows (or keyboard left/right outside editable controls) switch variants. The URL preserves the selected variant on refresh. This is a development-only prototype; the API rejects production and the switcher does not render in production.

Select Emma Wilson or James Park for existing real Discussion Reply Notifications. Sarah Chen has an empty feed and two stored Discussion Replies available in the expandable prototype controls. Those controls can replay existing replies through the committed feed-only Knock workflow; switch to the named recipient to see delivery. Replay is idempotent per stored reply. This restores the same helper used by the earlier vendor-fit spike. It writes no Cadence database records and sends no email or push.

All layouts use the same real headless feed and signed session identity. There are no simulated feed items. Polling is every five seconds. Only the public key and a short-lived signed user token reach the browser. DevUI identity changes clear the old feed and cancel pending polling requests.

Proposed behavior to judge:

- Badge counts **unread**, capped visually at 99+. Seen does not clear it.
- Opening A/B or displaying C marks the displayed rows seen. They remain unread.
- Row click marks read and navigates to its stored local Cadence destination. Read failures leave the row in place and surface an error.
- Explicit mark read/unread on each row; All/Unread filter; bulk action applies to displayed rows only.
- All layouts have empty/loading/error states and expose real read/seen/count state in the prototype controls.
- This sketch shows the first vendor page only. It labels truncated history rather than claiming to mark the entire feed read.

Read/seen changes persist in Knock Development. This deliberately overrides the prototype skill's default in-memory state to answer the ticket's explicit real-vendor question. Presentation variants do not change delivery or preferences.

## Verification on 2026-11-11

- `npm run typecheck`: passes.
- `npm run test`: 806 pass, four fail. Two pre-existing request-logger tests call `/bin/sh`, unavailable on Windows; both are also discovered in `.worktrees/notification-delivery`.
- Actual session-switch endpoint → prototype loader → signed Knock feed GET: Sarah Chen, Emma Wilson and James Park all return 200. Feed totals are 0, 1 and 2 respectively. Existing entries contain real bodies and local lesson destinations. Sarah has two replayable stored Discussion Replies; Emma has one.
- Server rendering of `/dashboard?variant=A` returns 200 and includes the prototype switcher for all three selected identities.
- Browser host unavailable. No visual inspection or browser interaction is claimed. Client click/keyboard/read/seen behavior still needs human review.

## Decision status

Awaiting live human review. Compare placement and page density, unread count semantics, opening-versus-reading behavior, row density, and destination behavior. The decision ticket remains open; no winning layout or final product behavior has been chosen. Keep this on `prototype/notification-feed`, do not merge, and open no implementation PR. The wayfinder destination is a PRD; production implementation belongs after that handoff.
