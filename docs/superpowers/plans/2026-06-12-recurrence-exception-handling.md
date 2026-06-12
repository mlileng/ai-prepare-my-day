# Recurrence Exception Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the silent loss of rescheduled/renamed recurring meeting exceptions (RECURRENCE-ID events) caused by node-ical's UID-keyed map overwriting them with the series master.

**Architecture:** Pre-parse the raw ICS text for RECURRENCE-ID blocks before node-ical loses them, inject them into the calendarData map under composite keys, build a per-UID set of exception dates, and filter those dates out of RRULE expansions so the exception event is processed instead of the original occurrence.

**Tech Stack:** Node.js ESM, node-ical (`ical.parseICS`, `ical.expandRecurringEvent`), native `fetch`.

---

### Task 1: Update fetchCalendar() to fetch raw text and return it alongside parsed data

**Files:**
- Modify: `src/calendar/fetcher.js`

Currently `fetchCalendar` uses `ical.async.fromURL(url)` which fetches and parses internally, returning only the parsed map. We need the raw ICS text for exception extraction, so switch to `fetch` + `ical.parseICS`.

- [ ] **Step 1: Replace the body of `fetchCalendar` in `src/calendar/fetcher.js`**

The complete new file:

```js
/**
 * ICS feed fetcher: fetches raw ICS text and parses it with node-ical.
 *
 * Returns both the parsed CalendarResponse map and the raw text so that
 * the parser can extract RECURRENCE-ID exceptions before node-ical's
 * UID-keyed map overwrites them with the series master.
 *
 * Locked decision: fail immediately on any error — no retries, no partial results.
 */

import ical from 'node-ical';

/**
 * Fetch an ICS calendar feed from the given URL.
 *
 * @param {string} url - The ICS feed URL to fetch.
 * @returns {Promise<{ data: Record<string, any>, rawText: string }>}
 * @throws {Error} With message "Calendar feed unreachable: <original message>" on any failure.
 */
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

- [ ] **Step 2: Commit**

```bash
git add src/calendar/fetcher.js
git commit -m "fix: fetch raw ICS text for recurrence exception extraction"
```

---

### Task 2: Thread rawText through index.js into parseEvents()

**Files:**
- Modify: `src/calendar/index.js:45-48`

`getTodaysMeetings()` calls `fetchCalendar` and passes the result to `parseEvents`. Update both call sites to handle the new `{ data, rawText }` shape.

- [ ] **Step 1: Update the fetch and parse calls in `src/calendar/index.js`**

Find these two lines (around line 45–48):

```js
  // 3. Fetch ICS feed — fail-fast, no retries
  const calendarData = await fetchCalendar(icsUrl);

  // 4. Parse today's events
  const events = parseEvents(calendarData, { userEmail, suppressedMeetings, timezone });
```

Replace with:

```js
  // 3. Fetch ICS feed — fail-fast, no retries
  const { data: calendarData, rawText } = await fetchCalendar(icsUrl);

  // 4. Parse today's events
  const events = parseEvents(calendarData, { userEmail, suppressedMeetings, timezone, rawText });
```

- [ ] **Step 2: Commit**

```bash
git add src/calendar/index.js
git commit -m "fix: pass raw ICS text through to parseEvents for exception handling"
```

---

### Task 3: Add extractRecurrenceExceptions() and update parseEvents()

**Files:**
- Modify: `src/calendar/parser.js`

This is the core fix. Two changes:

1. New function `extractRecurrenceExceptions(rawText)` — scans raw ICS for RECURRENCE-ID VEVENTs, parses each with node-ical (including VTIMEZONE context for correct date handling), returns a map keyed by `uid:recurrence:<isoDate>`.

2. `parseEvents()` — accepts `rawText` in options, merges exceptions into a working data copy, builds `exceptionDatesByUid` (a map from UID to Set of `YYYYMMDD` date strings), and filters those dates from RRULE expansions.

- [ ] **Step 1: Add `extractRecurrenceExceptions` to `src/calendar/parser.js` — insert after the existing helpers and before `parseEvents`**

Add this function after the `isRealAttendee` function (around line 56) and before the `parseEvents` export:

```js
/**
 * Scan raw ICS text for VEVENT blocks that are recurrence exceptions
 * (i.e. contain a RECURRENCE-ID line). Parse each one using node-ical
 * (with VTIMEZONE context) and return a map keyed by a composite
 * uid:recurrence:<isoDate> string so they survive the UID collision
 * that would otherwise let the series master overwrite them.
 *
 * @param {string} rawText - Raw ICS feed text.
 * @returns {Record<string, any>} Map of composite key → node-ical event object.
 */
