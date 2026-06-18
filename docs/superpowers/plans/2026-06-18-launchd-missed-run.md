# LaunchAgent Missed-Run Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--once-per-day` sentinel guard to the sync command and a `launchd-setup` CLI command that installs a corrected LaunchAgent plist with `RunAtLoad=true`, so missed 7am runs are caught on next login.

**Architecture:** The sync command gains a `--once-per-day` flag that reads/writes a sentinel file (`~/.prepare-my-day/last-run-date`) to skip duplicate runs within the same calendar day. A new `launchd-setup` command generates and installs a plist that sets `RunAtLoad=true`, uses `process.execPath` for the node path, and passes `--once-per-day` to sync.

**Tech Stack:** Node.js ESM, `fs`, `os`, `path`, `child_process` (stdlib only — no new dependencies)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/commands/sync.js` | Modify | Add sentinel read/write + `--once-per-day` option |
| `src/commands/launchd-setup.js` | Create | Generate plist, install/uninstall LaunchAgent |
| `src/index.js` | Modify | Register `launchd-setup` command |

---

### Task 1: Add `--once-per-day` sentinel guard to `sync` command

**Files:**
- Modify: `src/commands/sync.js`

- [ ] **Step 1: Add imports and sentinel helpers at the top of `src/commands/sync.js`**

Replace the top of the file (lines 1–4) with:

```js
import fs from 'fs';
import os from 'os';
import path from 'path';
import ora from 'ora';
import { getTodaysMeetings } from '../calendar/index.js';
import { syncMeetings } from '../meetings/index.js';
import { syncDailyPage } from '../daily/index.js';

const SENTINEL_PATH = path.join(os.homedir(), '.prepare-my-day', 'last-run-date');

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function alreadyRanToday() {
  try {
    return fs.readFileSync(SENTINEL_PATH, 'utf8').trim() === todayString();
  } catch {
    return false;
  }
}

function writeSentinel() {
  fs.writeFileSync(SENTINEL_PATH, todayString(), 'utf8');
}
```

- [ ] **Step 2: Pass `options` into `syncCommandJson` and add sentinel check**

Replace the `syncCommandJson` function signature and add the early-exit block. Change:

```js
async function syncCommandJson() {
  // Redirect console.log to stderr so pipeline's internal printSummary
  // calls don't pollute stdout and break JSON parsing by Paperclip.
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

  const { ts, trigger } = getRunMeta();
  const result = {
    ran_at: ts,
    triggered_by: trigger,
    meetings_found: 0,
    meetings_created: 0,
    meetings_matched: 0,
    daily_page_updated: false,
    errors: [],
  };
```

To:

```js
async function syncCommandJson(options = {}) {
  // Redirect console.log to stderr so pipeline's internal printSummary
  // calls don't pollute stdout and break JSON parsing by Paperclip.
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

  const { ts, trigger } = getRunMeta();
  const result = {
    ran_at: ts,
    triggered_by: trigger,
    meetings_found: 0,
    meetings_created: 0,
    meetings_matched: 0,
    daily_page_updated: false,
    skipped: false,
    errors: [],
  };

  if (options.oncePerDay && alreadyRanToday()) {
    result.skipped = true;
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
```

- [ ] **Step 3: Write sentinel after successful JSON-mode sync**

At the end of `syncCommandJson`, replace:

```js
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.errors.length > 0) process.exit(1);
}
```

With:

```js
  if (options.oncePerDay && result.errors.length === 0) writeSentinel();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.errors.length > 0) process.exit(1);
}
```

- [ ] **Step 4: Pass `options` through from `syncCommand` to `syncCommandJson`**

In `syncCommand`, change:

```js
  if (options.json) {
    return syncCommandJson();
  }
```

To:

```js
  if (options.json) {
    return syncCommandJson(options);
  }
```

- [ ] **Step 5: Add sentinel check and write to human-readable mode**

In `syncCommand`, after the `if (options.json)` block, add the early-exit check:

```js
  if (options.oncePerDay && alreadyRanToday()) {
    console.log('Already ran today — skipping');
    return;
  }
```

Then at the very end of `syncCommand`, after `printSyncSummary(events, results);`, add:

```js
  if (options.oncePerDay) writeSentinel();
```

- [ ] **Step 6: Verify the full file looks correct**

Run:
```bash
node src/index.js sync --help
```

Expected output includes `--once-per-day` is NOT listed yet (that's added in Task 3 via index.js). The command should still run normally.

```bash
node src/index.js sync
```

Expected: normal sync output, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/sync.js
git commit -m "feat: add --once-per-day sentinel guard to sync command"
```

---

### Task 2: Create `launchd-setup` command

**Files:**
- Create: `src/commands/launchd-setup.js`

- [ ] **Step 1: Create `src/commands/launchd-setup.js`**

