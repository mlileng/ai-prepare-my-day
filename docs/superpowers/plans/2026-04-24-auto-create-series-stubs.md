# Auto-Create Series Stubs for Recurring Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a recurring calendar event does not match any existing series file, automatically create a full-skeleton series stub in `meetings/series/` so future occurrences link correctly from the start.

**Architecture:** Add `isRecurring: !!event.rrule` to `CalendarEvent` objects in the parser. Add `createMeetingSeries()` to `src/meetings/obsidian.js` (idempotent, writes a full-skeleton `.md` file). Update the reconciler to call `createMeetingSeries()` before `createMeetingInstance()` when the event is unmatched and recurring.

**Tech Stack:** Node.js ESM, `node:test`, `node:fs/promises` — no new dependencies.

**Worktree:** `/Users/mlileng/code/ai-prepare-my-day/.worktrees/auto-series` (branch `feat/auto-series`)

**Run tests with:** `node --test` (from worktree root)

---

## File Structure

| File | Change |
|------|--------|
| `src/calendar/parser.js` | Add `isRecurring` field to `results.push(...)` at line 193 |
| `src/meetings/obsidian.js` | Add exported `createMeetingSeries()` function |
| `src/meetings/reconciler.js` | Call `createMeetingSeries()` in unmatched branch; update `printSummary` |
| `tests/calendar/parser.test.js` | Add two tests for `isRecurring` flag |
| `tests/meetings-obsidian.test.js` | Add three tests for `createMeetingSeries` |
| `tests/meetings-reconciler.test.js` | New file — integration tests for recurring vs non-recurring unmatched events |

---

## Task 1: Add `isRecurring` to parser output

**Files:**
- Modify: `src/calendar/parser.js` (line 193)
- Test: `tests/calendar/parser.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/calendar/parser.test.js`:

```js
test('isRecurring is true for events with rrule', () => {
  const ev = mockEvent({ rrule: { options: { freq: 2 } } }); // freq=2 = WEEKLY
  const result = parseEvents({ 'uid-1': ev });
  assert.equal(result.length, 1);
  assert.equal(result[0].isRecurring, true);
});

test('isRecurring is false for non-recurring events', () => {
  const ev = mockEvent();
  const result = parseEvents({ 'uid-1': ev });
  assert.equal(result.length, 1);
  assert.equal(result[0].isRecurring, false);
});
```

