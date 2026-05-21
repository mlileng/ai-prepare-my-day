# Design: Paperclip Integration via `--json` Flag

**Date:** 2026-05-21
**Status:** Approved

## Goal

Enable Paperclip to trigger `prepare-my-day sync` on a schedule and receive a structured result it can display and alert on — without changing the sync pipeline or adding new runtime dependencies.

## Context

Paperclip is a locally installed agent orchestration platform that supports shell commands as scheduled agents. The user wants to replace the existing crontab with Paperclip-managed scheduling. The tool's pipeline (calendar fetch → meeting sync → daily page) and Obsidian vault integration remain unchanged.

## Architecture

The change is confined to the CLI layer. No pipeline modules (`calendar/`, `meetings/`, `daily/`) are modified.

When `--json` is passed to the `sync` command:

1. All `ora` spinner output is suppressed
2. The same three-stage pipeline runs (calendar → meetings → daily page)
3. A single JSON object is written to stdout on completion
4. The process exits with code `1` if `errors` is non-empty, `0` otherwise

Paperclip is configured to run `prepare-my-day sync --json` on the desired schedule, capturing stdout as the structured result.

## JSON Output Format

```json
{
  "meetings_found": 3,
  "meetings_created": 1,
  "meetings_matched": 2,
  "daily_page_updated": true,
  "errors": []
}
```

**Field semantics:**

- `meetings_found` — total calendar events parsed for today
- `meetings_created` — new instance files written to the vault
- `meetings_matched` — events matched to existing series pages
- `daily_page_updated` — whether the daily note was written/updated
- `errors` — array of error strings, one per failed stage; partial success is possible

**On cache hit:** `meetings_found` reflects today's events. `meetings_created` is `0`. `meetings_matched` reflects the count of cached results (events whose hashes haven't changed since last run) — the meeting sync was skipped for those events, which is normal and not an error.

**Exit codes:**
- `0` — pipeline completed with no errors (including cache-hit skips)
- `1` — one or more stages failed; `errors` array contains details

## Files Changed

### `src/index.js`

Add `.option('--json', 'Output structured JSON instead of spinner UI')` to the `sync` command definition. Pass the parsed `json` boolean into the sync handler.

### `src/commands/sync.js`

Accept a `json` boolean option. When `true`:

- Skip `ora` spinner instantiation (or pass a disabled/silent instance)
- Accumulate a result object mirroring the MCP server's output shape (see `src/mcp-server.js` as reference implementation)
- Catch errors per stage and append to `result.errors` rather than letting them propagate
- Write `JSON.stringify(result)` to stdout at completion
- Call `process.exit(1)` if `result.errors.length > 0`

The `src/mcp-server.js` `sync_calendar` tool handler is the direct reference — the sync command gets the same accumulation logic, driven by a CLI flag instead of an MCP invocation.

## What Does Not Change

- All pipeline modules (`src/calendar/`, `src/meetings/`, `src/daily/`)
- The MCP server
- The Obsidian vault integration
- Default (non-`--json`) behavior — spinners and terminal output are unchanged
