# Meeting Suppression via File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a list of suppression terms from `~/.prepare-my-day/suppress.txt` and filter matching calendar events, replacing the unused `suppressedMeetings` field in config.

**Architecture:** A new `src/calendar/suppression.js` module reads and parses the plain-text suppress file. `getTodaysMeetings()` calls it and passes the result to `parseEvents()`. The `suppressedMeetings` field is removed from the config schema.

**Tech Stack:** Node.js ESM, `node:fs/promises`, `node:test` (built-in test runner)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/calendar/suppression.js` | Read and parse `~/.prepare-my-day/suppress.txt` |
| Create | `tests/calendar/suppression.test.js` | Unit tests for `loadSuppressedTerms()` |
| Modify | `src/calendar/index.js` | Call `loadSuppressedTerms()`, remove config field usage |
| Modify | `src/config/schema.js` | Remove `suppressedMeetings` from `DEFAULT_CONFIG` |
| Modify | `tests/config-schema.test.js` | Remove `suppressedMeetings` from test fixtures |
| Create | `suppress.example.txt` | Committed example file documenting the format |

---

## Task 1: `suppression.js` — tests first

**Files:**
- Create: `tests/calendar/suppression.test.js`
- Create: `src/calendar/suppression.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/calendar/suppression.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSuppressedTerms } from '../../src/calendar/suppression.js';

const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
const SUPPRESS_FILE = path.join(CONFIG_DIR, 'suppress.txt');
const BACKUP_FILE = path.join(CONFIG_DIR, 'suppress.txt.bak');

// Back up any real suppress.txt before tests, restore after
before(async () => {
  try {
    await fs.copyFile(SUPPRESS_FILE, BACKUP_FILE);
    await fs.unlink(SUPPRESS_FILE);
  } catch {
    // File didn't exist — nothing to back up
  }
});

after(async () => {
  try {
    await fs.unlink(SUPPRESS_FILE);
  } catch { /* already gone */ }
  try {
    await fs.copyFile(BACKUP_FILE, SUPPRESS_FILE);
    await fs.unlink(BACKUP_FILE);
  } catch { /* no backup existed */ }
});

test('returns empty array when suppress.txt does not exist', async () => {
  const result = await loadSuppressedTerms();
  assert.deepEqual(result, []);
});

test('returns empty array when suppress.txt is empty', async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SUPPRESS_FILE, '');
  const result = await loadSuppressedTerms();
  assert.deepEqual(result, []);
});

