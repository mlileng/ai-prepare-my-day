import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findTodayNote, hasMeetingsSection, createDailyNote, prependMeetingsSection } from '../src/daily/obsidian.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-daily-test-'));
  return dir;
}

test('findTodayNote returns false when no daily note exists', async () => {
  const vault = await makeTempVault();
  const exists = await findTodayNote(vault, '2026-04-24');
  assert.equal(exists, false);
  await fs.rm(vault, { recursive: true });
});

test('findTodayNote returns true when daily note exists', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# existing');
  const exists = await findTodayNote(vault, '2026-04-24');
  assert.equal(exists, true);
  await fs.rm(vault, { recursive: true });
});

test('hasMeetingsSection returns false for note without ## Meetings', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# April 24\n\n## Today\'s Focus\n');
  const has = await hasMeetingsSection(vault, '2026-04-24');
  assert.equal(has, false);
  await fs.rm(vault, { recursive: true });
});

test('hasMeetingsSection returns true for note with ## Meetings', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), '# April 24\n\n## Meetings\n\n- 09:00 [[x]]\n');
  const has = await hasMeetingsSection(vault, '2026-04-24');
  assert.equal(has, true);
  await fs.rm(vault, { recursive: true });
});

test('createDailyNote creates daily/ folder and note file', async () => {
  const vault = await makeTempVault();
  const lines = ['- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'];
  await createDailyNote(vault, '2026-04-24', lines);
  const content = await fs.readFile(path.join(vault, 'daily', '2026-04-24.md'), 'utf8');
  assert.ok(content.includes('type: daily-note'));
  assert.ok(content.includes('date: 2026-04-24'));
  assert.ok(content.includes('## Meetings'));
  assert.ok(content.includes('- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'));
  assert.ok(content.includes("## Today's Focus"));
  assert.ok(content.includes('[[daily/2026-04-23]]'));
  assert.ok(content.includes('[[daily/2026-04-25]]'));
  await fs.rm(vault, { recursive: true });
});

test('prependMeetingsSection inserts ## Meetings after nav line', async () => {
  const vault = await makeTempVault();
  await fs.mkdir(path.join(vault, 'daily'), { recursive: true });
  const existing = `---
type: daily-note
date: 2026-04-24
tags: [daily-note]
---

# Friday, April 24, 2026

← [[daily/2026-04-23]] | [[daily/2026-04-25]] →

## Today's Focus

`;
  await fs.writeFile(path.join(vault, 'daily', '2026-04-24.md'), existing);
  const lines = ['- 09:00 [[meetings/instances/2026-04-24-standup|Standup]]'];
  await prependMeetingsSection(vault, '2026-04-24', lines);
  const content = await fs.readFile(path.join(vault, 'daily', '2026-04-24.md'), 'utf8');
  const meetingsPos = content.indexOf('## Meetings');
  const focusPos = content.indexOf("## Today's Focus");
  assert.ok(meetingsPos !== -1);
  assert.ok(meetingsPos < focusPos);
  await fs.rm(vault, { recursive: true });
});
