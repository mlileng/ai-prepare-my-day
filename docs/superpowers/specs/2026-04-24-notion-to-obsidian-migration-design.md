# Design: Migrate Storage Backend from Notion to Obsidian

**Date:** 2026-04-24
**Status:** Approved

## Overview

Replace the Notion API backend with local Obsidian vault file-system operations. The three-stage pipeline (calendar → meetings → daily) is preserved intact. Only the storage layer changes.

Target vault: `/Users/mlileng/code/crew-os/wiki/`

---

## Architecture

The pipeline structure is unchanged:

```
[ICS Feed] → calendar/ (unchanged)
           → meetings/ (matcher unchanged, notion.js → obsidian.js)
           → daily/ (blocks.js rewritten, notion.js → obsidian.js)
```

### Files removed

- `src/auth/notion.js` — no authentication required for local file system
- `src/utils/validation.js` — Notion URL parser, no longer needed

### Files replaced

- `src/meetings/notion.js` → `src/meetings/obsidian.js`
- `src/daily/notion.js` → `src/daily/obsidian.js`
- `src/daily/blocks.js` — rewritten to produce markdown instead of Notion block objects

### Files with light edits

- `src/config/schema.js` — config schema updated
- `src/meetings/index.js` — remove data_source_id logic, pass vault path
- `src/meetings/reconciler.js` — rename `notionPageId` → `filePath`
- `src/daily/index.js` — remove data_source_id logic, pass vault path
- `src/commands/setup.js` — new prompts for vault path
- `src/commands/status.js` — validate vault path instead of Notion token
- `src/mcp-server.js` — update sync_calendar return value

### Files untouched

- All of `src/calendar/` (fetcher, parser, cache, index)
- `src/meetings/matcher.js`
- `src/config/manager.js`
- `src/utils/timezone.js`
- `src/commands/sync.js`
- `src/commands/cron-setup.js`

---

## Config Schema

### Removed fields

| Field | Reason |
|-------|--------|
| `notionToken` | No Notion API |
| `meetingsDatabaseId` | Replaced by vault path |
| `daysDatabaseId` | Replaced by vault path |

### Added fields

| Field | Default | Description |
|-------|---------|-------------|
| `obsidianVaultPath` | `null` | Absolute path to the Obsidian vault |

### Kept fields

`icsUrl`, `userEmail`, `suppressedMeetings`, `teamsWebhookUrl`

### Folder paths

Hardcoded to match the existing vault structure — not user-configurable:

| Purpose | Path (relative to vault) |
|---------|--------------------------|
| Meeting series | `meetings/series/` |
| Meeting instances | `meetings/instances/` |
| Daily notes | `daily/` |

The `daily/` folder does not yet exist in the vault and is created on first run.

---

## Data Model Changes

### ReconciliationResult

```js
// Before
{ eventTitle, matchType, notionPageId, score, start }

// After
{ eventTitle, matchType, filePath, score, start }
```

`filePath` is a vault-relative path, e.g. `meetings/instances/2026-04-24-heidi-morten.md`.

### Cache (meetingMap)

Values change from Notion page IDs to vault-relative file paths. Old cache entries are ignored on first run; new entries are written as paths. No explicit migration step needed.

---

## Meetings Module (`src/meetings/obsidian.js`)

Replaces `src/meetings/notion.js`. Three functions:

**`fetchAllSeries(vaultPath)`**
- Reads all `.md` files from `meetings/series/`
- Extracts the `name` frontmatter field; falls back to filename if absent
- Returns objects compatible with the existing matcher (unchanged)

**`findExistingInstance(vaultPath, date, seriesSlug)`**
- Checks if `meetings/instances/YYYY-MM-DD-[slug].md` already exists
- Used as a re-run guard before creating a new instance

**`createMeetingInstance(vaultPath, event, seriesSlug)`**
- Writes `meetings/instances/YYYY-MM-DD-[slug].md`
- Follows the existing `_templates/meeting-instance.md` structure:
  - Frontmatter: `type`, `date`, `series` (wikilink to series file), `participants: []`, `tags: [meeting-instance]`
  - `## Agenda / Context` pre-filled with event title and time range
  - Remaining template sections left blank for manual fill
