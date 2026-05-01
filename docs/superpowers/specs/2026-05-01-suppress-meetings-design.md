# Design: Meeting Suppression via File

**Date:** 2026-05-01
**Issue:** #1

## Problem

Some recurring calendar events — blocked time, stand-ups the user doesn't attend, admin reminders — should never appear in the daily note. Today these are filtered via a `suppressedMeetings` array in `config.json`, but that field is empty and there's no way to populate it without editing JSON directly.

## Solution

Replace the config-embedded list with a standalone plain-text file at `~/.prepare-my-day/suppress.txt`. The file is outside the repo by nature (no gitignore entry needed). A committed example file documents the format.

## File Format

`~/.prepare-my-day/suppress.txt` — one term per line, `#` for comments, blank lines ignored.

```
# Blocked time
Work Block (Meetings are Fine)
Private Appointment

# Stand-ups I'm not in
MRE Daily Scrum (New)
Merkury Tag Daily Stand Up
MKB Daily Scrum

# Admin
Submit Timesheets
```

Matching is **case-insensitive substring**: if the term appears anywhere in the event title, the event is suppressed. This matches the existing parser behaviour.

`suppress.example.txt` (the file above) is committed to the repo root as format documentation. It is never read by the tool — only `~/.prepare-my-day/suppress.txt` is.

## Architecture

### New module: `src/calendar/suppression.js`

Single exported function:

```js
export async function loadSuppressedTerms(): Promise<string[]>
```

- Reads `~/.prepare-my-day/suppress.txt`
- Strips lines beginning with `#` and blank lines
- Returns a string array of terms
- Returns `[]` silently if the file doesn't exist — no error, no warning

### Changes to `src/calendar/index.js`

`getTodaysMeetings()` calls `loadSuppressedTerms()` in parallel with `loadConfig()` and passes the result to `parseEvents()` as the `suppressedMeetings` option. No change to `parseEvents()` itself — it already accepts and applies the list.

### Config schema cleanup

`suppressedMeetings` is removed from `DEFAULT_CONFIG` in `src/config/schema.js`. The file replaces it entirely.

## Error Handling

- **File missing:** returns `[]`, sync continues normally. No warning — absence is the expected state before setup.
- **Permission error or read failure:** propagates as an unhandled exception, consistent with the codebase's fail-fast approach.
- **Malformed content:** not possible — the format is line-by-line plain text with no structure to malform.

## Testing

Unit tests for `loadSuppressedTerms()` covering:

1. File exists with comments, blank lines, and valid terms — returns clean string array
2. File does not exist — returns `[]`
3. File is empty — returns `[]`

The existing parser tests already cover the suppression matching logic. No changes needed there.

## What Does Not Change

- `src/calendar/parser.js` — suppression logic unchanged
- `src/meetings/` — not involved
- `src/daily/` — not involved
- Cache behaviour — suppressed events are filtered before hashing, so suppressing a meeting does not invalidate the cache for other meetings

## Acceptance Criteria

- [ ] `suppress.example.txt` committed to repo root with the example meetings from issue #1
- [ ] `src/calendar/suppression.js` exports `loadSuppressedTerms()`
- [ ] `suppressedMeetings` removed from config schema and `config.json` default
- [ ] `getTodaysMeetings()` loads terms from file and passes to parser
- [ ] Missing `suppress.txt` does not cause errors
- [ ] Unit tests pass for all three cases above
