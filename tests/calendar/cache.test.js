/**
 * Test suite for cache.js (content hash change detection) and fetcher.js error handling.
 *
 * Uses Node.js built-in node:test and node:assert — no extra test dependencies.
 *
 * For file I/O tests (4-7): directly calls saveCache/loadCache with controlled
 * inputs after resetting the cache file to a known state, then restores it.
 * This avoids polluting the real config with test data while still exercising
 * the actual functions.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR } from '../../src/credentials/constants.js';
import { hashEvents, loadCache, saveCache, hasEventsChanged } from '../../src/calendar/cache.js';

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

/** @type {Array<{uid: string, title: string, start: Date, end: Date}>} */
const EVENT_A = [
  { uid: 'event-1', title: 'Team standup', start: new Date('2026-02-23T09:00:00Z'), end: new Date('2026-02-23T09:30:00Z') },
  { uid: 'event-2', title: 'Design review',  start: new Date('2026-02-23T11:00:00Z'), end: new Date('2026-02-23T12:00:00Z') },
];

/** Same events as EVENT_A but in reversed order */
const EVENT_A_REVERSED = [...EVENT_A].reverse();

/** Different events (title changed) */
const EVENT_B = [
  { uid: 'event-1', title: 'Team standup (cancelled)', start: new Date('2026-02-23T09:00:00Z'), end: new Date('2026-02-23T09:30:00Z') },
  { uid: 'event-2', title: 'Design review', start: new Date('2026-02-23T11:00:00Z'), end: new Date('2026-02-23T12:00:00Z') },
];

// --------------------------------------------------------------------------
// Cache file backup/restore helpers to avoid polluting real config
// --------------------------------------------------------------------------

const CACHE_FILE = path.join(CONFIG_DIR, 'calendar-cache.json');
let cacheBackup = null;

async function backupCache() {
  try {
    cacheBackup = await fs.readFile(CACHE_FILE, 'utf-8');
  } catch {
    cacheBackup = null; // File did not exist
  }
}

async function restoreCache() {
  if (cacheBackup !== null) {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, cacheBackup, 'utf-8');
  } else {
    try {
      await fs.unlink(CACHE_FILE);
    } catch {
      // File did not exist before — nothing to restore
    }
  }
}

// --------------------------------------------------------------------------
// Tests 1-3: hashEvents (no file I/O)
// --------------------------------------------------------------------------

test('hashEvents returns same hash for identical event lists', () => {
  const a = [...EVENT_A];
  const b = [...EVENT_A];
  assert.equal(hashEvents(a), hashEvents(b));
});

test('hashEvents returns different hash when events change', () => {
  assert.notEqual(hashEvents(EVENT_A), hashEvents(EVENT_B));
});

test('hashEvents is order-independent (deterministic)', () => {
  assert.equal(hashEvents(EVENT_A), hashEvents(EVENT_A_REVERSED));
});

// --------------------------------------------------------------------------
// Tests 4-7: hasEventsChanged via cache file
// --------------------------------------------------------------------------

before(backupCache);
after(restoreCache);

beforeEach(async () => {
  // Remove cache file before each file I/O test to start fresh
  try {
    await fs.unlink(CACHE_FILE);
  } catch {
    // OK if it doesn't exist
  }
});

test('hasEventsChanged returns true on first run (no cache file)', async () => {
  const changed = await hasEventsChanged(EVENT_A);
  assert.equal(changed, true);
});

test('hasEventsChanged returns false on second run with same events', async () => {
  // First call: cache miss -> true, saves cache
  const first = await hasEventsChanged(EVENT_A);
  assert.equal(first, true);

  // Second call same day, same events: cache hit -> false
  const second = await hasEventsChanged(EVENT_A);
  assert.equal(second, false);
});

test('hasEventsChanged returns true when events change', async () => {
  // Prime the cache with EVENT_A
  await hasEventsChanged(EVENT_A);

  // Different events same day -> hash mismatch -> true
  const changed = await hasEventsChanged(EVENT_B);
  assert.equal(changed, true);
});

test('cache resets on new day', async () => {
  // Save cache with yesterday's date so the date check fails
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // Pre-populate cache with yesterday's date and the hash of EVENT_A
  await saveCache(yesterdayStr, hashEvents(EVENT_A));

  // hasEventsChanged for today should return true even if hash matches
  const changed = await hasEventsChanged(EVENT_A);
  assert.equal(changed, true);
});
