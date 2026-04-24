# Notion-to-Obsidian Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Notion API storage backend with local Obsidian vault file-system operations, producing meeting instance files and a daily launchpad note on each sync run.

**Architecture:** The three-stage pipeline (calendar → meetings → daily) is preserved intact. Only the two storage modules (`meetings/notion.js`, `daily/notion.js`) are replaced with Obsidian file-system equivalents, config loses Notion fields and gains `obsidianVaultPath`, and `daily/blocks.js` is rewritten to produce markdown instead of Notion block objects. All calendar, matching, caching, and CLI orchestration logic is untouched.

**Tech Stack:** Node.js ESM, `node:fs/promises` (built-in), `node:test` + `node:assert` (built-in) for tests. No new npm dependencies.

**Design spec:** `docs/superpowers/specs/2026-04-24-notion-to-obsidian-migration-design.md`
**GitHub issue:** https://github.com/mlileng/ai-prepare-my-day/issues/4

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `src/config/schema.js` | Remove 3 Notion fields, add `obsidianVaultPath` |
| Create | `src/meetings/obsidian.js` | `fetchAllSeries`, `findExistingInstance`, `createMeetingInstance` |
| Modify | `src/meetings/reconciler.js` | Swap Notion imports/calls, rename `notionPageId` → `filePath` |
| Modify | `src/meetings/index.js` | Remove Notion auth, use `fetchAllSeries`, pass `vaultPath` |
| Modify | `src/daily/blocks.js` | Replace `buildMeetingBlocks` with `buildMeetingLines`, drop Notion-specific `formatTime` |
| Create | `src/daily/obsidian.js` | `findTodayNote`, `hasMeetingsSection`, `createDailyNote`, `prependMeetingsSection` |
| Modify | `src/daily/index.js` | Remove Notion auth, use `buildMeetingLines` + Obsidian functions |
| Modify | `src/commands/setup.js` | Replace Notion prompts with vault path prompt |
| Modify | `src/commands/status.js` | Replace Notion checks with vault path + folder checks |
| Delete | `src/auth/notion.js` | No longer needed |
| Delete | `src/utils/validation.js` | Notion URL parser, no longer needed |
| Modify | `package.json` | Remove `@notionhq/client` |
| Modify | `src/mcp-server.js` | Update `sync_calendar` tool description string |
| Create | `tests/meetings-obsidian.test.js` | Integration tests for meetings/obsidian.js |
| Create | `tests/daily-obsidian.test.js` | Integration tests for daily/obsidian.js + blocks.js |

---

## Task 1: Update config schema

**Files:**
- Modify: `src/config/schema.js`

- [ ] **Step 1: Write the failing test**

Create `tests/config-schema.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/config/schema.js';

test('DEFAULT_CONFIG has obsidianVaultPath and not Notion fields', () => {
  assert.ok('obsidianVaultPath' in DEFAULT_CONFIG);
  assert.ok(!('notionToken' in DEFAULT_CONFIG));
  assert.ok(!('meetingsDatabaseId' in DEFAULT_CONFIG));
  assert.ok(!('daysDatabaseId' in DEFAULT_CONFIG));
});

test('validateConfig passes for valid config', () => {
  const config = {
    obsidianVaultPath: '/some/path',
    icsUrl: null,
    userEmail: null,
    suppressedMeetings: [],
    teamsWebhookUrl: null,
  };
  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateConfig fails when obsidianVaultPath is missing', () => {
  const config = { icsUrl: null, userEmail: null, suppressedMeetings: [], teamsWebhookUrl: null };
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('obsidianVaultPath')));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/config-schema.test.js
```

Expected: FAIL — `obsidianVaultPath` not in DEFAULT_CONFIG

- [ ] **Step 3: Update `src/config/schema.js`**

```js
import os from 'os';
import path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
export const CONFIG_FILE = 'config.json';

export const DEFAULT_CONFIG = {
  obsidianVaultPath: null,
  icsUrl: null,
  userEmail: null,
  suppressedMeetings: [],
  teamsWebhookUrl: null,
};

export function validateConfig(config) {
  const errors = [];

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  const requiredKeys = Object.keys(DEFAULT_CONFIG);
  for (const key of requiredKeys) {
    if (!(key in config)) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/config-schema.test.js
```

Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.js tests/config-schema.test.js
git commit -m "feat: update config schema — replace Notion fields with obsidianVaultPath"
```

---

## Task 2: Create `src/meetings/obsidian.js`

This module replaces `src/meetings/notion.js`. It reads series from the vault, checks for existing instances, and creates new instance files.

The matcher (`matcher.js`) is untouched — it reads `page.properties` with `type: 'title'` and `page.last_edited_time`. `fetchAllSeries` shapes its output to match this interface so the matcher works without modification.

**Files:**
- Create: `src/meetings/obsidian.js`
- Create: `tests/meetings-obsidian.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/meetings-obsidian.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fetchAllSeries, findExistingInstance, createMeetingInstance } from '../src/meetings/obsidian.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-test-'));
  await fs.mkdir(path.join(dir, 'meetings', 'series'), { recursive: true });
  await fs.mkdir(path.join(dir, 'meetings', 'instances'), { recursive: true });
  return dir;
}