test('strips comments and blank lines, returns clean string array', async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SUPPRESS_FILE, [
    '# Blocked time',
    'Work Block (Meetings are Fine)',
    '',
    '# Stand-ups',
    'MRE Daily Scrum (New)',
    '  MKB Daily Scrum  ',  // leading/trailing whitespace
    '# trailing comment',
  ].join('\n'));

  const result = await loadSuppressedTerms();
  assert.deepEqual(result, [
    'Work Block (Meetings are Fine)',
    'MRE Daily Scrum (New)',
    'MKB Daily Scrum',
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/calendar/suppression.test.js
```

Expected: error — `Cannot find module '../../src/calendar/suppression.js'`

- [ ] **Step 3: Implement `src/calendar/suppression.js`**

Create `src/calendar/suppression.js`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SUPPRESS_FILE = path.join(os.homedir(), '.prepare-my-day', 'suppress.txt');

export async function loadSuppressedTerms() {
  let content;
  try {
    content = await fs.readFile(SUPPRESS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/calendar/suppression.test.js
```

Expected:
```
✔ returns empty array when suppress.txt does not exist
✔ returns empty array when suppress.txt is empty
✔ strips comments and blank lines, returns clean string array
```

- [ ] **Step 5: Commit**

```bash
git add src/calendar/suppression.js tests/calendar/suppression.test.js
git commit -m "feat: add suppression.js — load suppressed meeting terms from file"
```

---

## Task 2: Wire `loadSuppressedTerms()` into `getTodaysMeetings()`

**Files:**
- Modify: `src/calendar/index.js`

- [ ] **Step 1: Update the import block**

In `src/calendar/index.js`, add the import after the existing imports:

```js
import { loadSuppressedTerms } from './suppression.js';
```

- [ ] **Step 2: Update `getTodaysMeetings()`**

Replace the existing function body so it loads suppressed terms from the file instead of config. The full updated function:

```js
export async function getTodaysMeetings() {
  // 1. Load config and suppression list in parallel
  const [config, suppressedMeetings] = await Promise.all([
    loadConfig(),
    loadSuppressedTerms(),
  ]);
  const { icsUrl, userEmail } = config;

  // 2. Validate ICS URL is configured
  if (!icsUrl) {
    throw new Error('ICS calendar URL not configured. Run: prepare-my-day setup');
  }

  // 3. Fetch ICS feed — fail-fast, no retries
  const calendarData = await fetchCalendar(icsUrl);

  // 4. Parse today's events
  const events = parseEvents(calendarData, { userEmail, suppressedMeetings });

  // 5. Detect changes via content hash cache
  const changed = await hasEventsChanged(events);

  return { events, changed };
}
```

- [ ] **Step 3: Verify existing calendar tests still pass**

```bash
node --test tests/calendar/parser.test.js tests/calendar/cache.test.js tests/calendar/suppression.test.js
```

Expected: all tests pass, no failures.

- [ ] **Step 4: Commit**

```bash
git add src/calendar/index.js
git commit -m "feat: load suppressed meetings from suppress.txt in getTodaysMeetings"
```

---

## Task 3: Remove `suppressedMeetings` from config schema

**Files:**
- Modify: `src/config/schema.js`
- Modify: `tests/config-schema.test.js`

- [ ] **Step 1: Update `DEFAULT_CONFIG` in `src/config/schema.js`**

Remove the `suppressedMeetings` line. The updated `DEFAULT_CONFIG`:

```js
export const DEFAULT_CONFIG = {
  obsidianVaultPath: null,
  icsUrl: null,
  userEmail: null,
  teamsWebhookUrl: null
};
```

- [ ] **Step 2: Update `tests/config-schema.test.js`**

Remove `suppressedMeetings` from both test fixtures. Updated file:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/config/schema.js';

test('DEFAULT_CONFIG has obsidianVaultPath and not Notion fields', () => {
  assert.ok('obsidianVaultPath' in DEFAULT_CONFIG);
  assert.ok(!('notionToken' in DEFAULT_CONFIG));
  assert.ok(!('meetingsDatabaseId' in DEFAULT_CONFIG));
  assert.ok(!('daysDatabaseId' in DEFAULT_CONFIG));
  assert.ok(!('suppressedMeetings' in DEFAULT_CONFIG));
});

test('validateConfig passes for valid config', () => {
  const config = {
    obsidianVaultPath: '/some/path',
    icsUrl: null,
    userEmail: null,
    teamsWebhookUrl: null,
  };
  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateConfig fails when obsidianVaultPath is missing', () => {
  const config = { icsUrl: null, userEmail: null, teamsWebhookUrl: null };
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('obsidianVaultPath')));
});
```

- [ ] **Step 3: Run config schema tests**

```bash
node --test tests/config-schema.test.js
```

Expected: all three tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/config/schema.js tests/config-schema.test.js
git commit -m "chore: remove suppressedMeetings from config schema"
```

---

## Task 4: Add `suppress.example.txt` to repo

**Files:**
- Create: `suppress.example.txt`

- [ ] **Step 1: Create the example file**

Create `suppress.example.txt` in the repo root:

```
# Copy this file to ~/.prepare-my-day/suppress.txt and edit to match your calendar.
# One term per line. Lines starting with # are comments. Blank lines are ignored.
# Matching is case-insensitive substring — a term matches any event title containing it.

# Blocked time
Work Block (Meetings are Fine)
Private Appointment

# Stand-ups I'm not attending
MRE Daily Scrum (New)
Merkury Tag Daily Stand Up
MKB Daily Scrum

# Admin
Submit Timesheets
```

- [ ] **Step 2: Commit**

```bash
git add suppress.example.txt
git commit -m "docs: add suppress.example.txt with example suppression terms"
```

---

## Task 5: Full test run

- [ ] **Step 1: Run all tests**

```bash
node --test tests/calendar/parser.test.js tests/calendar/cache.test.js tests/calendar/suppression.test.js tests/config-schema.test.js tests/daily-blocks.test.js tests/daily-obsidian.test.js tests/meetings-obsidian.test.js tests/meetings-reconciler.test.js
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Close GitHub issue**

```bash
gh issue close 1 --repo mlileng/ai-prepare-my-day --comment "Implemented via suppress.example.txt + src/calendar/suppression.js. Copy suppress.example.txt to ~/.prepare-my-day/suppress.txt and edit to match your calendar."
```