Note: `mockEvent` already returns a VEVENT for today with two attendees, so `parseEvents` will include it. The existing `mockEvent` helper has no `rrule`, so the second test works without changes.

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/calendar/parser.test.js 2>&1 | grep -E "isRecurring|fail|pass"
```

Expected: two failures — `result[0].isRecurring` is `undefined`.

- [ ] **Step 3: Add `isRecurring` to `results.push` in parser.js**

In `src/calendar/parser.js`, find the `results.push({` block at line 193 and add `isRecurring`:

```js
      results.push({
        uid:          event.uid,
        title:        getTitle(event.summary),
        isRecurring:  !!event.rrule,
        start:        eventStart,
        end:          eventEnd,
        startTz:      event.start?.tz,
        endTz:        event.end?.tz,
        displayStart: formatEventTime(eventStart),
        displayEnd:   formatEventTime(eventEnd),
        displayRange: formatEventRange(eventStart, eventEnd),
      });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/calendar/parser.test.js 2>&1 | tail -8
```

Expected: all parser tests pass, 0 failures.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
node --test 2>&1 | tail -8
```

Expected: 67 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/calendar/parser.js tests/calendar/parser.test.js
git commit -m "feat: add isRecurring flag to CalendarEvent"
```

---

## Task 2: Add `createMeetingSeries()` to obsidian.js

**Files:**
- Modify: `src/meetings/obsidian.js`
- Test: `tests/meetings-obsidian.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/meetings-obsidian.test.js`:

```js
import { fetchAllSeries, findExistingInstance, createMeetingInstance, createMeetingSeries } from '../src/meetings/obsidian.js';
```

Replace the existing import line (line 6) with the above, then add these tests at the bottom of the file:

```js
test('createMeetingSeries creates file with full skeleton frontmatter', async () => {
  const vault = await makeTempVault();
  const event = { title: 'B2B Internal Update' };
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  assert.equal(relPath, 'meetings/series/b2b-internal-update.md');
  const content = await fs.readFile(path.join(vault, relPath), 'utf8');
  assert.ok(content.includes('type: meeting-series'));
  assert.ok(content.includes('name: "B2B Internal Update"'));
  assert.ok(content.includes('status: recurring'));
  assert.ok(content.includes('cadence: "Recurring"'));
  assert.ok(content.includes('created: 2026-04-24'));
  assert.ok(content.includes('tags: [meeting-series]'));
  assert.ok(content.includes('## Purpose'));
  assert.ok(content.includes('## Participants'));
  await fs.rm(vault, { recursive: true });
});

test('createMeetingSeries is idempotent — returns path without overwriting existing file', async () => {
  const vault = await makeTempVault();
  const event = { title: 'B2B Internal Update' };
  await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  const seriesPath = path.join(vault, 'meetings', 'series', 'b2b-internal-update.md');
  await fs.writeFile(seriesPath, '# hand-crafted content');
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  assert.equal(relPath, 'meetings/series/b2b-internal-update.md');
  const content = await fs.readFile(seriesPath, 'utf8');
  assert.equal(content, '# hand-crafted content');
  await fs.rm(vault, { recursive: true });
});

test('createMeetingSeries returns correct vault-relative path', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Weekly Sync' };
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'weekly-sync');
  assert.equal(relPath, 'meetings/series/weekly-sync.md');
  await fs.rm(vault, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/meetings-obsidian.test.js 2>&1 | grep -E "createMeetingSeries|fail|SyntaxError"
```

Expected: failures — `createMeetingSeries` is not exported.

- [ ] **Step 3: Implement `createMeetingSeries` in `src/meetings/obsidian.js`**

Add to the bottom of `src/meetings/obsidian.js`:

```js
export async function createMeetingSeries(vaultPath, event, date, seriesSlug) {
  const relPath = `${SERIES_DIR}/${seriesSlug}.md`;
  const absPath = path.join(vaultPath, relPath);

  // Idempotency guard — never overwrite an existing series file
  try {
    await fs.access(absPath);
    return relPath;
  } catch {
    // File does not exist — proceed to create
  }

  await fs.mkdir(path.join(vaultPath, SERIES_DIR), { recursive: true });

  const content = `---
type: meeting-series
name: "${event.title}"
status: recurring
priority: ""
cadence: "Recurring"
participants: []
organizations: []
initiatives: []
created: ${date}
last_edited: ${date}
tags: [meeting-series]
---

## Purpose

*(to be filled in)*

## Participants

*(to be filled in)*
`;

  await fs.writeFile(absPath, content, 'utf8');
  return relPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/meetings-obsidian.test.js 2>&1 | tail -8
```

Expected: all 9 obsidian tests pass, 0 failures.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
node --test 2>&1 | tail -8
```

Expected: 70 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/meetings/obsidian.js tests/meetings-obsidian.test.js
git commit -m "feat: add createMeetingSeries to obsidian.js"
```

---

## Task 3: Update reconciler to call `createMeetingSeries` and add integration tests

**Files:**
- Modify: `src/meetings/reconciler.js`
- Create: `tests/meetings-reconciler.test.js`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/meetings-reconciler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reconcileMeetings } from '../src/meetings/reconciler.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconciler-test-'));
  await fs.mkdir(path.join(dir, 'meetings', 'series'), { recursive: true });
  await fs.mkdir(path.join(dir, 'meetings', 'instances'), { recursive: true });
  return dir;
}

const emptyCache = { meetingMap: {}, hash: null, date: null };

test('unmatched recurring event creates both series stub and linked instance', async () => {
  const vault = await makeTempVault();
  const event = {
    uid: 'uid-1',
    title: 'B2B Internal Update',
    isRecurring: true,
    start: new Date('2026-04-24T13:00:00'),
    end: new Date('2026-04-24T13:30:00'),
    displayRange: '13:00–13:30',
  };

  const { results } = await reconcileMeetings([], [event], {
    vaultPath: vault,
    date: '2026-04-24',
    cache: emptyCache,
  });

  // Instance created
  assert.equal(results.length, 1);
  assert.equal(results[0].matchType, 'created');
  assert.equal(results[0].filePath, 'meetings/instances/2026-04-24-b2b-internal-update.md');

  // Series stub created
  const seriesPath = path.join(vault, 'meetings', 'series', 'b2b-internal-update.md');
  const seriesContent = await fs.readFile(seriesPath, 'utf8');
  assert.ok(seriesContent.includes('name: "B2B Internal Update"'));

  // Instance links to series
  const instanceContent = await fs.readFile(path.join(vault, results[0].filePath), 'utf8');
  assert.ok(instanceContent.includes('[[meetings/series/b2b-internal-update]]'));

  await fs.rm(vault, { recursive: true });
});

test('unmatched non-recurring event creates instance only — no series file', async () => {
  const vault = await makeTempVault();
  const event = {
    uid: 'uid-2',
    title: 'One-off Review',
    isRecurring: false,
    start: new Date('2026-04-24T14:00:00'),
    end: new Date('2026-04-24T15:00:00'),
    displayRange: '14:00–15:00',
  };

  const { results } = await reconcileMeetings([], [event], {
    vaultPath: vault,
    date: '2026-04-24',
    cache: emptyCache,
  });

  assert.equal(results[0].matchType, 'created');

  // No series file created
  const seriesDir = await fs.readdir(path.join(vault, 'meetings', 'series'));
  assert.equal(seriesDir.length, 0);

  await fs.rm(vault, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/meetings-reconciler.test.js 2>&1 | grep -E "fail|series stub|non-recurring"
```

Expected: both tests fail — no series stub is created yet.

- [ ] **Step 3: Update reconciler to call `createMeetingSeries` in the unmatched branch**

In `src/meetings/reconciler.js`, update the import line and the unmatched branch:

Replace:
```js
import { createMeetingInstance } from './obsidian.js';
```
With:
```js
import { createMeetingInstance, createMeetingSeries } from './obsidian.js';
```

Replace the unmatched branch inside `reconcileMeetings`:
```js
    } else {
      seriesSlug = toSlug(event.title);
      seriesId = null;
      matchType = 'created';
      score = 0;
    }
```
With:
```js
    } else {
      seriesSlug = toSlug(event.title);
      matchType = 'created';
      score = 0;
      if (event.isRecurring) {
        const seriesRelPath = await createMeetingSeries(vaultPath, event, date, seriesSlug);
        seriesId = seriesRelPath;
      } else {
        seriesId = null;
      }
    }
```

- [ ] **Step 4: Update `printSummary` to report auto-created series stubs**

Replace the existing `printSummary` function in `src/meetings/reconciler.js`:

```js
function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;
  const seriesCreated = results.filter(r => r.seriesCreated).length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (seriesCreated > 0) summary += ` (${seriesCreated} series stub${seriesCreated > 1 ? 's' : ''} auto-created)`;
  if (cached > 0) summary += `, ${cached} unchanged (cached)`;
  console.log(summary);
}
```

And add `seriesCreated` to each result in the unmatched branch. Replace the `results.push` call that follows the `if (event.isRecurring)` block:

```js
    const filePath = await createMeetingInstance(vaultPath, event, date, seriesSlug, seriesId);

    results.push({
      eventTitle: event.title,
      matchType,
      filePath,
      score,
      start: event.start.toISOString(),
      seriesCreated: event.isRecurring && matchType === 'created',
    });
    updatedMeetingMap[eventHash] = filePath;
```

Note: the existing `results.push` for matched and cached events does not need `seriesCreated` — it will be `undefined`, which is falsy, so the filter in `printSummary` handles it correctly.

- [ ] **Step 5: Run integration tests to verify they pass**

```bash
node --test tests/meetings-reconciler.test.js 2>&1 | tail -8
```

Expected: 2 pass, 0 fail.

- [ ] **Step 6: Run full suite to check for regressions**

```bash
node --test 2>&1 | tail -8
```

Expected: 72 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/meetings/reconciler.js tests/meetings-reconciler.test.js
git commit -m "feat: auto-create series stub for unmatched recurring meetings"
```