test('fetchAllSeries returns empty array when no series files', async () => {
  const vault = await makeTempVault();
  const series = await fetchAllSeries(vault);
  assert.deepEqual(series, []);
  await fs.rm(vault, { recursive: true });
});

test('fetchAllSeries reads name from frontmatter', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'series', 'heidi-morten.md'),
    '---\ntype: meeting-series\nname: "Heidi:Morten"\nstatus: recurring\n---\n\n## Purpose\n'
  );
  const series = await fetchAllSeries(vault);
  assert.equal(series.length, 1);
  assert.equal(series[0].slug, 'heidi-morten');
  // Must have shape the matcher expects
  const titleProp = Object.values(series[0].properties).find(p => p.type === 'title');
  assert.ok(titleProp);
  assert.equal(titleProp.title[0].plain_text, 'Heidi:Morten');
  await fs.rm(vault, { recursive: true });
});

test('fetchAllSeries falls back to filename when name frontmatter absent', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'series', 'standup.md'),
    '---\ntype: meeting-series\n---\n'
  );
  const series = await fetchAllSeries(vault);
  assert.equal(series[0].slug, 'standup');
  const titleProp = Object.values(series[0].properties).find(p => p.type === 'title');
  assert.equal(titleProp.title[0].plain_text, 'standup');
  await fs.rm(vault, { recursive: true });
});

test('findExistingInstance returns false when no file', async () => {
  const vault = await makeTempVault();
  const exists = await findExistingInstance(vault, '2026-04-24', 'heidi-morten');
  assert.equal(exists, false);
  await fs.rm(vault, { recursive: true });
});

test('findExistingInstance returns true when file exists', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'instances', '2026-04-24-heidi-morten.md'),
    '# existing'
  );
  const exists = await findExistingInstance(vault, '2026-04-24', 'heidi-morten');
  assert.equal(exists, true);
  await fs.rm(vault, { recursive: true });
});

test('createMeetingInstance creates file and returns relative path', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Heidi:Morten', start: new Date('2026-04-24T09:00:00'), end: new Date('2026-04-24T09:30:00'), displayRange: '09:00–09:30' };
  const filePath = await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  assert.equal(filePath, 'meetings/instances/2026-04-24-heidi-morten.md');
  const content = await fs.readFile(path.join(vault, filePath), 'utf8');
  assert.ok(content.includes('type: meeting-instance'));
  assert.ok(content.includes('date: 2026-04-24'));
  assert.ok(content.includes('Heidi:Morten'));
  await fs.rm(vault, { recursive: true });
});

