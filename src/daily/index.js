/**
 * Public API for Phase 4 — Daily Page Integration.
 *
 * Exposes syncDailyPage() as the single entry point to link today's
 * matched/created meeting entries to today's daily page in Notion.
 * Handles config loading, auth, data source resolution, and orchestrates
 * the full daily page sync flow.
 *
 * @module daily
 */

import { loadConfig } from '../config/manager.js';
import { createNotionClient } from '../auth/notion.js';
import { resolveDataSourceId } from '../meetings/notion.js';
import { findTodayPage, createTodayPage, hasMeetingsSection, prependMeetingsSection } from './notion.js';
import { sortMeetingResults, buildMeetingBlocks } from './blocks.js';

/**
 * Sync today's meeting results to the user's daily page in Notion.
 *
 * Takes the results array from syncMeetings() (each with start, notionPageId,
 * eventTitle, matchType, score) and links them to today's daily page as
 * chronological to-do checkboxes with time prefix and @page mention.
 *
 * Flow:
 *   1. If results is empty — log and return (no meetings to link)
 *   2. Load config, validate daysDatabaseId is configured
 *   3. Get Notion token from config, create client
 *   4. Resolve days data_source_id
 *   5. Sort results chronologically and build Notion to-do blocks
 *   6. Find today's daily page by date
 *   7a. If no page — create it with Meetings section and return
 *   7b. If page exists and Meetings H2 already present — skip (re-run guard)
 *   7c. If page exists without Meetings H2 — prepend Meetings section
 *
 * Notion API errors propagate without catch — fail-fast, per Phase 3 pattern.
 *
 * @param {Array<{ eventTitle: string, matchType: string, notionPageId: string, score: number, start: string }>} results
 *   Results array from syncMeetings(), extended with start field (Phase 4 requirement)
 * @returns {Promise<void>}
 * @throws {Error} If daysDatabaseId is not configured
 * @throws {Error} If Notion API returns any error (propagated)
 */
export async function syncDailyPage(results) {
  if (results.length === 0) {
    console.log('No meetings to link — skipping daily page');
    return;
  }

  // Load and validate config
  const config = await loadConfig();
  if (!config.daysDatabaseId) {
    throw new Error('Days database not configured. Run: prepare-my-day setup');
  }

  // Get Notion token from config and create client
  if (!config.notionToken) {
    throw new Error('Notion token not configured. Run: prepare-my-day setup');
  }
  const client = createNotionClient(config.notionToken);

  // Resolve the days data_source_id from the database UUID
  const daysDataSourceId = await resolveDataSourceId(client, config.daysDatabaseId);

  // Sort results chronologically and build Notion to-do block objects
  const sorted = sortMeetingResults(results);
  const meetingBlocks = buildMeetingBlocks(sorted);

  // Find today's daily page
  const todayPage = await findTodayPage(client, daysDataSourceId);

  if (!todayPage) {
    // No page for today — create it with Meetings section
    await createTodayPage(client, daysDataSourceId, meetingBlocks);
    console.log('Daily page created with meetings section');
    return;
  }

  // Page exists — check re-run guard
  const alreadyDone = await hasMeetingsSection(client, todayPage.id);
  if (alreadyDone) {
    console.log('Daily page already has meetings — skipping');
    return;
  }

  // Prepend Meetings section above existing content
  await prependMeetingsSection(client, todayPage.id, meetingBlocks);
  console.log(`Daily page updated: ${results.length} meeting(s) linked`);
}

// Re-exports for downstream testing/use
export { findTodayPage, hasMeetingsSection } from './notion.js';
