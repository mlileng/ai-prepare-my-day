import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reconcileMeetings } from '../src/meetings/reconciler.js';

async function makeTempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconciler-test-'));
  await fs.mkdir(path.join(dir, 'meetings', 'series'), { recursive: true });
  await fs.mkdir(path.join(dir, 'meetings', 'instances'), { recursive: true });
  return dir;
}

const emptyCache = { meetingMap: {}, hash: null, date: null };

test('unmatched recurring event creates both series stub and linked instance', async () => {
  const vault = await makeTempVault();
  const event = {
    uid: 'uid-1',
    title: 'B2B Internal Update',
    isRecurring: true,
    start: new Date('2026-04-24T13:00:00'),
    end: new Date('2026-04-24T13:30:00'),
    displayRange: '13:00–13:30',
  };

  const { results } = await reconcileMeetings([], [event], {
    vaultPath: vault,
    date: '2026-04-24',
    cache: emptyCache,
  });

  // Instance created
  assert.equal(results.length, 1);
  assert.equal(results[0].matchType, 'created');
  assert.equal(results[0].filePath, 'meetings/instances/2026-04-24-b2b-internal-update.md');
  assert.equal(results[0].seriesCreated, true);

  // Series stub created
  const seriesPath = path.join(vault, 'meetings', 'series', 'b2b-internal-update.md');
  const seriesContent = await fs.readFile(seriesPath, 'utf8');
  assert.ok(seriesContent.includes('name: "B2B Internal Update"'));

  // Instance links to series
  const instanceContent = await fs.readFile(path.join(vault, results[0].filePath), 'utf8');
  assert.ok(instanceContent.includes('[[meetings/series/b2b-internal-update]]'));

  await fs.rm(vault, { recursive: true });
});

test('unmatched non-recurring event creates instance only — no series file', async () => {
  const vault = await makeTempVault();
  const event = {
    uid: 'uid-2',
    title: 'One-off Review',
    isRecurring: false,
    start: new Date('2026-04-24T14:00:00'),
    end: new Date('2026-04-24T15:00:00'),
    displayRange: '14:00–15:00',
  };

  const { results } = await reconcileMeetings([], [event], {
    vaultPath: vault,
    date: '2026-04-24',
    cache: emptyCache,
  });

  assert.equal(results[0].matchType, 'created');
  assert.equal(results[0].seriesCreated, false);

  // No series file created
  const seriesDir = await fs.readdir(path.join(vault, 'meetings', 'series'));
  assert.equal(seriesDir.length, 0);

  await fs.rm(vault, { recursive: true });
});
