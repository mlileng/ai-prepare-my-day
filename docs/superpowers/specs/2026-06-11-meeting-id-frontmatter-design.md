# meeting-id Frontmatter Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Add a `meeting-id` frontmatter field to both meeting series and instance files so Obsidian Dataview queries can filter by meeting without parsing wikilinks or filenames.

## Requirements

1. Instance files get `meeting-id: <series-slug>` in frontmatter.
2. Series files get `meeting-id: <series-slug>` in frontmatter.
3. New series stubs include a pre-filled Dataview query block scoped to `meetings/instances`.
4. Existing files are never modified — idempotency guards already prevent overwriting either file type.

## Frontmatter Changes

### Instance file (`meetings/instances/2026-06-11-john-morten.md`)

```yaml
---
type: meeting-instance
meeting-id: john-morten
date: 2026-06-11
series: "[[meetings/series/john-morten]]"
participants: []
tags: [meeting-instance]
---
```

### Series file (`meetings/series/john-morten.md`)

```yaml
---
type: meeting-series
meeting-id: john-morten
name: "John & Morten"
status: recurring
priority: ""
cadence: "Recurring"
participants: []
organizations: []
initiatives: []
created: 2026-06-11
last_edited: 2026-06-11
tags: [meeting-series]
---
```

## Dataview Query Block in New Series Stubs

New series files get a `## Queries` section at the bottom with the slug interpolated at creation time:

````markdown
## Queries

```dataview
TABLE type, status, due, file.link AS source
FROM "meetings/instances"
WHERE meeting-id = "john-morten" AND status = "open"
SORT type ASC, due ASC
```
````

## Code Changes

All changes are in `src/meetings/obsidian.js`. No other files touched.

### `createMeetingInstance()`

Add `meeting-id: ${seriesSlug}` on the line after `type: meeting-instance` in the template string. `seriesSlug` is already a parameter.

### `createMeetingSeries()`

Add `meeting-id: ${seriesSlug}` on the line after `type: meeting-series` in the frontmatter template string. Append a `## Queries` section with the interpolated Dataview block at the end of the content template. `seriesSlug` is already a parameter.

## What Does Not Change

- Instance note bodies are never overwritten after first creation.
- Series note bodies are never overwritten after first creation.
- No new parameters, helpers, or modules needed.
- Scope is `meetings/instances` and `meetings/series` only — no other vault areas.
