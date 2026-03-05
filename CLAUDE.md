# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Node.js CLI tool (`prepare-my-day`) that syncs Outlook calendar meetings to Notion. It fetches an ICS calendar feed, matches events against existing Notion meeting pages using fuzzy title matching, creates new pages for unmatched events, and links everything to a daily page.

## Commands

```bash
node src/index.js setup      # Interactive setup (ICS URL, Notion token, database URLs)
node src/index.js sync       # Run the full sync pipeline
node src/index.js status     # Check authentication status
node src/index.js cron-setup # Print crontab entry for scheduled runs
```

No build step, no TypeScript, no test framework. Pure ESM (`"type": "module"` in package.json). Run directly with Node.

## Architecture

The sync pipeline runs three stages sequentially (see `src/commands/sync.js`):

1. **Calendar** (`src/calendar/`) — Fetch ICS feed, parse today's events, check content-hash cache to detect changes
2. **Meetings** (`src/meetings/`) — Match calendar events to existing Notion pages via bidirectional substring + Levenshtein fuzzy matching (threshold 0.8), create new pages for unmatched events
3. **Daily Page** (`src/daily/`) — Find/create today's daily page, prepend a Meetings section with chronological to-do blocks linking to meeting pages

Each module exposes a single public entry point from its `index.js`: `getTodaysMeetings()`, `syncMeetings()`, `syncDailyPage()`.

### Key Design Decisions

- **Fail-fast, no retries** — Notion API errors and network failures propagate immediately. No catch-and-retry logic.
- **Cache-based skip** — If the calendar event hash hasn't changed since the last run today, meeting sync is skipped entirely. Cache lives at `~/.prepare-my-day/calendar-cache.json`.
- **Re-run guard** — Daily page sync checks for an existing "Meetings" H2 heading before prepending; duplicate runs are safe.
- **Config file credentials** — All secrets (Notion token, ICS URL) stored in `~/.prepare-my-day/config.json`. No keychain integration.

### Module Map

- `src/config/` — Config schema, load/save/update from `~/.prepare-my-day/config.json`
- `src/auth/notion.js` — Notion client factory and token/database validation
- `src/calendar/fetcher.js` — HTTP fetch of ICS feed
- `src/calendar/parser.js` — ICS parsing to CalendarEvent objects (uses `node-ical`)
- `src/calendar/cache.js` — MD5 content hash cache for change detection
- `src/meetings/matcher.js` — Two-stage title matching (substring then Levenshtein via `fastest-levenshtein`)
- `src/meetings/reconciler.js` — Orchestrates match/create for each event against Notion
- `src/meetings/notion.js` — Notion API helpers for meeting pages (data source resolution, page queries)
- `src/daily/blocks.js` — Builds Notion block objects for the meetings section
- `src/daily/notion.js` — Notion API helpers for daily pages (find, create, prepend)
- `src/utils/timezone.js` — Event time formatting with timezone support
- `src/utils/validation.js` — Notion database URL parsing

### Dependencies

- `commander` — CLI framework
- `@notionhq/client` — Notion API
- `node-ical` — ICS parsing
- `fastest-levenshtein` — Fuzzy string matching
- `ora` — Terminal spinners
- `prompts` — Interactive setup prompts
