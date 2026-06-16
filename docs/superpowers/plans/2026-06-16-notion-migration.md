# Notion Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate prepare-my-day from Obsidian to Notion as the sync target by wiring the existing Notion API helpers into the orchestration layer.

**Architecture:** In-place swap. The Notion helpers in `meetings/notion.js` and `daily/notion.js` are fully implemented and unchanged. This plan updates config, setup, meetings sync, daily page sync, and status command — replacing all Obsidian-specific orchestration code. Obsidian modules remain but are no longer called.

**Tech Stack:** Node.js ESM, `@notionhq/client` (Notion API), existing `meetings/notion.js` and `daily/notion.js` helpers.

---

### Task 1: Add @notionhq/client dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run from the repo root:
```bash
npm install @notionhq/client
```
Expected: `@notionhq/client` appears in `package.json` dependencies and `node_modules/`.

- [ ] **Step 2: Update package.json metadata**

In `package.json`, make two changes:
- `"description"`: change to `"Sync Outlook calendar meetings to Notion"`
- `"keywords"`: remove `"obsidian"`, add `"notion"`

Final keywords array:
```json
"keywords": [
  "calendar",
  "notion",
  "automation",
  "cli"
]
```

- [ ] **Step 3: Verify**

```bash
node -e "import('@notionhq/client').then(m => console.log('OK:', typeof m.Client))"
```
Expected: `OK: function`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @notionhq/client dependency"
```

---

### Task 2: Update config schema

**Files:**
- Modify: `src/config/schema.js`

- [ ] **Step 1: Replace the config schema**

Replace the entire contents of `src/config/schema.js` with:

```js
import os from 'os';
import path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
export const CONFIG_FILE = 'config.json';