function extractRecurrenceExceptions(rawText) {
  // Collect all VTIMEZONE blocks — needed to correctly parse timezone-aware dates
  const vtimezones = [];
  const tzRegex = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gi;
  let tzMatch;
  while ((tzMatch = tzRegex.exec(rawText)) !== null) {
    vtimezones.push(tzMatch[0]);
  }
  const tzBlock = vtimezones.join('\r\n');

  const exceptions = {};
  // Split on BEGIN:VEVENT; first element is the preamble before any events
  const blocks = rawText.split(/BEGIN:VEVENT/i).slice(1);

  for (const block of blocks) {
    const vevent = block.split(/END:VEVENT/i)[0];
    if (!/RECURRENCE-ID/i.test(vevent)) continue;

    // Wrap in a minimal VCALENDAR with timezone context so node-ical parses
    // TZID-qualified datetimes correctly
    const icsWrapper =
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${tzBlock}\r\nBEGIN:VEVENT${vevent}END:VEVENT\r\nEND:VCALENDAR`;

    let parsed;
    try {
      parsed = ical.parseICS(icsWrapper);
    } catch {
      continue;
    }

    const event = Object.values(parsed).find(e => e.type === 'VEVENT');
    if (!event?.uid || !event.recurrenceid) continue;

    const rid = event.recurrenceid instanceof Date
      ? event.recurrenceid
      : new Date(String(event.recurrenceid));
    if (isNaN(rid.getTime())) continue;

    const key = `${event.uid}:recurrence:${rid.toISOString()}`;
    exceptions[key] = event;
  }

  return exceptions;
}
```

- [ ] **Step 2: Update `parseEvents` to accept `rawText`, merge exceptions, build exception date sets, and filter RRULE expansions**

Find the opening of `parseEvents` and its destructure line:

```js
export function parseEvents(calendarData, options = {}) {
  const { userEmail, suppressedMeetings = [], timezone = null } = options;
```

Replace with:

```js
export function parseEvents(calendarData, options = {}) {
  const { userEmail, suppressedMeetings = [], timezone = null, rawText = '' } = options;

  // Extract RECURRENCE-ID exceptions from raw text before the UID map loses them
  const exceptions = rawText ? extractRecurrenceExceptions(rawText) : {};
  const workingData = { ...calendarData, ...exceptions };

  // Build a map from UID → Set of YYYYMMDD date strings covered by exceptions.
  // These dates will be suppressed from RRULE expansion so the exception
  // event is processed instead of the original occurrence.
  const exceptionDatesByUid = {};
  for (const exc of Object.values(exceptions)) {
    if (!exc.uid || !exc.recurrenceid) continue;
    const rid = exc.recurrenceid instanceof Date
      ? exc.recurrenceid
      : new Date(String(exc.recurrenceid));
    if (isNaN(rid.getTime())) continue;
    const dateStr = rid.toISOString().slice(0, 10).replace(/-/g, '');
    if (!exceptionDatesByUid[exc.uid]) exceptionDatesByUid[exc.uid] = new Set();
    exceptionDatesByUid[exc.uid].add(dateStr);
  }
```

- [ ] **Step 3: Replace the `calendarData` loop variable with `workingData`**

Find:

```js
  for (const component of Object.values(calendarData)) {
```

Replace with:

```js
  for (const component of Object.values(workingData)) {
```

- [ ] **Step 4: Filter exception dates from RRULE expansions**

Find the RRULE expansion block (the line after `ical.expandRecurringEvent`) that filters instances:

```js
        instances = expanded.filter(
          inst => !inst.isFullDay && inst.start >= todayStart && inst.start <= todayEnd
        );
```

Replace with:

```js
        const exDates = exceptionDatesByUid[event.uid] ?? new Set();
        instances = expanded.filter(inst => {
          if (inst.isFullDay || inst.start < todayStart || inst.start > todayEnd) return false;
          const instDateStr = inst.start.toISOString().slice(0, 10).replace(/-/g, '');
          return !exDates.has(instDateStr);
        });
```

- [ ] **Step 5: Commit**

```bash
git add src/calendar/parser.js
git commit -m "fix: handle RECURRENCE-ID exceptions lost by node-ical UID collision"
```

---

### Task 4: End-to-end verification

**Files:** (read-only — inspect output)

- [ ] **Step 1: Invalidate the cache and run sync**

```bash
node -e "
const fs = await import('fs/promises');
const cache = JSON.parse(await fs.readFile(process.env.HOME + '/.prepare-my-day/calendar-cache.json', 'utf8'));
cache.hash = '';
await fs.writeFile(process.env.HOME + '/.prepare-my-day/calendar-cache.json', JSON.stringify(cache, null, 2));
console.log('Cache invalidated');
" && node src/index.js sync
```

Expected output includes `2 event(s) for today` (or more) instead of `1 event(s) for today`.

- [ ] **Step 2: Confirm "Q3 Plan Read Out" appears in today's daily note**

```bash
grep -i "Q3" /Users/mlileng/code/crew-os/wiki/daily/2026-06-12.md
```

Expected: a wikilink line referencing an instance file containing `q3-plan-read-out`.

- [ ] **Step 3: Confirm the "Monthly Brief Prep Meeting" RRULE occurrence for today is suppressed**

```bash
grep -i "monthly-brief-prep" /Users/mlileng/code/crew-os/wiki/daily/2026-06-12.md
```

Expected: the existing `monthly-brief-prep-meeting` instance wikilink still appears (it was created in a prior run and the daily page already has meetings — so it won't be removed). This is acceptable: the idempotency guard on the daily page means today's note won't be re-written. On a fresh day both behaviours will be correct.

- [ ] **Step 4: Confirm the instance file for Q3 Plan Read Out was created**

```bash
ls /Users/mlileng/code/crew-os/wiki/meetings/instances/ | grep q3
```

Expected: `2026-06-12-q3-plan-read-out.md` (or similar slug).
