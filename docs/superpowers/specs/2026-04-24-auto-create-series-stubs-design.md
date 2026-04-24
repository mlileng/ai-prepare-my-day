# Design: Auto-Create Series Stubs for Recurring Unmatched Meetings

**Date:** 2026-04-24
**Status:** Approved

## Overview

When a calendar event is recurring (has an `RRULE` in the ICS data) and does not match any existing meeting series, the sync pipeline currently creates only an instance file with an empty `series` field. This design adds automatic creation of a stub series file for those events, so future occurrences link correctly from the start.

Non-recurring events (one-off meetings) are unaffected — they continue to produce an instance file only.

---

## Architecture

Three files change; no new modules introduced.

### `src/calendar/parser.js`

Add `isRecurring` to the `CalendarEvent` typedef and output:

```js
results.push({
  uid:          event.uid,
  title:        getTitle(event.summary),
  isRecurring:  !!event.rrule,   // NEW
  start:        eventStart,
  // ...rest unchanged
});
```

`event.rrule` is already present on the raw node-ical component for recurring events; this surfaces it without any parsing logic.

### `src/meetings/obsidian.js`

Add a new exported function:

```js
export async function createMeetingSeries(vaultPath, event, date, seriesSlug)
```

Behaviour:
- Checks if `meetings/series/{seriesSlug}.md` already exists — returns the vault-relative path immediately if so (idempotent).
- Creates `meetings/series/` if it does not exist.
- Writes a full-skeleton series file (see format below).
- Returns `meetings/series/{seriesSlug}.md` (vault-relative).

### `src/meetings/reconciler.js`

In the unmatched branch (`match.type === 'none'`), add:

```js
if (event.isRecurring) {
  await createMeetingSeries(vaultPath, event, date, seriesSlug);
  seriesId = `meetings/series/${seriesSlug}.md`;
}
```

`seriesId` is then passed to `createMeetingInstance()` as before, so the instance frontmatter links to the new series file.

Update `printSummary` to report auto-created series stubs:

```
Meetings: 1 matched, 0 fuzzy matched, 2 created (1 series stub auto-created)
```

---

## Series Stub Format

File: `meetings/series/{slug}.md`

```markdown
---
type: meeting-series
name: "B2B Internal Update"
status: recurring
priority: ""
cadence: "Recurring"
participants: []
organizations: []
initiatives: []
created: 2026-04-24
last_edited: 2026-04-24
tags: [meeting-series]
---

## Purpose

*(to be filled in)*

## Participants

*(to be filled in)*
```

Fields match the hand-crafted series file format exactly. Fields that cannot be auto-populated (`priority`, `participants`, `organizations`, `initiatives`, `## Purpose`) are left blank or with placeholder text for manual completion.

---

## Data Flow

```
parseEvents()          → CalendarEvent { isRecurring: true/false, ... }
reconcileMeetings()    → for unmatched recurring event:
                           createMeetingSeries()   → meetings/series/{slug}.md
                           createMeetingInstance() → meetings/instances/{date}-{slug}.md
                                                     (series frontmatter points to new series)
```

---

## Idempotency

- `createMeetingSeries()` checks file existence before writing — safe to call on re-runs.
- `createMeetingInstance()` already has the same guard.
- If the series file already exists (created manually or by a prior run), it is not overwritten.

---

## Existing Instance Without Series Link

Today's `b2b-internal-update` instance was created before this feature existed, with an empty `series` field. It stays as-is — it is already in the cache, so the reconciler will not touch it on the same day. On the next occurrence of the meeting, the reconciler will find the new series file via title matching and create a properly linked instance.

---

## Error Handling

Consistent with the existing fail-fast design. If `meetings/series/` cannot be created or written to, the error propagates immediately.

---

## Testing

New tests in `tests/meetings-obsidian.test.js`:
- `createMeetingSeries` creates the file with correct frontmatter when it does not exist
- `createMeetingSeries` is idempotent (does not overwrite an existing file)
- `createMeetingSeries` returns the correct vault-relative path

New test in `tests/calendar/parser.test.js` (or a new file if it does not exist):
- `isRecurring` is `true` for events with `rrule`
- `isRecurring` is `false` for events without `rrule`

Updated integration test in `tests/meetings-reconciler.test.js` (new file):
- Unmatched recurring event creates both a series stub and a linked instance
- Unmatched non-recurring event creates only an instance (no series file)

---

## Out of Scope

- Retroactively updating existing instance files that were created without a series link
- Populating `participants`, `organizations`, or `initiatives` from ICS attendee data
- Updating `last_edited` on subsequent runs
- Any changes to the daily note format or daily module
