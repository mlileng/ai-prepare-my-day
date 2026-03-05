# prepare-my-day

A CLI tool that syncs your Outlook calendar meetings to Notion. It fetches an ICS calendar feed, matches events against existing Notion meeting pages, and links everything to a daily page with chronological to-do items.

## Prerequisites

- Node.js (ESM support required)
- An Outlook calendar with a published ICS feed URL
- A Notion integration token ([create one here](https://www.notion.so/my-integrations))
- Two Notion databases shared with your integration:
  - **Meetings** database -- for individual meeting pages
  - **Days** database -- for daily pages

## Install

```bash
npm install
```

## Setup

Run the interactive setup to configure your calendar feed, Notion token, and database connections:

```bash
node src/index.js setup
```

This walks you through:
1. Outlook calendar ICS URL (validated against the feed)
2. Notion integration token (validated against the API)
3. Meetings database URL (validated for access)
4. Days database URL (validated for access)

Configuration is stored at `~/.prepare-my-day/config.json`.

## Usage

### Sync meetings

```bash
node src/index.js sync
```

This runs three stages:
1. **Calendar** -- Fetches the ICS feed and parses today's events
2. **Meetings** -- Matches events to existing Notion pages or creates new ones
3. **Daily Page** -- Finds or creates today's daily page and prepends a Meetings section with to-do blocks

If the calendar hasn't changed since the last run today, the meeting sync is skipped automatically.

### Check status

```bash
node src/index.js status
```

Verifies that the config file exists, the ICS feed is reachable, the Notion token is valid, and both databases are configured.

### Set up a cron job

```bash
node src/index.js cron-setup
```

Prints a ready-to-paste crontab entry that runs `sync` at 07:00 on weekdays. On macOS you'll need to grant Full Disk Access to `/usr/sbin/cron`.

## How matching works

Calendar event titles are matched against existing Notion meeting pages in two stages:

1. **Substring match** -- Bidirectional case-insensitive check. If either title contains the other, it's an exact match.
2. **Fuzzy match** -- Levenshtein similarity scoring. Pages scoring 0.8 or above are considered a match.

Unmatched events get new Notion pages created automatically. Matched events are linked to the existing page. A per-event content hash prevents duplicate creates on re-runs.

## How the daily page works

After meetings are synced, the tool finds today's page in the Days database (by date) or creates one. It prepends a "Meetings" H2 heading followed by chronological to-do checkboxes, each with a time prefix and an @mention link to the meeting page.

A re-run guard checks for an existing "Meetings" heading -- if found, the section is not duplicated.
