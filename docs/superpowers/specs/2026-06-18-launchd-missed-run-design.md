---
name: launchd-missed-run
description: Replace RunAtLoad=false with RunAtLoad=true + once-per-day sentinel guard to catch syncs missed when the machine is off at the scheduled time
metadata:
  type: project
---

# LaunchAgent Missed-Run Recovery

## Problem

The existing LaunchAgent (`com.mlileng.prepare-my-day.sync.plist`) schedules sync at 07:00 on weekdays using `StartCalendarInterval`. If the machine is powered off at that time, launchd does not catch up — the run is silently skipped for the day.

`RunAtLoad` is currently `false`, which means loading the agent on login has no effect. The sync simply doesn't run until the next scheduled 7am slot.

## Goal

When the machine boots or the user logs in after a missed 7am run, the sync fires automatically — but only once per day, not on every login.

## Design

### 1. `--once-per-day` flag in `sync` command

Add a `--once-per-day` option to `syncCommand` in `src/commands/sync.js`.

**Behavior when flag is set:**

- Before any sync work, read `~/.prepare-my-day/last-run-date` (a plain text file containing an ISO date string, e.g. `2026-06-18`)
- If the file contains today's date, print "Already ran today — skipping" and exit 0
- After a successful sync (all three stages complete without error), write today's date to that file
- If sync fails (any stage throws), do not write the sentinel — the next login attempt will retry

**Behavior when flag is not set:** unchanged. Manual `prepare-my-day sync` runs always execute.

**Sentinel file path:** `~/.prepare-my-day/last-run-date`

Both the human-readable and `--json` output modes respect the flag. In `--json` mode, an early-exit due to the sentinel adds `"skipped": true` to the output JSON.

### 2. `launchd-setup` command (`src/commands/launchd-setup.js`)

New CLI command with three modes:

| Invocation | Behaviour |
|---|---|
| `prepare-my-day launchd-setup` | Print the generated plist to stdout (inspect before installing) |
| `prepare-my-day launchd-setup --install` | Write plist to `~/Library/LaunchAgents/`, run `launchctl bootstrap gui/<uid>` |
| `prepare-my-day launchd-setup --uninstall` | Run `launchctl bootout gui/<uid>`, remove plist file |

The generated plist differs from the current hand-crafted one in four ways:

1. **`RunAtLoad=true`** — triggers sync on login, catching missed runs
2. **`--once-per-day` in `ProgramArguments`** — prevents re-runs within the same day
3. **Node path from `process.execPath`** — resolved at install time, not hardcoded to `/opt/homebrew/opt/node/bin/node`
4. **`EnvironmentVariables` key** — sets `PREPARE_MY_DAY_TRIGGER=launchd`

Plist label and file name are unchanged: `com.mlileng.prepare-my-day.sync`.

`--install` replaces any existing plist at that path. If the agent is already loaded, it first runs `launchctl bootout` before writing the new plist and running `launchctl bootstrap`.

### 3. `src/index.js` — register command

Add `launchd-setup` alongside the existing commands. Options: `--install` (boolean), `--uninstall` (boolean).

## Data Flow

```
Login / boot
  └─ launchd loads com.mlileng.prepare-my-day.sync
       └─ RunAtLoad=true → fires ProgramArguments immediately
            └─ node src/index.js sync --once-per-day
                 ├─ read ~/.prepare-my-day/last-run-date
                 ├─ date matches today? → exit 0 ("Already ran today")
                 └─ date missing or old? → run full sync pipeline
                      └─ on success → write today's date to sentinel

07:00 weekday (machine on)
  └─ launchd fires StartCalendarInterval
       └─ same path as above
```

## Files Changed

| File | Change |
|---|---|
| `src/commands/sync.js` | Add `--once-per-day` option, sentinel read before sync, sentinel write after success |
| `src/commands/launchd-setup.js` | New file |
| `src/index.js` | Register `launchd-setup` command |

## Files Not Changed

- The existing plist at `~/Library/LaunchAgents/com.mlileng.prepare-my-day.sync.plist` is updated only when the user runs `launchd-setup --install`. It is not touched by the code changes alone.
- `cron-setup.js` is unchanged — it remains available but is superseded by `launchd-setup` for macOS users.

## Edge Cases

- **Sync fails on login catchup**: sentinel is not written, so the next login will retry. This is intentional — a failed run shouldn't count as "ran today."
- **User runs `sync` manually after launchd already ran**: manual runs without `--once-per-day` always execute. The sentinel is not checked.
- **User runs `sync --once-per-day` manually after launchd already ran**: exits immediately. Expected behaviour — the flag opts into once-per-day semantics regardless of caller.
- **Clock skew / timezone**: dates are compared as local date strings (`YYYY-MM-DD`) using the system timezone, matching how the rest of the tool formats dates.