export const DEFAULT_CONFIG = {
  icsUrl: null,
  userEmail: null,
  teamsWebhookUrl: null,
  timezone: null,
  notionApiKey: null,
  notionMeetingsDatabaseId: null,
  notionDaysDatabaseId: null,
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

  return {
    valid: errors.length === 0,
    errors
  };
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/config/schema.js').then(m => console.log(Object.keys(m.DEFAULT_CONFIG)))"
```
Expected: `[ 'icsUrl', 'userEmail', 'teamsWebhookUrl', 'timezone', 'notionApiKey', 'notionMeetingsDatabaseId', 'notionDaysDatabaseId' ]`

- [ ] **Step 3: Commit**

```bash
git add src/config/schema.js
git commit -m "feat: replace obsidianVaultPath with Notion config fields"
```

---

### Task 3: Update setup command

**Files:**
- Modify: `src/commands/setup.js`

- [ ] **Step 1: Replace the setup command**

Replace the entire contents of `src/commands/setup.js` with:

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import { Client } from '@notionhq/client';
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

async function validateNotionDatabase(apiKey, databaseId, label) {
  try {
    const client = new Client({ auth: apiKey });
    const db = await client.databases.retrieve({ database_id: databaseId });
    if (db.object !== 'database') {
      return { valid: false, error: `${label}: integration does not have full access to this database` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `${label}: ${err.message}` };
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

    // Step 2: Notion API key
    const apiKeyPrompt = await prompts({
      type: 'text',
      name: 'notionApiKey',
      message: 'Notion integration API key (starts with secret_):',
      validate: value => value.trim() ? true : 'Notion API key is required',
    });
    if (!apiKeyPrompt.notionApiKey) { console.log('\nSetup cancelled.'); return; }
    const notionApiKey = apiKeyPrompt.notionApiKey.trim();

    // Step 3: Meetings database ID
    const meetingsDbPrompt = await prompts({
      type: 'text',
      name: 'notionMeetingsDatabaseId',
      message: 'Notion meetings database ID:',
      validate: value => value.trim() ? true : 'Meetings database ID is required',
    });
    if (!meetingsDbPrompt.notionMeetingsDatabaseId) { console.log('\nSetup cancelled.'); return; }
    const notionMeetingsDatabaseId = meetingsDbPrompt.notionMeetingsDatabaseId.trim();

    // Step 4: Days database ID
    const daysDbPrompt = await prompts({
      type: 'text',
      name: 'notionDaysDatabaseId',
      message: 'Notion days database ID:',
      validate: value => value.trim() ? true : 'Days database ID is required',
    });
    if (!daysDbPrompt.notionDaysDatabaseId) { console.log('\nSetup cancelled.'); return; }
    const notionDaysDatabaseId = daysDbPrompt.notionDaysDatabaseId.trim();

    // Validate both databases with the provided API key
    const notionSpinner = ora('Validating Notion databases...').start();
    const meetingsValidation = await validateNotionDatabase(notionApiKey, notionMeetingsDatabaseId, 'Meetings database');
    if (!meetingsValidation.valid) { notionSpinner.fail(meetingsValidation.error); return; }
    const daysValidation = await validateNotionDatabase(notionApiKey, notionDaysDatabaseId, 'Days database');
    if (!daysValidation.valid) { notionSpinner.fail(daysValidation.error); return; }
    notionSpinner.succeed('Notion databases connected');

    await updateConfig({ notionApiKey, notionMeetingsDatabaseId, notionDaysDatabaseId });

    // Step 5: User email (for declined-event filtering)
    const emailPrompt = await prompts({
      type: 'text',
      name: 'userEmail',
      message: 'Your email address (for filtering declined meetings):',
    });
    if (emailPrompt.userEmail && emailPrompt.userEmail.trim()) {
      await updateConfig({ userEmail: emailPrompt.userEmail.trim() });
    }

    // Step 6: Teams webhook URL (optional)
    const teamsPrompt = await prompts({
      type: 'text',
      name: 'teamsWebhookUrl',
      message: 'Teams webhook URL (optional — press Enter to skip):',
    });
    if (teamsPrompt.teamsWebhookUrl && teamsPrompt.teamsWebhookUrl.trim()) {
      await updateConfig({ teamsWebhookUrl: teamsPrompt.teamsWebhookUrl.trim() });
    }

    // Step 7: Display timezone (optional)
    const timezonePrompt = await prompts({
      type: 'text',
      name: 'timezone',
      message: 'Display timezone (e.g. Europe/Oslo — press Enter to use system default):',
      validate: value => {
        if (!value.trim()) return true;
        try {
          Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
          return true;
        } catch {
          return `Unknown timezone "${value.trim()}". Use an IANA ID like America/Chicago or Europe/London.`;
        }
      },
    });
    if (timezonePrompt.timezone && timezonePrompt.timezone.trim()) {
      await updateConfig({ timezone: timezonePrompt.timezone.trim() });
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

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/commands/setup.js').then(m => console.log('OK:', typeof m.setupCommand))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/commands/setup.js
git commit -m "feat: replace Obsidian vault setup with Notion API key and database ID prompts"
```

---

### Task 4: Update meetings/index.js

**Files:**
- Modify: `src/meetings/index.js`

- [ ] **Step 1: Replace meetings/index.js**

Replace the entire contents of `src/meetings/index.js` with:

```js
import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';
import { loadCache, saveCache } from '../calendar/cache.js';
import { resolveDataSourceId, fetchAllMeetingPages } from './notion.js';
import { reconcileMeetings } from './reconciler.js';

export async function syncMeetings(events, { changed }) {
  if (!changed) {
    console.log('Meetings unchanged since last run — skipping');
    return [];
  }

  const config = await loadConfig();
  if (!config.notionApiKey || !config.notionMeetingsDatabaseId) {
    throw new Error('Notion not configured. Run: prepare-my-day setup');
  }

  const client = new Client({ auth: config.notionApiKey });
  const dataSourceId = await resolveDataSourceId(client, config.notionMeetingsDatabaseId);
  const seriesPages = await fetchAllMeetingPages(client, dataSourceId);
  const cache = await loadCache();
  const date = new Date().toISOString().slice(0, 10);

  const { results, updatedMeetingMap } = await reconcileMeetings(seriesPages, events, {
    client,
    dataSourceId,
    date,
    cache,
  });

  await saveCache(
    date,
    cache.hash ?? '',
    updatedMeetingMap
  );

  return results;
}

export { matchEvent } from './matcher.js';
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/meetings/index.js').then(m => console.log('OK:', typeof m.syncMeetings))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/meetings/index.js
git commit -m "feat: wire meetings sync to Notion API"
```

---

### Task 5: Update meetings/reconciler.js

**Files:**
- Modify: `src/meetings/reconciler.js`

Result shape changes: `filePath` and `seriesCreated` are removed; `pageId` (the Notion page UUID) is added. Cache map values are now page IDs instead of file paths.

- [ ] **Step 1: Replace reconciler.js**

Replace the entire contents of `src/meetings/reconciler.js` with:

```js
import { matchEvent } from './matcher.js';
import { createMeetingPage } from './notion.js';
import { hashSingleEvent } from '../calendar/cache.js';

function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (cached > 0) summary += `, ${cached} unchanged (cached)`;
  console.log(summary);
}

export async function reconcileMeetings(seriesPages, events, { client, dataSourceId, date, cache }) {
  const results = [];
  const updatedMeetingMap = { ...cache.meetingMap };

  for (const event of events) {
    const eventHash = hashSingleEvent(event);

    if (cache.meetingMap[eventHash]) {
      results.push({
        eventTitle: event.title,
        matchType: 'cached',
        pageId: cache.meetingMap[eventHash],
        score: 0,
        start: event.start.toISOString(),
      });
      continue;
    }

    const match = matchEvent(event.title, seriesPages, 0.8);

    let pageId;
    let matchType;
    let score;

    if (match.type === 'exact' || match.type === 'fuzzy') {
      pageId = match.page.id;
      matchType = match.type;
      score = match.score;
    } else {
      const page = await createMeetingPage(client, dataSourceId, event.title);
      pageId = page.id;
      matchType = 'created';
      score = 0;
    }

    results.push({
      eventTitle: event.title,
      matchType,
      pageId,
      score,
      start: event.start.toISOString(),
    });
    updatedMeetingMap[eventHash] = pageId;
  }

  printSummary(results);
  return { results, updatedMeetingMap };
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/meetings/reconciler.js').then(m => console.log('OK:', typeof m.reconcileMeetings))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/meetings/reconciler.js
git commit -m "feat: replace Obsidian file creation with Notion page creation in reconciler"
```

---

### Task 6: Update daily/blocks.js

**Files:**
- Modify: `src/daily/blocks.js`

Replace `buildMeetingLines` (markdown wikilink strings) with `buildMeetingBlocks` (Notion to_do block objects). Each block contains the meeting time as plain text and a page mention linking to the meeting's `pageId`.

- [ ] **Step 1: Replace daily/blocks.js**

Replace the entire contents of `src/daily/blocks.js` with:

```js
import { formatEventTime } from '../utils/timezone.js';

export function sortMeetingResults(results) {
  return [...results].sort((a, b) => {
    const timeDiff = new Date(a.start) - new Date(b.start);
    if (timeDiff !== 0) return timeDiff;
    return a.eventTitle.localeCompare(b.eventTitle);
  });
}

export function buildMeetingBlocks(sortedResults, timezone) {
  return sortedResults.map(result => {
    const time = formatEventTime(new Date(result.start), timezone);
    return {
      type: 'to_do',
      to_do: {
        rich_text: [
          {
            type: 'text',
            text: { content: `${time} ` },
          },
          {
            type: 'mention',
            mention: {
              type: 'page',
              page: { id: result.pageId },
            },
          },
        ],
        checked: false,
      },
    };
  });
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/daily/blocks.js').then(m => console.log('OK:', typeof m.buildMeetingBlocks, typeof m.sortMeetingResults))"
```
Expected: `OK: function function`

- [ ] **Step 3: Commit**

```bash
git add src/daily/blocks.js
git commit -m "feat: replace buildMeetingLines with buildMeetingBlocks for Notion to_do blocks"
```

---

### Task 7: Update daily/index.js

**Files:**
- Modify: `src/daily/index.js`

Switch from Obsidian imports to Notion. Creates a Notion client, resolves the days data source ID (reusing `resolveDataSourceId` from `meetings/notion.js`), then calls the Notion daily page functions.

- [ ] **Step 1: Replace daily/index.js**

Replace the entire contents of `src/daily/index.js` with:

```js
import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';
import { resolveDataSourceId } from '../meetings/notion.js';
import { findTodayPage, createTodayPage, hasMeetingsSection, prependMeetingsSection } from './notion.js';
import { sortMeetingResults, buildMeetingBlocks } from './blocks.js';

export async function syncDailyPage(results) {
  if (results.length === 0) {
    console.log('No meetings to link — skipping daily page');
    return;
  }

  const config = await loadConfig();
  if (!config.notionApiKey || !config.notionDaysDatabaseId) {
    throw new Error('Notion not configured. Run: prepare-my-day setup');
  }

  const client = new Client({ auth: config.notionApiKey });
  const daysDataSourceId = await resolveDataSourceId(client, config.notionDaysDatabaseId);

  const sorted = sortMeetingResults(results);
  const meetingBlocks = buildMeetingBlocks(sorted, config.timezone);

  const existingPage = await findTodayPage(client, daysDataSourceId);

  if (!existingPage) {
    await createTodayPage(client, daysDataSourceId, meetingBlocks);
    console.log('Daily page created with meetings section');
    return;
  }

  const alreadyDone = await hasMeetingsSection(client, existingPage.id);
  if (alreadyDone) {
    console.log('Daily page already has meetings — skipping');
    return;
  }

  await prependMeetingsSection(client, existingPage.id, meetingBlocks);
  console.log(`Daily page updated: ${results.length} meeting(s) linked`);
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/daily/index.js').then(m => console.log('OK:', typeof m.syncDailyPage))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/daily/index.js
git commit -m "feat: wire daily page sync to Notion API"
```

---

### Task 8: Update status command

**Files:**
- Modify: `src/commands/status.js`

Replace Obsidian vault checks with Notion connectivity checks for both databases.

- [ ] **Step 1: Replace status.js**

Replace the entire contents of `src/commands/status.js` with:

```js
import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';

async function checkNotionDatabase(client, databaseId, label) {
  try {
    const db = await client.databases.retrieve({ database_id: databaseId });
    if (db.object === 'database') {
      return `[x] Notion ${label} — connected`;
    }
    return `[ ] Notion ${label} — integration lacks full access (run: prepare-my-day setup)`;
  } catch (err) {
    return `[ ] Notion ${label} — ${err.message} (run: prepare-my-day setup)`;
  }
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

  // Notion
  if (config && config.notionApiKey) {
    const client = new Client({ auth: config.notionApiKey });

    if (config.notionMeetingsDatabaseId) {
      console.log(await checkNotionDatabase(client, config.notionMeetingsDatabaseId, 'meetings database'));
    } else {
      console.log('[ ] Notion meetings database — not configured (run: prepare-my-day setup)');
    }

    if (config.notionDaysDatabaseId) {
      console.log(await checkNotionDatabase(client, config.notionDaysDatabaseId, 'days database'));
    } else {
      console.log('[ ] Notion days database — not configured (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Notion — not configured (run: prepare-my-day setup)');
  }

  console.log();
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/commands/status.js').then(m => console.log('OK:', typeof m.statusCommand))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/commands/status.js
git commit -m "feat: replace Obsidian vault status checks with Notion database connectivity checks"
```

---

### Task 9: Update sync spinner text

**Files:**
- Modify: `src/commands/sync.js`

- [ ] **Step 1: Update the spinner text**

In `src/commands/sync.js`, find:
```js
const meetingsSpinner = ora('Syncing meetings to Obsidian vault...').start();
```
Change it to:
```js
const meetingsSpinner = ora('Syncing meetings to Notion...').start();
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./src/commands/sync.js').then(m => console.log('OK:', typeof m.syncCommand))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/commands/sync.js
git commit -m "chore: update sync spinner text for Notion"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Clear the old calendar cache**

The cache at `~/.prepare-my-day/calendar-cache.json` stores event hash → file path mappings from the Obsidian era. Clear it so the first Notion sync runs fresh:

```bash
rm -f ~/.prepare-my-day/calendar-cache.json
```

- [ ] **Step 2: Run setup to configure Notion credentials**

```bash
node src/index.js setup
```
Enter the ICS URL, Notion API key, meetings database ID, and days database ID when prompted. Expected: "Setup complete!"

- [ ] **Step 3: Run status to confirm connectivity**

```bash
node src/index.js status
```
Expected output:
```
[x] Config — ~/.prepare-my-day/config.json
[x] Outlook — calendar feed reachable
[x] Notion meetings database — connected
[x] Notion days database — connected
```

- [ ] **Step 4: Run sync**

```bash
node src/index.js sync
```
Expected: fetches calendar events, matches against Notion meetings database, updates today's daily page in Notion. No Obsidian references in output.

- [ ] **Step 5: Verify no Obsidian references remain in wired-up files**

```bash
grep -r "obsidian\|vaultPath\|Obsidian" \
  src/commands/ \
  src/meetings/index.js \
  src/meetings/reconciler.js \
  src/daily/index.js \
  src/daily/blocks.js \
  src/config/schema.js
```
Expected: no output.
