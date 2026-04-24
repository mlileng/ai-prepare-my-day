# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Node.js CLI tool (`prepare-my-day`) that syncs Outlook calendar meetings to a local Obsidian vault. It fetches an ICS calendar feed, matches events against existing Obsidian meeting series pages using fuzzy title matching, creates new instance pages for unmatched events, and builds or updates a daily note with wikilinks to those instances.

## Commands

```bash
node src/index.js setup      # Interactive setup (ICS URL, Obsidian vault path, email)
node src/index.js sync       # Run the full sync pipeline
node src/index.js status     # Check configuration status
node src/index.js cron-setup # Print crontab entry for scheduled runs
```

No build step, no TypeScript, no test framework. Pure ESM (`"type": "module"` in package.json). Run directly with Node.

## Architecture

The sync pipeline runs three stages sequentially (see `src/commands/sync.js`):

1. **Calendar** (`src/calendar/`) — Fetch ICS feed, parse today's events, check content-hash cache to detect changes
2. **Meetings** (`src/meetings/`) — Match calendar events to existing Obsidian series pages via bidirectional substring + Levenshtein fuzzy matching (threshold 0.8), create new instance files for unmatched events
3. **Daily Page** (`src/daily/`) — Find/create today's daily note, prepend a Meetings section with chronological wikilinks to instance files

Each module exposes a single public entry point from its `index.js`: `getTodaysMeetings()`, `syncMeetings()`, `syncDailyPage()`.

### Key Design Decisions

- **Fail-fast, no retries** — File system errors and network failures propagate immediately. No catch-and-retry logic.
- **Cache-based skip** — If the calendar event hash hasn't changed since the last run today, meeting sync is skipped entirely. Cache lives at `~/.prepare-my-day/calendar-cache.json`.
- **Re-run guard** — Daily page sync checks for an existing "Meetings" H2 heading before prepending; duplicate runs are safe. Instance files are also skipped if they already exist.
- **Config file credentials** — ICS URL stored in `~/.prepare-my-day/config.json`. No keychain integration.

### Vault Structure

The tool expects and writes to these paths within the configured vault:

| Folder | Contents |
|--------|----------|
| `meetings/series/` | One `.md` file per recurring meeting series (must exist before first run) |
| `meetings/instances/` | Dated instance files created per sync run (e.g. `2026-04-24-heidi-morten.md`) |
| `daily/` | Daily notes (e.g. `2026-04-24.md`) — created on first run |

### Module Map

- `src/config/` — Config schema, load/save/update from `~/.prepare-my-day/config.json`
- `src/calendar/fetcher.js` — HTTP fetch of ICS feed
- `src/calendar/parser.js` — ICS parsing to CalendarEvent objects (uses `node-ical`)
- `src/calendar/cache.js` — MD5 content hash cache for change detection
- `src/meetings/matcher.js` — Two-stage title matching (substring then Levenshtein via `fastest-levenshtein`)
- `src/meetings/obsidian.js` — File system helpers for series pages and instance creation
- `src/meetings/reconciler.js` — Orchestrates match/create for each event against vault
- `src/daily/blocks.js` — Builds markdown wikilink lines for the meetings section
- `src/daily/obsidian.js` — File system helpers for daily notes (find, create, prepend)
- `src/utils/timezone.js` — Event time formatting with timezone support

### Dependencies

- `commander` — CLI framework
- `node-ical` — ICS parsing
- `fastest-levenshtein` — Fuzzy string matching
- `ora` — Terminal spinners
- `prompts` — Interactive setup prompts
