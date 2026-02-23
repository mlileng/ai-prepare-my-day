/**
 * Content hash change detection cache.
 *
 * Stores a per-date content hash of calendar events so downstream phases can
 * skip Notion sync when nothing has changed since the last run today.
 *
 * Cache strategy: keyed by date (YYYY-MM-DD). New day = cache miss = always
 * processes. Same day + same hash = no change = skip downstream work.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR } from '../credentials/constants.js';

const CACHE_FILE = path.join(CONFIG_DIR, 'calendar-cache.json');

/**
 * Compute a stable content hash for a list of CalendarEvents.
 * Extracts only stable fields (uid, title, start, end) and sorts by uid
 * to ensure deterministic output regardless of array order.
 *
 * @param {Array<{uid: string, title: string, start: Date, end: Date}>} events
 * @returns {string} MD5 hex digest
 */
export function hashEvents(events) {
  const stable = events.map(e => ({
    uid: e.uid,
    title: e.title,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
  }));

  const sorted = stable.sort((a, b) => a.uid.localeCompare(b.uid));
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Load the cache from disk.
 *
 * @returns {Promise<{date: string|null, hash: string|null}>}
 */
export async function loadCache() {
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { date: null, hash: null };
  }
}

/**
 * Persist the cache to disk.
 *
 * @param {string} date - YYYY-MM-DD date string
 * @param {string} hash - MD5 hex digest of events
 * @returns {Promise<void>}
 */
export async function saveCache(date, hash) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify({ date, hash }), 'utf-8');
}

/**
 * Check whether events have changed since the last run today.
 * Saves the new hash when a change is detected or the date rolls over.
 *
 * @param {Array<{uid: string, title: string, start: Date, end: Date}>} events
 * @returns {Promise<boolean>} true if events changed (or first run today), false if unchanged
 */
export async function hasEventsChanged(events) {
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cache = await loadCache();
  const currentHash = hashEvents(events);

  if (cache.date === todayStr && cache.hash === currentHash) {
    return false;
  }

  await saveCache(todayStr, currentHash);
  return true;
}