test('createMeetingInstance is idempotent — returns existing path without overwriting', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Heidi:Morten', start: new Date('2026-04-24T09:00:00'), end: new Date('2026-04-24T09:30:00'), displayRange: '09:00–09:30' };
  await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  // Write custom content to simulate manual edits
  const instancePath = path.join(vault, 'meetings', 'instances', '2026-04-24-heidi-morten.md');
  await fs.writeFile(instancePath, '# my notes');
  // Second call should not overwrite
  await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  const content = await fs.readFile(instancePath, 'utf8');
  assert.equal(content, '# my notes');
  await fs.rm(vault, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/meetings-obsidian.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/meetings/obsidian.js`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const SERIES_DIR = 'meetings/series';
const INSTANCES_DIR = 'meetings/instances';

function parseFrontmatterName(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const match = block[1].match(/^name:\s*"?([^"\n]+)"?\s*$/m);
  return match ? match[1].trim() : null;
}

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function fetchAllSeries(vaultPath) {
  const seriesDir = path.join(vaultPath, SERIES_DIR);
  let files;
  try {
    files = await fs.readdir(seriesDir);
  } catch {
    return [];
  }

  const mdFiles = files.filter(f => f.endsWith('.md'));
  const series = [];

  for (const file of mdFiles) {
    const slug = file.replace(/\.md$/, '');
    let name = slug;
    try {
      const content = await fs.readFile(path.join(seriesDir, file), 'utf8');
      name = parseFrontmatterName(content) ?? slug;
    } catch {
      // skip unreadable files
    }

    let mtime = new Date(0);
    try {
      const stats = await fs.stat(path.join(seriesDir, file));
      mtime = stats.mtime;
    } catch {
      // use epoch as fallback
    }

    series.push({
      id: `${SERIES_DIR}/${file}`,
      slug,
      last_edited_time: mtime.toISOString(),
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: name }],
        },
      },
    });
  }

  return series;
}

export async function findExistingInstance(vaultPath, date, seriesSlug) {
  const filePath = path.join(vaultPath, INSTANCES_DIR, `${date}-${seriesSlug}.md`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createMeetingInstance(vaultPath, event, date, seriesSlug, seriesId) {
  const fileName = `${date}-${seriesSlug}.md`;
  const relPath = `${INSTANCES_DIR}/${fileName}`;
  const absPath = path.join(vaultPath, relPath);

  // Idempotency guard — never overwrite an existing instance
  const exists = await findExistingInstance(vaultPath, date, seriesSlug);
  if (exists) return relPath;

  await fs.mkdir(path.join(vaultPath, INSTANCES_DIR), { recursive: true });

  const seriesLink = seriesId ? `"[[${seriesId.replace(/\.md$/, '')}]]"` : '""';
  const content = `---
type: meeting-instance
date: ${date}
series: ${seriesLink}
participants: []
tags: [meeting-instance]
---

## Agenda / Context

${event.title} — ${event.displayRange}

## Key Discussion Points

## Decisions

## Action Items

## My Summary

## Links
`;

  await fs.writeFile(absPath, content, 'utf8');
  return relPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/meetings-obsidian.test.js
```

Expected: PASS (7 passing)

- [ ] **Step 5: Commit**

```bash
git add src/meetings/obsidian.js tests/meetings-obsidian.test.js
git commit -m "feat: add meetings/obsidian.js — series reading and instance creation"
```

---

## Task 3: Rewrite `src/meetings/reconciler.js`

Replace Notion-specific imports and logic. For every event — matched or not — an instance file is created (identified by filePath). Rename `notionPageId` → `filePath` throughout.

**Files:**
- Modify: `src/meetings/reconciler.js`

- [ ] **Step 1: Replace `src/meetings/reconciler.js` entirely**

```js
import { matchEvent } from './matcher.js';
import { createMeetingInstance } from './obsidian.js';
import { hashSingleEvent } from '../calendar/cache.js';

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (cached > 0) summary += `, ${cached} unchanged (cached)`;
  console.log(summary);
}

export async function reconcileMeetings(seriesPages, events, { vaultPath, date, cache }) {
  const results = [];
  const updatedMeetingMap = { ...cache.meetingMap };

  for (const event of events) {
    const eventHash = hashSingleEvent(event);

    if (cache.meetingMap[eventHash]) {
      results.push({
        eventTitle: event.title,
        matchType: 'cached',
        filePath: cache.meetingMap[eventHash],
        score: 0,
        start: event.start.toISOString(),
      });
      continue;
    }

    const match = matchEvent(event.title, seriesPages, 0.8);

    let seriesSlug;
    let seriesId;
    let matchType;
    let score;

    if (match.type === 'exact' || match.type === 'fuzzy') {
      seriesSlug = match.page.slug;
      seriesId = match.page.id;
      matchType = match.type;
      score = match.score;
    } else {
      seriesSlug = toSlug(event.title);
      seriesId = null;
      matchType = 'created';
      score = 0;
    }

    const filePath = await createMeetingInstance(vaultPath, event, date, seriesSlug, seriesId);

    results.push({ eventTitle: event.title, matchType, filePath, score, start: event.start.toISOString() });
    updatedMeetingMap[eventHash] = filePath;
  }

  printSummary(results);
  return { results, updatedMeetingMap };
}
```

- [ ] **Step 2: Run existing calendar tests to confirm untouched modules still work**

```bash
node --test tests/ 2>/dev/null || echo "no prior tests to break"
```

Expected: any existing tests pass; no import errors

- [ ] **Step 3: Commit**

```bash
git add src/meetings/reconciler.js
git commit -m "feat: rewrite reconciler to use Obsidian instance files instead of Notion pages"
```

---

## Task 4: Update `src/meetings/index.js`

Replace Notion auth setup with vault path loading. Feed `fetchAllSeries` results to the reconciler.

**Files:**
- Modify: `src/meetings/index.js`

- [ ] **Step 1: Replace `src/meetings/index.js`**

```js
import { loadConfig } from '../config/manager.js';
import { loadCache, saveCache } from '../calendar/cache.js';
import { fetchAllSeries } from './obsidian.js';
import { reconcileMeetings } from './reconciler.js';

export async function syncMeetings(events, { changed }) {
  if (!changed) {
    console.log('Meetings unchanged since last run — skipping');
    return [];
  }

  const config = await loadConfig();
  if (!config.obsidianVaultPath) {
    throw new Error('Obsidian vault not configured. Run: prepare-my-day setup');
  }

  const seriesPages = await fetchAllSeries(config.obsidianVaultPath);
  const cache = await loadCache();
  const date = new Date().toISOString().slice(0, 10);

  const { results, updatedMeetingMap } = await reconcileMeetings(seriesPages, events, {
    vaultPath: config.obsidianVaultPath,
    date,
    cache,
  });

  await saveCache(
    cache.date ?? date,
    cache.hash ?? '',
    updatedMeetingMap
  );

  return results;
}

export { matchEvent } from './matcher.js';
```

- [ ] **Step 2: Verify no import errors**

```bash
node --input-type=module <<'EOF'
import { syncMeetings } from './src/meetings/index.js';
console.log('import ok');
EOF
```

Expected: `import ok`

- [ ] **Step 3: Commit**

```bash
git add src/meetings/index.js
git commit -m "feat: update meetings/index.js to use Obsidian vault instead of Notion"
```

---

## Task 5: Rewrite `src/daily/blocks.js`

Replace Notion block objects with markdown strings. Keep `sortMeetingResults` unchanged. Remove `formatTime` (we use `formatEventTime` from `src/utils/timezone.js`).

**Files:**
- Modify: `src/daily/blocks.js`
- Create: `tests/daily-blocks.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/daily-blocks.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortMeetingResults, buildMeetingLines } from '../src/daily/blocks.js';

const results = [
  { eventTitle: 'Standup', filePath: 'meetings/instances/2026-04-24-standup.md', start: '2026-04-24T09:00:00.000Z', matchType: 'exact', score: 1 },
  { eventTitle: 'Architecture Review', filePath: 'meetings/instances/2026-04-24-architecture-review.md', start: '2026-04-24T08:00:00.000Z', matchType: 'fuzzy', score: 0.9 },
];

test('sortMeetingResults orders chronologically', () => {
  const sorted = sortMeetingResults(results);
  assert.equal(sorted[0].eventTitle, 'Architecture Review');
  assert.equal(sorted[1].eventTitle, 'Standup');
});

test('sortMeetingResults does not mutate input', () => {
  const copy = [...results];
  sortMeetingResults(results);
  assert.deepEqual(results, copy);
});

test('buildMeetingLines returns markdown wikilink strings', () => {
  const sorted = sortMeetingResults(results);
  const lines = buildMeetingLines(sorted);
  assert.equal(lines.length, 2);
  // Each line starts with "- HH:MM"
  assert.ok(lines[0].startsWith('- '));
  assert.ok(lines[0].includes('[[meetings/instances/2026-04-24-architecture-review|Architecture Review]]'));
  assert.ok(lines[1].includes('[[meetings/instances/2026-04-24-standup|Standup]]'));
});

test('buildMeetingLines strips .md extension from filePath in wikilink', () => {
  const lines = buildMeetingLines([results[0]]);
  assert.ok(!lines[0].includes('.md'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/daily-blocks.test.js
```

Expected: FAIL — `buildMeetingLines` not exported

- [ ] **Step 3: Rewrite `src/daily/blocks.js`**

```js
import { formatEventTime } from '../utils/timezone.js';

export function sortMeetingResults(results) {
  return [...results].sort((a, b) => {
    const timeDiff = new Date(a.start) - new Date(b.start);
    if (timeDiff !== 0) return timeDiff;
    return a.eventTitle.localeCompare(b.eventTitle);
  });
}

export function buildMeetingLines(sortedResults) {
  return sortedResults.map(result => {
    const time = formatEventTime(new Date(result.start));
    const wikiPath = result.filePath.replace(/\.md$/, '');
    return `- ${time} [[${wikiPath}|${result.eventTitle}]]`;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/daily-blocks.test.js
```

Expected: PASS (4 passing)

- [ ] **Step 5: Commit**

```bash
git add src/daily/blocks.js tests/daily-blocks.test.js
git commit -m "feat: rewrite daily/blocks.js to produce markdown wikilink lines"
```

---

## Task 6: Create `src/daily/obsidian.js`

Four functions that find, create, and update the daily note in the vault.

**Files:**
- Create: `src/daily/obsidian.js`
- Create: `tests/daily-obsidian.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/daily-obsidian.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findTodayNote, hasMeetingsSection, createDailyNote, prependMeetingsSection } from '../src/daily/obsidian.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-daily-test-'));
  return dir;
}

test('findTodayNote returns false when no daily note exists', async () => {
  const vault = await makeTempVault();
  const exists = await findTodayNote(vault, '2026-04-24');
  assert.equal(exists, false);
  await fs.rm(vault, { recursive: true });
});

test('findTodayNote returns true when daily note exists', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# existing');
  const exists = await findTodayNote(vault, '2026-04-24');
  assert.equal(exists, true);
  await fs.rm(vault, { recursive: true });
});

test('hasMeetingsSection returns false for note without ## Meetings', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# April 24\n\n## Today\'s Focus\n');
  const has = await hasMeetingsSection(vault, '2026-04-24');
  assert.equal(has, false);
  await fs.rm(vault, { recursive: true });
});

test('hasMeetingsSection returns true for note with ## Meetings', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# April 24\n\n## Meetings\n\n- 09:00 [[x]]\n');
  const has = await hasMeetingsSection(vault, '2026-04-24');
  assert.equal(has, true);
  await fs.rm(vault, { recursive: true });
});

test('createDailyNote creates daily/ folder and note file', async () => {
  const vault = await makeTempVault();
  const lines = ['- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'];
  await createDailyNote(vault, '2026-04-24', lines);
  const content = await fs.readFile(path.join(vault, 'daily', '2026-04-24.md'), 'utf8');
  assert.ok(content.includes('type: daily-note'));
  assert.ok(content.includes('date: 2026-04-24'));
  assert.ok(content.includes('## Meetings'));
  assert.ok(content.includes('- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'));
  assert.ok(content.includes('## Today\'s Focus'));
  assert.ok(content.includes('[[daily/2026-04-23]]'));
  assert.ok(content.includes('[[daily/2026-04-25]]'));
  await fs.rm(vault, { recursive: true });
});

test('prependMeetingsSection inserts ## Meetings after nav line', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  const existing = `---
type: daily-note
date: 2026-04-24
tags: [daily-note]
---

# Friday, April 24, 2026

← [[daily/2026-04-23]] | [[daily/2026-04-25]] →

## Today's Focus

`;
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), existing);
  const lines = ['- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'];
  await prependMeetingsSection(vault, '2026-04-24', lines);
  const content = await fs.readFile(path.join(vault, 'daily', '2026-04-24.md'), 'utf8');
  const meetingsPos = content.indexOf('## Meetings');
  const focusPos = content.indexOf("## Today's Focus");
  assert.ok(meetingsPos !== -1);
  assert.ok(meetingsPos < focusPos);
  await fs.rm(vault, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/daily-obsidian.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/daily/obsidian.js`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

function offsetDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDayTitle(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dailyNotePath(vaultPath, date) {
  return path.join(vaultPath, 'daily', `${date}.md`);
}

export async function findTodayNote(vaultPath, date) {
  try {
    await fs.access(dailyNotePath(vaultPath, date));
    return true;
  } catch {
    return false;
  }
}

export async function hasMeetingsSection(vaultPath, date) {
  try {
    const content = await fs.readFile(dailyNotePath(vaultPath, date), 'utf8');
    return /^## Meetings$/m.test(content);
  } catch {
    return false;
  }
}

export async function createDailyNote(vaultPath, date, meetingLines) {
  await fs.mkdir(path.join(vaultPath, 'daily'), { recursive: true });

  const prev = offsetDate(date, -1);
  const next = offsetDate(date, 1);
  const title = formatDayTitle(date);
  const meetingsSection = meetingLines.length > 0
    ? `## Meetings\n\n${meetingLines.join('\n')}\n`
    : `## Meetings\n`;

  const content = `---
type: daily-note
date: ${date}
tags: [daily-note]
---

# ${title}

← [[daily/${prev}]] | [[daily/${next}]] →

${meetingsSection}
## Today's Focus

`;

  await fs.writeFile(dailyNotePath(vaultPath, date), content, 'utf8');
}

export async function prependMeetingsSection(vaultPath, date, meetingLines) {
  const filePath = dailyNotePath(vaultPath, date);
  const content = await fs.readFile(filePath, 'utf8');
  const meetingsSection = `\n\n## Meetings\n\n${meetingLines.join('\n')}\n`;

  // Insert after the nav line (← ... | ... →)
  const navPattern = /^← \[\[.*?\]\] \| \[\[.*?\]\] →$/m;
  const match = content.match(navPattern);

  let updated;
  if (match) {
    const insertAt = match.index + match[0].length;
    updated = content.slice(0, insertAt) + meetingsSection + content.slice(insertAt);
  } else {
    // Fallback: insert after frontmatter block
    updated = content.replace(/^---\n[\s\S]*?\n---\n/, m => m + meetingsSection);
  }

  await fs.writeFile(filePath, updated, 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/daily-obsidian.test.js
```

Expected: PASS (6 passing)

- [ ] **Step 5: Commit**

```bash
git add src/daily/obsidian.js tests/daily-obsidian.test.js
git commit -m "feat: add daily/obsidian.js — daily note find, create, and update"
```

---

## Task 7: Update `src/daily/index.js`

Remove Notion auth setup. Use `buildMeetingLines` and the new Obsidian functions.

**Files:**
- Modify: `src/daily/index.js`

- [ ] **Step 1: Replace `src/daily/index.js`**

```js
import { loadConfig } from '../config/manager.js';
import { findTodayNote, createDailyNote, hasMeetingsSection, prependMeetingsSection } from './obsidian.js';
import { sortMeetingResults, buildMeetingLines } from './blocks.js';

export async function syncDailyPage(results) {
  if (results.length === 0) {
    console.log('No meetings to link — skipping daily page');
    return;
  }

  const config = await loadConfig();
  if (!config.obsidianVaultPath) {
    throw new Error('Obsidian vault not configured. Run: prepare-my-day setup');
  }

  const vaultPath = config.obsidianVaultPath;
  const date = new Date().toISOString().slice(0, 10);

  const sorted = sortMeetingResults(results);
  const meetingLines = buildMeetingLines(sorted);

  const exists = await findTodayNote(vaultPath, date);

  if (!exists) {
    await createDailyNote(vaultPath, date, meetingLines);
    console.log('Daily page created with meetings section');
    return;
  }

  const alreadyDone = await hasMeetingsSection(vaultPath, date);
  if (alreadyDone) {
    console.log('Daily page already has meetings — skipping');
    return;
  }

  await prependMeetingsSection(vaultPath, date, meetingLines);
  console.log(`Daily page updated: ${results.length} meeting(s) linked`);
}

export { findTodayNote, hasMeetingsSection } from './obsidian.js';
```

- [ ] **Step 2: Verify no import errors**

```bash
node --input-type=module <<'EOF'
import { syncDailyPage } from './src/daily/index.js';
console.log('import ok');
EOF
```

Expected: `import ok`

- [ ] **Step 3: Run all tests**

```bash
node --test tests/
```

Expected: all previously passing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/daily/index.js
git commit -m "feat: update daily/index.js to use Obsidian vault instead of Notion"
```

---

## Task 8: Update `src/commands/setup.js`

Replace Notion token + database URL prompts with a single vault path prompt. Keep ICS URL, email, and Teams webhook prompts.

**Files:**
- Modify: `src/commands/setup.js`

- [ ] **Step 1: Replace `src/commands/setup.js`**

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
import { updateConfig } from '../config/manager.js';

async function validateIcsUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) return { valid: false, error: 'URL does not return valid ICS calendar data' };
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Could not reach URL: ${error.message}` };
  }
}

async function validateVaultPath(vaultPath) {
  try {
    const obsidianDir = path.join(vaultPath, '.obsidian');
    await fs.access(obsidianDir);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Path does not exist or is not an Obsidian vault (no .obsidian/ folder found)' };
  }
}

export async function setupCommand() {
  console.log('\nPrepare My Day — Setup\n');

  try {
    // Step 1: Outlook Calendar ICS URL
    const icsPrompt = await prompts({
      type: 'text',
      name: 'icsUrl',
      message: 'Outlook calendar ICS URL:',
      validate: value => value.trim() ? true : 'ICS URL is required',
    });
    if (!icsPrompt.icsUrl) { console.log('\nSetup cancelled.'); return; }

    const icsUrl = icsPrompt.icsUrl.trim();
    const icsSpinner = ora('Validating calendar feed...').start();
    const icsValidation = await validateIcsUrl(icsUrl);
    if (!icsValidation.valid) { icsSpinner.fail(icsValidation.error); return; }
    icsSpinner.succeed('Calendar feed connected');
    await updateConfig({ icsUrl });

    // Step 2: Obsidian vault path
    const vaultPrompt = await prompts({
      type: 'text',
      name: 'obsidianVaultPath',
      message: 'Obsidian vault path (absolute):',
      validate: value => value.trim() ? true : 'Vault path is required',
    });
    if (!vaultPrompt.obsidianVaultPath) { console.log('\nSetup cancelled.'); return; }

    const obsidianVaultPath = vaultPrompt.obsidianVaultPath.trim();
    const vaultSpinner = ora('Validating vault...').start();
    const vaultValidation = await validateVaultPath(obsidianVaultPath);
    if (!vaultValidation.valid) { vaultSpinner.fail(vaultValidation.error); return; }
    vaultSpinner.succeed(`Vault connected: ${obsidianVaultPath}`);
    await updateConfig({ obsidianVaultPath });

    // Step 3: User email (for declined-event filtering)
    const emailPrompt = await prompts({
      type: 'text',
      name: 'userEmail',
      message: 'Your email address (for filtering declined meetings):',
    });
    if (emailPrompt.userEmail && emailPrompt.userEmail.trim()) {
      await updateConfig({ userEmail: emailPrompt.userEmail.trim() });
    }

    // Step 4: Teams webhook URL (optional)
    const teamsPrompt = await prompts({
      type: 'text',
      name: 'teamsWebhookUrl',
      message: 'Teams webhook URL (optional — press Enter to skip):',
    });
    if (teamsPrompt.teamsWebhookUrl && teamsPrompt.teamsWebhookUrl.trim()) {
      await updateConfig({ teamsWebhookUrl: teamsPrompt.teamsWebhookUrl.trim() });
    }

    console.log('\nSetup complete!\n');
  } catch (error) {
    if (error.message === 'User force closed the prompt') {
      console.log('\nSetup cancelled.');
      return;
    }
    throw error;
  }
}
```

- [ ] **Step 2: Verify no import errors**

```bash
node --input-type=module <<'EOF'
import { setupCommand } from './src/commands/setup.js';
console.log('import ok');
EOF
```

Expected: `import ok`

- [ ] **Step 3: Commit**

```bash
git add src/commands/setup.js
git commit -m "feat: update setup command — replace Notion prompts with Obsidian vault path"
```

---

## Task 9: Update `src/commands/status.js`

Replace Notion token and database checks with vault path and folder structure checks.

**Files:**
- Modify: `src/commands/status.js`

- [ ] **Step 1: Replace `src/commands/status.js`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/manager.js';

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function statusCommand() {
  console.log('\nPrepare My Day — Status\n');

  let config;
  try {
    config = await loadConfig();
    console.log('[x] Config — ~/.prepare-my-day/config.json');
  } catch {
    console.log('[ ] Config — not found (run: prepare-my-day setup)');
    config = null;
  }

  // Outlook ICS feed
  if (config && config.icsUrl) {
    try {
      const response = await fetch(config.icsUrl);
      if (response.ok) {
        const text = await response.text();
        if (text.includes('BEGIN:VCALENDAR')) {
          console.log('[x] Outlook — calendar feed reachable');
        } else {
          console.log('[ ] Outlook — feed URL does not return ICS data (run: prepare-my-day setup)');
        }
      } else {
        console.log(`[ ] Outlook — feed returned HTTP ${response.status} (run: prepare-my-day setup)`);
      }
    } catch {
      console.log('[ ] Outlook — feed unreachable (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Outlook — not configured (run: prepare-my-day setup)');
  }

  // Obsidian vault
  if (config && config.obsidianVaultPath) {
    const vaultExists = await pathExists(config.obsidianVaultPath);
    if (vaultExists) {
      console.log(`[x] Obsidian vault — ${config.obsidianVaultPath}`);
    } else {
      console.log(`[ ] Obsidian vault — path not found: ${config.obsidianVaultPath}`);
    }

    const seriesExists = await pathExists(path.join(config.obsidianVaultPath, 'meetings', 'series'));
    console.log(seriesExists
      ? '[x] Meetings series folder — meetings/series/'
      : '[ ] Meetings series folder — meetings/series/ not found'
    );

    const instancesExists = await pathExists(path.join(config.obsidianVaultPath, 'meetings', 'instances'));
    console.log(instancesExists
      ? '[x] Meeting instances folder — meetings/instances/'
      : '[ ] Meeting instances folder — meetings/instances/ not found'
    );
  } else {
    console.log('[ ] Obsidian vault — not configured (run: prepare-my-day setup)');
  }

  console.log();
}
```

- [ ] **Step 2: Verify no import errors**

```bash
node --input-type=module <<'EOF'
import { statusCommand } from './src/commands/status.js';
console.log('import ok');
EOF
```

Expected: `import ok`

- [ ] **Step 3: Commit**

```bash
git add src/commands/status.js
git commit -m "feat: update status command — replace Notion checks with Obsidian vault checks"
```

---

## Task 10: Remove dead files and clean dependencies

Delete `src/auth/notion.js`, `src/utils/validation.js`, and remove `@notionhq/client` from `package.json`. Update `src/mcp-server.js` description string.

**Files:**
- Delete: `src/auth/notion.js`
- Delete: `src/utils/validation.js`
- Modify: `package.json`
- Modify: `src/mcp-server.js`

- [ ] **Step 1: Delete dead files**

```bash
rm src/auth/notion.js src/utils/validation.js
```

- [ ] **Step 2: Verify no remaining imports of deleted files**

```bash
grep -r "auth/notion\|utils/validation" src/
```

Expected: no output

- [ ] **Step 3: Remove `@notionhq/client` from package.json**

In `package.json`, remove the line:
```json
"@notionhq/client": "^5.9.0",
```

Then run:
```bash
npm install
```

Expected: `package-lock.json` updated, `node_modules/@notionhq` removed

- [ ] **Step 4: Update `sync_calendar` tool description in `src/mcp-server.js`**

Find this line in `src/mcp-server.js`:
```js
"Syncs today's calendar meetings to Notion and updates the daily page. Returns structured JSON with meeting counts and any errors. Safe to call multiple times — idempotent via content hash cache.",
```

Replace with:
```js
"Syncs today's calendar meetings to the Obsidian vault and creates a daily note. Returns structured JSON with meeting counts and any errors. Safe to call multiple times — idempotent via content hash cache.",
```

- [ ] **Step 5: Run all tests to confirm nothing is broken**

```bash
node --test tests/
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Notion auth/validation modules and @notionhq/client dependency"
```

---

## Task 11: End-to-end smoke test

Run the full pipeline against the real vault to verify files are created correctly.

**Files:** none — verification only

- [ ] **Step 1: Run setup to write vault path to config**

```bash
node src/index.js setup
```

When prompted:
- ICS URL: your existing ICS URL (already in config — can re-enter)
- Obsidian vault path: `/Users/mlileng/code/crew-os/wiki`
- Email: `morten.lileng@dentsu.com`
- Teams webhook: skip (Enter)

Expected: `Setup complete!`

- [ ] **Step 2: Run status to verify vault is detected**

```bash
node src/index.js status
```

Expected output:
```
[x] Config — ~/.prepare-my-day/config.json
[x] Outlook — calendar feed reachable
[x] Obsidian vault — /Users/mlileng/code/crew-os/wiki
[x] Meetings series folder — meetings/series/
[x] Meeting instances folder — meetings/instances/
```

- [ ] **Step 3: Clear cache to force a full sync**

```bash
rm -f ~/.prepare-my-day/calendar-cache.json
```

- [ ] **Step 4: Run sync**

```bash
node src/index.js sync
```

Expected: spinner output showing calendar fetch, meetings matched/created, daily page created/updated. No errors.

- [ ] **Step 5: Verify output files in the vault**

```bash
ls /Users/mlileng/code/crew-os/wiki/meetings/instances/ | grep $(date +%Y-%m-%d)
ls /Users/mlileng/code/crew-os/wiki/daily/
cat /Users/mlileng/code/crew-os/wiki/daily/$(date +%Y-%m-%d).md
```

Expected:
- One or more `YYYY-MM-DD-*.md` instance files for today
- `daily/YYYY-MM-DD.md` exists
- Daily note contains `## Meetings` with wikilinks and `## Today's Focus`

- [ ] **Step 6: Run sync again to verify idempotency**

```bash
node src/index.js sync
```

Expected: `Meetings unchanged since last run — skipping` or `Daily page already has meetings — skipping` — no duplicate files or sections.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: update config.example.json to reflect Obsidian fields"
```

(Update `config.example.json` to show `obsidianVaultPath` instead of Notion fields if it exists.)

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections covered — config, meetings module, daily module, blocks, setup, status, error handling, dependencies
- [x] **No placeholders:** All steps contain actual code
- [x] **Type consistency:** `filePath` used consistently across reconciler, blocks, obsidian modules. `seriesPages` passed from index to reconciler. `vaultPath` + `date` passed consistently
- [x] **`createMeetingInstance` signature** — takes `(vaultPath, event, date, seriesSlug, seriesId)` consistently in tests and implementation
- [x] **Matcher compatibility** — `fetchAllSeries` shapes objects with `id`, `slug`, `last_edited_time`, `properties.title` so `matcher.js` works unchanged
