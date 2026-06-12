# Recurrence Exception Handling Design

**Date:** 2026-06-12
**Status:** Approved

## Problem

When a single occurrence of a recurring meeting is rescheduled or renamed in Outlook (a "recurrence exception"), the ICS feed contains two VEVENTs with the same UID:

1. The **series master** — has `RRULE`, no `RECURRENCE-ID`
2. The **exception** — has `RECURRENCE-ID`, no `RRULE`, different `SUMMARY` and/or `DTSTART`

`node-ical` keys parsed events by UID, so whichever VEVENT appears last in the feed overwrites the other. In practice the series master survives and the exception is silently lost. The sync then expands the RRULE and creates an instance for the original series title and time, completely ignoring the renamed/rescheduled occurrence.

**Observed case:** "Q3 Plan Read Out" is an exception of the "Monthly Brief Prep Meeting" series (moved from 11:00 to 09:00 Eastern, renamed). The exception was lost; only "Monthly Brief Prep Meeting" appeared in today's daily note.

## Approach

Pre-parse the raw ICS text for RECURRENCE-ID exceptions before `node-ical` loses them, inject them into the parsed data under composite keys, and suppress the corresponding RRULE-expanded occurrence for the same date.

## Changes

All changes are in `src/calendar/` — nothing outside this module is affected.

### 1. `src/calendar/fetcher.js` — return raw text alongside parsed data

Change `fetchCalendar()` to fetch the URL with the native `fetch` API, parse it with `ical.parseICS(text)` (synchronous), and return `{ data, rawText }`.

```js
export async function fetchCalendar(url) {
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw new Error(`Calendar feed unreachable: ${err.message}`);
  }
  const data = ical.parseICS(text);
  return { data, rawText: text };
}
```

Return type changes from `Promise<Record<string, any>>` to `Promise<{ data: Record<string, any>, rawText: string }>`.

### 2. `src/calendar/index.js` — destructure new return value

```js
const { data: calendarData, rawText } = await fetchCalendar(icsUrl);
const events = parseEvents(calendarData, { userEmail, suppressedMeetings, timezone, rawText });
```

No other changes in this file.

### 3. `src/calendar/parser.js` — extract and inject exceptions, suppress RRULE collisions

#### New function: `extractRecurrenceExceptions(rawText)`

Splits the raw ICS on `BEGIN:VEVENT` / `END:VEVENT` boundaries. For each block that contains a `RECURRENCE-ID` line:

- Extracts: `UID`, `RECURRENCE-ID` (value + optional `TZID`), `DTSTART` (value + optional `TZID`), `DTEND` (value + optional `TZID`), `SUMMARY`, `STATUS`
- Constructs a minimal event object matching the shape node-ical produces
- Keys it as `uid + ':recurrence:' + recurrenceIdValue`

Returns a map of `{ [compositeKey]: eventObject }`.

#### Modified: `parseEvents(calendarData, options)`

- Accepts `rawText` in options
- Calls `extractRecurrenceExceptions(rawText)` and merges results into a working copy of `calendarData`
- Before RRULE expansion, builds a `Set<string>` of dates covered by exceptions for each UID: `exceptionDatesByUid` (date strings in `YYYYMMDD` format)
- After expanding a recurring event, filters out instances whose date appears in `exceptionDatesByUid[event.uid]`
- Exception events (composite-keyed) have no `rrule`, so they flow through the non-recurring path and are checked against today's boundary normally

## Data Flow

```
fetch(url)
  → rawText
    → ical.parseICS(rawText)    → calendarData (exceptions overwritten)
    → extractRecurrenceExceptions(rawText) → exceptions map
  → merge into workingData
  → parseEvents(workingData)
    → for each VEVENT:
        if rrule → expand → filter out exception dates → build CalendarEvents
        else     → check today boundary → build CalendarEvent
```

## What Does Not Change

- All existing filters (CANCELLED, title prefix, suppression list, all-day, DECLINED, solo) apply to exception events identically
- Cache, matcher, reconciler, daily page — untouched
- No new dependencies
