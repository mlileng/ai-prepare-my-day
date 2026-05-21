# Paperclip JSON Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--json` flag to `prepare-my-day sync` that suppresses spinner UI and emits a structured JSON result to stdout, enabling Paperclip to trigger and monitor the sync as a scheduled shell agent.

**Architecture:** Two files change — `src/index.js` wires the flag into the CLI definition, and `src/commands/sync.js` gains a JSON output path that mirrors the accumulation logic already present in `src/mcp-server.js`. All pipeline modules are untouched. In JSON mode, `console.log` is redirected to stderr before the pipeline runs to prevent internal `printSummary` calls from polluting stdout.

**Tech Stack:** Node.js ESM, commander v14, ora v9. No test framework in this project — verification is manual via CLI.

---

## File Map

| File | Change |
|------|--------|
| `src/index.js` | Add `.option('--json', ...)` to sync command; update action signature |
| `src/commands/sync.js` | Accept `options` param; add `syncCommandJson()` internal function |

---

### Task 1: Wire `--json` flag in the CLI

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Add the option and update the action handler call**

In `src/index.js`, replace the sync command block:

```js
program
  .command('sync')
  .description('Sync today\'s meetings to Notion')
  .action(syncCommand);
```

with:

```js
program
  .command('sync')
  .description('Sync today\'s meetings to Obsidian vault')
  .option('--json', 'Output structured JSON result instead of spinner UI')
  .action(syncCommand);
```

Commander v14 passes parsed options as the first argument to `.action()` handlers on commands with no positional arguments. `syncCommand` currently accepts no arguments, so this is a non-breaking change — `options` will be `{}` when `--json` is not passed.

- [ ] **Step 2: Verify the flag is registered**

```bash
node src/index.js sync --help
```

Expected output includes:
```
Options:
  --json    Output structured JSON result instead of spinner UI
  -h, --help  display help for command
```

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: register --json flag on sync command"
```

---

### Task 2: Implement JSON output mode in sync command

**Files:**
- Modify: `src/commands/sync.js`

The reference implementation is the `sync_calendar` tool handler in `src/mcp-server.js` (lines 23–63). This task extracts that logic into the CLI layer.

- [ ] **Step 1: Update `syncCommand` to accept options and branch on `--json`**

Replace the entire contents of `src/commands/sync.js` with:

```js
import ora from 'ora';
import { getTodaysMeetings } from '../calendar/index.js';
import { syncMeetings } from '../meetings/index.js';
import { syncDailyPage } from '../daily/index.js';

function printSyncSummary(events, results) {
  const dailyPageStatus = results.length > 0 ? 'updated' : 'no meetings to link';
  console.log('');
  console.log('Sync complete:');
  console.log(`  Events fetched : ${events.length}`);
  console.log(`  Daily page     : ${dailyPageStatus}`);
}

async function syncCommandJson() {
  // Redirect console.log to stderr so pipeline's internal printSummary
  // calls don't pollute stdout and break JSON parsing by Paperclip.
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

  const result = {
    meetings_found: 0,
    meetings_created: 0,
    meetings_matched: 0,
    daily_page_updated: false,
    errors: [],
  };

  // Stage 1: Calendar
  let events;
  let changed;
  try {
    ({ events, changed } = await getTodaysMeetings());
    result.meetings_found = events.length;
  } catch (err) {
    result.errors.push(`Calendar: ${err.message}`);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
  }

  // Stage 2: Meetings
  let results;
  try {
    results = await syncMeetings(events, { changed });
    result.meetings_created = results.filter(r => r.matchType === 'created').length;
    result.meetings_matched = results.length - result.meetings_created;
  } catch (err) {
    result.errors.push(`Meetings: ${err.message}`);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
  }

  // Stage 3: Daily Page
  try {
    await syncDailyPage(results);
    result.daily_page_updated = results.length > 0;
  } catch (err) {
    result.errors.push(`Daily page: ${err.message}`);
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.errors.length > 0) process.exit(1);
}

export async function syncCommand(options = {}) {
  if (options.json) {
    return syncCommandJson();
  }

  // Stage 1: Calendar
  const calendarSpinner = ora('Fetching calendar events...').start();
  let events;
  let changed;
  try {
    ({ events, changed } = await getTodaysMeetings());
    calendarSpinner.succeed(`Calendar: ${events.length} event(s) for today`);
  } catch (err) {
    calendarSpinner.fail(`Calendar: ${err.message}`);
    process.exit(1);
  }

  // Stage 2: Meetings
  const meetingsSpinner = ora('Syncing meetings to Obsidian vault...').start();
  let results;
  try {
    results = await syncMeetings(events, { changed });
    meetingsSpinner.succeed('Meetings synced');
  } catch (err) {
    meetingsSpinner.fail(`Meetings: ${err.message}`);
    process.exit(1);
  }

  // Stage 3: Daily Page
  const dailySpinner = ora('Updating daily page...').start();
  try {
    await syncDailyPage(results);
    dailySpinner.succeed('Daily page updated');
  } catch (err) {
    dailySpinner.fail(`Daily page: ${err.message}`);
    process.exit(1);
  }

  printSyncSummary(events, results);
}
```

- [ ] **Step 2: Verify JSON output is valid and goes to stdout only**

Run the sync in JSON mode and pipe stdout to a file while capturing stderr separately:

```bash
node src/index.js sync --json >out.json 2>err.log
echo "Exit code: $?"
cat out.json
cat err.log
```

Expected:
- `out.json` contains exactly one line of valid JSON matching the shape below
- `err.log` contains the reconciler's `printSummary` line (e.g. `Meetings: 3 matched, ...`) — confirming it was correctly redirected
- Exit code is `0` on success

```json
{"meetings_found":3,"meetings_created":0,"meetings_matched":3,"daily_page_updated":true,"errors":[]}
```

- [ ] **Step 3: Verify default mode is unchanged**

```bash
node src/index.js sync
```

Expected: spinner UI appears as before — no JSON output, no regression.

- [ ] **Step 4: Verify exit code 1 on error**

Temporarily break the ICS URL in `~/.prepare-my-day/config.json` (change one character), run JSON mode, then restore:

```bash
node src/index.js sync --json; echo "Exit: $?"
```

Expected:
```json
{"meetings_found":0,"meetings_created":0,"meetings_matched":0,"daily_page_updated":false,"errors":["Calendar: ..."]}
```
```
Exit: 1
```

Restore the correct ICS URL before committing.

- [ ] **Step 5: Commit**

```bash
git add src/commands/sync.js
git commit -m "feat: add --json output mode to sync command for Paperclip integration"
```

---

### Task 3: Configure Paperclip

This task is configuration-only — no code changes.

- [ ] **Step 1: Find the full path to the CLI**

```bash
which prepare-my-day || echo "$(pwd)/src/index.js"
```

Use whichever path is returned. If installed globally via npm, `prepare-my-day sync --json` is sufficient. If running from the repo, use `node /full/path/to/src/index.js sync --json`.

- [ ] **Step 2: Register as a scheduled shell agent in Paperclip**

In the Paperclip dashboard, create a new agent with:
- **Type:** Shell command
- **Command:** `prepare-my-day sync --json` (or `node /full/path/to/src/index.js sync --json`)
- **Schedule:** Your preferred daily time (e.g. `0 7 * * 1-5` for 07:00 Mon–Fri)
- **Success condition:** Exit code `0`
- **Name:** e.g. `prepare-my-day`

- [ ] **Step 3: Trigger a manual run from Paperclip and confirm the JSON result appears in the job log**