- Returns vault-relative file path

**Series slug derivation:**
- Matched events: slug taken from matched series filename (e.g. `heidi-morten.md` → `heidi-morten`)
- Unmatched events: slug kebab-cased from event title (e.g. `"Q2 Planning Session"` → `q2-planning-session`)

---

## Daily Module (`src/daily/obsidian.js`)

Replaces `src/daily/notion.js`. Four functions:

**`findTodayNote(vaultPath, date)`**
- Checks if `daily/YYYY-MM-DD.md` exists
- Returns boolean

**`hasMeetingsSection(vaultPath, date)`**
- Reads `daily/YYYY-MM-DD.md`, checks for `## Meetings` heading
- Re-run guard — prevents duplicate meetings sections on multiple runs

**`createDailyNote(vaultPath, date, meetingEntries)`**
- Creates `daily/YYYY-MM-DD.md` with full structure (see Daily Note Format below)
- Creates `daily/` folder if it doesn't exist

**`prependMeetingsSection(vaultPath, date, meetingEntries)`**
- Inserts `## Meetings` section after the nav line in an existing daily note
- Used when the daily note exists but was created without meetings (e.g. manually created)

---

## Daily Note Format

File: `daily/YYYY-MM-DD.md`

```markdown
---
type: daily-note
date: 2026-04-24
tags: [daily-note]
---

# Friday, April 24, 2026

← [[daily/2026-04-23]] | [[daily/2026-04-25]] →

## Meetings

- 09:00 [[meetings/instances/2026-04-24-heidi-morten|Heidi:Morten]]
- 10:30 [[meetings/instances/2026-04-24-weekly-poem-leadership-sync|Weekly POEM Leadership Sync]]

## Today's Focus

```

**Notes:**
- Prev/next nav links are static — they point to neighbouring dates regardless of whether those notes exist. Obsidian renders unresolved wikilinks gracefully.
- Meeting entries are sorted chronologically, alphabetical title as tiebreaker (existing `sortMeetingResults()` logic unchanged).
- Display label in wikilink uses the original calendar event title, not the series name.

---

## `src/daily/blocks.js` Rewrite

Produces markdown strings instead of Notion block objects. Sorting logic (`sortMeetingResults()`) is kept unchanged.

**`buildMeetingLines(sortedResults)`** — replaces `buildMeetingBlocks()`:
- Input: `[{ eventTitle, filePath, start, ... }]`
- Output: array of markdown strings, e.g. `- 09:00 [[meetings/instances/2026-04-24-heidi-morten|Heidi:Morten]]`
- Time formatted as `HH:MM` (24-hour) using existing `formatEventTime()` from `src/utils/timezone.js`

---

## Setup & Status Commands

**`src/commands/setup.js`** prompts:
1. ICS URL (unchanged — validated by HTTP fetch)
2. Obsidian vault path (validated: directory exists, contains `.obsidian/` folder)
3. Email for declined-event filtering (unchanged)
4. Teams webhook URL (unchanged, optional)

Notion token and database URL prompts are removed.

**`src/commands/status.js`** checks:
1. Config file exists
2. ICS feed reachable
3. Obsidian vault path set and valid
4. `meetings/series/` folder exists within vault
5. `meetings/instances/` folder exists within vault

---

## Dependencies

`@notionhq/client` is removed from `package.json`. No new dependencies needed — all Obsidian operations use Node's built-in `fs/promises`.

---

## Error Handling

Consistent with the existing fail-fast design — no retries, errors propagate immediately.

| Scenario | Behaviour |
|----------|-----------|
| Vault path not set | Config error with instructions to run `setup` |
| Vault path doesn't exist | Clear error: path not found |
| `meetings/series/` missing | Warning: no series to match against; all events create new instances |
| Instance file already exists | Skip creation, return existing path (re-run guard) |
| `daily/` folder missing | Created automatically on first run |
| Malformed series frontmatter | Skip file with warning, continue |

---

## Out of Scope

- Syncing back from Obsidian to any external system
- Reading or updating existing meeting instance content
- Creating new meeting series pages (only instances are created)
- Any changes to the MCP `post_to_teams` tool
- Dataview queries or plugin configuration
