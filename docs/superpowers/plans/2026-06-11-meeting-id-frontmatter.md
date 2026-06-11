# meeting-id Frontmatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `meeting-id` frontmatter to instance and series files so Dataview queries can filter by meeting, and embed a ready-to-use Dataview query block in new series stubs.

**Architecture:** Two template string edits in `src/meetings/obsidian.js`. `seriesSlug` is already in scope for both functions — it's interpolated directly. No new parameters or helpers needed.

**Tech Stack:** Node.js ESM, plain file I/O (`fs/promises`), Obsidian Dataview plugin (consumer of the output).

---

### Task 1: Add meeting-id to createMeetingInstance()

**Files:**
- Modify: `src/meetings/obsidian.js:82-88`

- [ ] **Step 1: Edit the frontmatter template in `createMeetingInstance()`**

In `src/meetings/obsidian.js`, find the `content` template string starting at line 82. Replace the frontmatter block so `meeting-id` appears on the second line:

```js
  const content = `---
type: meeting-instance
meeting-id: ${seriesSlug}
date: ${date}
series: ${seriesLink}
participants: []
tags: [meeting-instance]
---

## Agenda / Context

${event.title} — ${event.displayRange}

## Key Discussion Points

## Decisions

## Action Items

## My Summary

## Links
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/meetings/obsidian.js
git commit -m "feat: add meeting-id frontmatter to instance files"
```

---

### Task 2: Add meeting-id and Dataview query block to createMeetingSeries()

**Files:**
- Modify: `src/meetings/obsidian.js:150-174`

- [ ] **Step 1: Edit the frontmatter and body template in `createMeetingSeries()`**

In `src/meetings/obsidian.js`, find the `content` template string starting at line 150. Replace the entire template so `meeting-id` appears on the second frontmatter line and a `## Queries` section with an interpolated Dataview block appears at the end:

```js
  const content = `---
type: meeting-series
meeting-id: ${seriesSlug}
name: "${event.title}"
status: recurring
priority: ""
cadence: "Recurring"
participants: []
organizations: []
initiatives: []
created: ${date}
last_edited: ${date}
tags: [meeting-series]
---

## Purpose

*(to be filled in)*

## Participants

*(to be filled in)*

## Recent Instances

## Queries

\`\`\`dataview
TABLE type, status, due, file.link AS source
FROM "meetings/instances"
WHERE meeting-id = "${seriesSlug}" AND status = "open"
SORT type ASC, due ASC
\`\`\`
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/meetings/obsidian.js
git commit -m "feat: add meeting-id frontmatter and Dataview query block to series files"
```

---

### Task 3: Manual verification

**Files:** (read-only — inspect output)

- [ ] **Step 1: Run sync and check an instance file**

```bash
node src/index.js sync
```

Open any file under `meetings/instances/` in your vault. Verify the frontmatter contains:

```yaml
meeting-id: <series-slug>
```

where `<series-slug>` matches the filename prefix after the date (e.g. `john-morten` in `2026-06-11-john-morten.md`).

- [ ] **Step 2: Check a newly-created series file**

If a new series was created this run, open it under `meetings/series/`. Verify:

1. Frontmatter contains `meeting-id: <series-slug>`
2. A `## Queries` section exists at the bottom with a `dataview` code block
3. The `WHERE` clause uses the correct slug for that file

To force a new series to be created for testing, temporarily rename an existing series file, run sync, then restore the original. Confirm both the renamed stub and the regenerated file have the correct fields, then delete the test stub.
