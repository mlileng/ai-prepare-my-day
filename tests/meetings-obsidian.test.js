import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fetchAllSeries, findExistingInstance, createMeetingInstance, createMeetingSeries } from '../src/meetings/obsidian.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-test-'));
  await fs.mkdir(path.join(dir, 'meetings', 'series'), { recursive: true });
  await fs.mkdir(path.join(dir, 'meetings', 'instances'), { recursive: true });
  return dir;
}

test('fetchAllSeries returns empty array when no series files', async () => {
  const vault = await makeTempVault();
  const series = await fetchAllSeries(vault);
  assert.deepEqual(series, []);
  await fs.rm(vault, { recursive: true });
});

test('fetchAllSeries reads name from frontmatter', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'series', 'heidi-morten.md'),
    '---\ntype: meeting-series\nname: "Heidi:Morten"\nstatus: recurring\n---\n\n## Purpose\n'
  );
  const series = await fetchAllSeries(vault);
  assert.equal(series.length, 1);
  assert.equal(series[0].slug, 'heidi-morten');
  // Must have shape the matcher expects
  const titleProp = Object.values(series[0].properties).find(p => p.type === 'title');
  assert.ok(titleProp);
  assert.equal(titleProp.title[0].plain_text, 'Heidi:Morten');
  await fs.rm(vault, { recursive: true });
});

test('fetchAllSeries falls back to filename when name frontmatter absent', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'series', 'standup.md'),
    '---\ntype: meeting-series\n---\n'
  );
  const series = await fetchAllSeries(vault);
  assert.equal(series[0].slug, 'standup');
  const titleProp = Object.values(series[0].properties).find(p => p.type === 'title');
  assert.equal(titleProp.title[0].plain_text, 'standup');
  await fs.rm(vault, { recursive: true });
});

test('findExistingInstance returns false when no file', async () => {
  const vault = await makeTempVault();
  const exists = await findExistingInstance(vault, '2026-04-24', 'heidi-morten');
  assert.equal(exists, false);
  await fs.rm(vault, { recursive: true });
});

test('findExistingInstance returns true when file exists', async () => {
  const vault = await makeTempVault();
  await fs.writeFile(
    path.join(vault, 'meetings', 'instances', '2026-04-24-heidi-morten.md'),
    '# existing'
  );
  const exists = await findExistingInstance(vault, '2026-04-24', 'heidi-morten');
  assert.equal(exists, true);
  await fs.rm(vault, { recursive: true });
});

test('createMeetingInstance creates file and returns relative path', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Heidi:Morten', start: new Date('2026-04-24T09:00:00'), end: new Date('2026-04-24T09:30:00'), displayRange: '09:00–09:30' };
  const filePath = await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  assert.equal(filePath, 'meetings/instances/2026-04-24-heidi-morten.md');
  const content = await fs.readFile(path.join(vault, filePath), 'utf8');
  assert.ok(content.includes('type: meeting-instance'));
  assert.ok(content.includes('date: 2026-04-24'));
  assert.ok(content.includes('Heidi:Morten'));
  await fs.rm(vault, { recursive: true });
});

test('createMeetingInstance is idempotent — returns existing path without overwriting', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Heidi:Morten', start: new Date('2026-04-24T09:00:00'), end: new Date('2026-04-24T09:30:00'), displayRange: '09:00–09:30' };
  await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  // Write custom content to simulate manual edits
  const instancePath = path.join(vault, 'meetings', 'instances', '2026-04-24-heidi-morten.md');
  await fs.writeFile(instancePath, '# my notes');
  // Second call should not overwrite
  await createMeetingInstance(vault, event, '2026-04-24', 'heidi-morten', 'heidi-morten');
  const content = await fs.readFile(instancePath, 'utf8');
  assert.equal(content, '# my notes');
  await fs.rm(vault, { recursive: true });
});

test('createMeetingSeries creates file with full skeleton frontmatter', async () => {
  const vault = await makeTempVault();
  const event = { title: 'B2B Internal Update' };
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  assert.equal(relPath, 'meetings/series/b2b-internal-update.md');
  const content = await fs.readFile(path.join(vault, relPath), 'utf8');
  assert.ok(content.includes('type: meeting-series'));
  assert.ok(content.includes('name: "B2B Internal Update"'));
  assert.ok(content.includes('status: recurring'));
  assert.ok(content.includes('cadence: "Recurring"'));
  assert.ok(content.includes('created: 2026-04-24'));
  assert.ok(content.includes('tags: [meeting-series]'));
  assert.ok(content.includes('## Purpose'));
  assert.ok(content.includes('## Participants'));
  await fs.rm(vault, { recursive: true });
});

test('createMeetingSeries is idempotent — returns path without overwriting existing file', async () => {
  const vault = await makeTempVault();
  const event = { title: 'B2B Internal Update' };
  await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  const seriesPath = path.join(vault, 'meetings', 'series', 'b2b-internal-update.md');
  await fs.writeFile(seriesPath, '# hand-crafted content');
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'b2b-internal-update');
  assert.equal(relPath, 'meetings/series/b2b-internal-update.md');
  const content = await fs.readFile(seriesPath, 'utf8');
  assert.equal(content, '# hand-crafted content');
  await fs.rm(vault, { recursive: true });
});

test('createMeetingSeries returns correct vault-relative path', async () => {
  const vault = await makeTempVault();
  const event = { title: 'Weekly Sync' };
  const relPath = await createMeetingSeries(vault, event, '2026-04-24', 'weekly-sync');
  assert.equal(relPath, 'meetings/series/weekly-sync.md');
  await fs.rm(vault, { recursive: true });
});
