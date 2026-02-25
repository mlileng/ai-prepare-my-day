/**
 * Public API for Phase 3 — Meeting Management.
 *
 * Exposes syncMeetings() as the single entry point for Phase 4 to call.
 * Handles config loading, Notion auth, data source resolution, cache management,
 * and orchestrates the full reconciliation loop.
 *
 * @module meetings
 */

import { loadConfig } from '../config/manager.js';
import { createNotionClient } from '../auth/notion.js';
import { loadCache, saveCache } from '../calendar/cache.js';
import { resolveDataSourceId, fetchAllMeetingPages } from './notion.js';
import { reconcileMeetings } from './reconciler.js';

/**
 * Sync today's calendar events to the Notion meetings database.
 *
 * If events have not changed since the last run (changed === false), skips all
 * Notion work immediately (per locked decision: cache hit = skip).
 *
 * Otherwise:
 *   1. Loads config and validates meetingsDatabaseId is configured
 *   2. Gets Notion token from config
 *   3. Creates Notion client and resolves the data_source_id
 *   4. Fetches all existing Notion meeting pages
 *   5. Loads cache (includes meetingMap for per-event idempotency)
 *   6. Runs reconciliation loop (match/create for each event)
 *   7. Saves updated meetingMap atomically (once, at end of run)
 *
 * Notion API errors are NOT caught — they propagate immediately (fail-fast).
 *
 * @param {Array<{uid: string, title: string, start: Date, end: Date}>} events - From getTodaysMeetings
 * @param {{ changed: boolean }} opts
 * @returns {Promise<Array<{ eventTitle: string, matchType: string, notionPageId: string, score: number }>>}
 * @throws {Error} If meetingsDatabaseId is not configured
 * @throws {Error} If Notion API returns any error (propagated)
 */
export async function syncMeetings(events, { changed }) {
  if (!changed) {
    console.log('Meetings unchanged since last run — skipping');
    return [];
  }

  // Load and validate config
  const config = await loadConfig();
  if (!config.meetingsDatabaseId) {
    throw new Error('Meetings database not configured. Run: prepare-my-day setup');
  }

  // Get Notion token from config and create client
  if (!config.notionToken) {
    throw new Error('Notion token not configured. Run: prepare-my-day setup');
  }
  const client = createNotionClient(config.notionToken);

  // Resolve data source and fetch all existing meeting pages
  const dataSourceId = await resolveDataSourceId(client, config.meetingsDatabaseId);
  const notionPages = await fetchAllMeetingPages(client, dataSourceId);

  // Load cache (includes meetingMap for per-event idempotency)
  const cache = await loadCache();

  // Run reconciliation loop
  const { results, updatedMeetingMap } = await reconcileMeetings(notionPages, events, {
    client,
    dataSourceId,
    cache,
  });

  // Save updated cache atomically — once at end of full run (Pitfall 6: not per-event)
  await saveCache(
    cache.date ?? new Date().toISOString().slice(0, 10),
    cache.hash ?? '',
    updatedMeetingMap
  );

  return results;
}

// Re-exports for downstream consumers (Phase 4)
export { matchEvent } from './matcher.js';
export { getPageTitle } from './notion.js';
