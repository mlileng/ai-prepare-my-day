# Notion Migration Design

**Date:** 2026-06-16
**Status:** Approved

## Overview

Migrate `prepare-my-day` from Obsidian as the sync target to Notion. The Notion API helpers (`meetings/notion.js` and `daily/notion.js`) are already implemented. This migration wires them into the orchestration layer — config, setup, meetings sync, daily page sync, and status — replacing all Obsidian-specific code.

The Notion data model simplifies the Obsidian model: no dated instance files. Calendar events match directly against pages in the Notion meetings database, and the daily page links to those pages via page mention blocks.

## Approach

In-place swap (Option A): wire existing `notion.js` helpers into the orchestration layer. Obsidian modules remain but are no longer called. Matcher logic is unchanged — it already operates on Notion page objects.

## Section 1: Config & Setup

### config/schema.js

Remove `obsidianVaultPath`. Add:
- `notionApiKey` — Notion integration secret
- `notionMeetingsDatabaseId` — UUID of the meetings database
- `notionDaysDatabaseId` — UUID of the days/daily database

### setup.js

Replace the Obsidian vault path prompt with three new prompts:
1. Notion API key — validated by calling `databases.retrieve()` on the meetings database ID
2. Meetings database ID — validated by confirming the integration has full access
3. Days database ID — validated the same way

Fails fast with a clear, actionable error message if the API key is invalid or either database is inaccessible.

## Section 2: Dependency

Add `@notionhq/client` (latest) to `dependencies` in `package.json`.

Update `package.json` description to "Sync Outlook calendar meetings to Notion." Remove `obsidian` from keywords, add `notion`.

## Section 3: Meetings Sync

### meetings/index.js

1. Load config, read `notionApiKey` and `notionMeetingsDatabaseId`
2. Create `@notionhq/client` Client instance
3. Call `resolveDataSourceId(client, notionMeetingsDatabaseId)` to get the data source ID
4. Call `fetchAllMeetingPages(client, dataSourceId)` to get all series pages
5. Pass `{ client, dataSourceId, date, cache }` to reconciler (removing `vaultPath`)

### meetings/reconciler.js

Replace Obsidian imports with `createMeetingPage` from `notion.js`.

For unmatched events: call `createMeetingPage(client, dataSourceId, event.title)` instead of writing files to disk.

Result shape changes:
- Remove: `filePath`, `seriesCreated`
- Add: `pageId` (Notion page UUID — used by `buildMeetingBlocks` for mention links)

`pageUrl` is not included in the result shape; the daily sync uses `pageId` directly for Notion mention blocks.

The matcher (`matcher.js`) requires no changes — it already operates on Notion page objects and extracts titles via `getPageTitle`.

## Section 4: Daily Page Sync

### daily/blocks.js

Replace `buildMeetingLines` (returns markdown wikilink strings) with `buildMeetingBlocks` (returns Notion to_do block objects).

Each block format:
```json
{
  "type": "to_do",
  "to_do": {
    "rich_text": [
      { "type": "text", "text": { "content": "09:00 " } },
      { "type": "mention", "mention": { "type": "page", "page": { "id": "<pageId>" } } }
    ],
    "checked": false
  }
}
```

Sorting logic (`sortMeetingResults`) is unchanged.

### daily/index.js

1. Load config, read `notionApiKey` and `notionDaysDatabaseId`
2. Create Notion client
3. Resolve days data source ID via `databases.retrieve()`
4. Call `findTodayPage`, `hasMeetingsSection`, `createTodayPage`, or `prependMeetingsSection` from `daily/notion.js`
5. Pass `buildMeetingBlocks(sorted, config.timezone)` instead of `buildMeetingLines`

Remove Obsidian imports entirely.

## Section 5: Status Command & Sync Spinner

### status.js

Replace Obsidian vault path checks with Notion connectivity checks:
- Verify `notionApiKey` is configured
- Call `databases.retrieve()` on `notionMeetingsDatabaseId` — show `[x]` or `[ ]` with error
- Call `databases.retrieve()` on `notionDaysDatabaseId` — show `[x]` or `[ ]` with error

### sync.js

Update spinner text: "Syncing meetings to Obsidian vault..." → "Syncing meetings to Notion..."

## What Does Not Change

- `calendar/` — ICS fetching, parsing, cache, suppression — no changes
- `meetings/matcher.js` — already operates on Notion page objects
- `meetings/notion.js` — fully implemented, no changes
- `daily/notion.js` — fully implemented, no changes
- `utils/timezone.js` — no changes
- `mcp-server.js` — no changes
- Cache logic — structure unchanged, `filePath` in cache entries becomes `pageId`

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `@notionhq/client`, update description/keywords |
| `src/config/schema.js` | Swap `obsidianVaultPath` for three Notion fields |
| `src/commands/setup.js` | Replace vault prompts with Notion prompts + validation |
| `src/commands/status.js` | Replace Obsidian checks with Notion connectivity checks |
| `src/commands/sync.js` | Update spinner text |
| `src/meetings/index.js` | Create Notion client, fetch pages, pass to reconciler |
| `src/meetings/reconciler.js` | Replace Obsidian calls with Notion, update result shape |
| `src/daily/blocks.js` | Replace `buildMeetingLines` with `buildMeetingBlocks` |
| `src/daily/index.js` | Switch from Obsidian to Notion imports and logic |