```js
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

const PLIST_LABEL = 'com.mlileng.prepare-my-day.sync';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function generatePlist() {
  const nodePath = process.execPath;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(__dirname, '../index.js');
  const logPath = path.join(os.homedir(), '.prepare-my-day', 'sync.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>sync</string>
        <string>--once-per-day</string>
    </array>

    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PREPARE_MY_DAY_TRIGGER</key>
        <string>launchd</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>

    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;
}

export function launchdSetupCommand(options = {}) {
  if (options.install) {
    const plist = generatePlist();
    const uid = os.userInfo().uid;

    // Unload existing agent if already loaded (ignore errors — it may not be loaded)
    try {
      execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Not currently loaded — fine
    }

    fs.writeFileSync(PLIST_PATH, plist, 'utf8');
    execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`);

    console.log(`Installed: ${PLIST_PATH}`);
    console.log('Sync will run at 07:00 on weekdays, and on login if a run was missed.');
    return;
  }

  if (options.uninstall) {
    const uid = os.userInfo().uid;
    try {
      execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Already not loaded
    }
    if (fs.existsSync(PLIST_PATH)) {
      fs.unlinkSync(PLIST_PATH);
      console.log(`Removed: ${PLIST_PATH}`);
    } else {
      console.log('LaunchAgent plist not found — nothing to remove.');
    }
    return;
  }

  // Default: print generated plist for inspection
  console.log(generatePlist());
}
```

- [ ] **Step 2: Verify the file parses correctly**

```bash
node --input-type=module <<'EOF'
import { launchdSetupCommand } from './src/commands/launchd-setup.js';
console.log('imported ok');
EOF
```

Expected: `imported ok`

- [ ] **Step 3: Commit**

```bash
git add src/commands/launchd-setup.js
git commit -m "feat: add launchd-setup command for LaunchAgent install/uninstall"
```

---

### Task 3: Register `launchd-setup` in `src/index.js` and register `--once-per-day` on sync

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Add the import for `launchdSetupCommand`**

In `src/index.js`, after the existing imports, add:

```js
import { launchdSetupCommand } from './commands/launchd-setup.js';
```

- [ ] **Step 2: Add `--once-per-day` option to the sync command registration**

Change:

```js
program
  .command('sync')
  .description('Sync today\'s meetings to Notion')
  .option('--json', 'Output structured JSON result instead of spinner UI')
  .action(syncCommand);
```

To:

```js
program
  .command('sync')
  .description('Sync today\'s meetings to Notion')
  .option('--json', 'Output structured JSON result instead of spinner UI')
  .option('--once-per-day', 'Skip if sync already ran today (used by LaunchAgent)')
  .action(syncCommand);
```

- [ ] **Step 3: Register the `launchd-setup` command**

After the `cron-setup` command block, add:

```js
program
  .command('launchd-setup')
  .description('Install or remove the macOS LaunchAgent for scheduled sync')
  .option('--install', 'Write plist to ~/Library/LaunchAgents/ and load it via launchctl')
  .option('--uninstall', 'Unload and remove the LaunchAgent plist')
  .action(launchdSetupCommand);
```

- [ ] **Step 4: Verify help output**

```bash
node src/index.js --help
```

Expected: `launchd-setup` appears in the command list.

```bash
node src/index.js launchd-setup --help
```

Expected: `--install` and `--uninstall` options listed.

```bash
node src/index.js sync --help
```

Expected: `--once-per-day` option listed.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: register launchd-setup command and --once-per-day sync option"
```

---

### Task 4: Install updated LaunchAgent and verify end-to-end

**Files:** none (runtime verification only)

- [ ] **Step 1: Preview the generated plist**

```bash
node src/index.js launchd-setup
```

Expected: valid XML plist printed to stdout with:
- `RunAtLoad` = `<true/>`
- `--once-per-day` in `ProgramArguments`
- `PREPARE_MY_DAY_TRIGGER` = `launchd` in `EnvironmentVariables`
- Node path matching `which node` or `/opt/homebrew/...`

- [ ] **Step 2: Install the LaunchAgent**

```bash
node src/index.js launchd-setup --install
```

Expected:
```
Installed: /Users/mlileng/Library/LaunchAgents/com.mlileng.prepare-my-day.sync.plist
Sync will run at 07:00 on weekdays, and on login if a run was missed.
```

- [ ] **Step 3: Verify launchd loaded it**

```bash
launchctl list | grep prepare-my-day
```

Expected: a line with `com.mlileng.prepare-my-day.sync` (PID column will be `-` if not currently running, exit code `0` if last run succeeded)

- [ ] **Step 4: Test the sentinel guard manually**

```bash
node src/index.js sync --once-per-day
```

Expected: runs sync normally (no sentinel exists yet or sentinel is from a previous day).

Run it again immediately:

```bash
node src/index.js sync --once-per-day
```

Expected: `Already ran today — skipping`

- [ ] **Step 5: Confirm sentinel file was written**

```bash
cat ~/.prepare-my-day/last-run-date
```

Expected: today's date, e.g. `2026-06-18`

- [ ] **Step 6: Test that manual sync without flag still works**

```bash
node src/index.js sync
```

Expected: full sync runs regardless of sentinel.

- [ ] **Step 7: Bump minor version to 0.7.0**

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.
In `src/index.js`, change `.version('0.6.0')` to `.version('0.7.0')`.

- [ ] **Step 8: Commit, tag, and push**

```bash
git add package.json src/index.js
git commit -m "chore: bump version to 0.7.0"
git tag v0.7.0
git push && git push origin v0.7.0
```
