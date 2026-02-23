/**
 * Public API for calendar integration (Phase 2).
 *
 * Wires the full pipeline: load config -> fetch ICS -> parse events -> check cache.
 * Downstream phases should call getTodaysMeetings() as their single entry point.
 *
 * @module calendar
 */

import { fetchCalendar } from './fetcher.js';
import { parseEvents } from './parser.js';
import { hasEventsChanged } from './cache.js';
import { loadConfig } from '../config/manager.js';

/**
 * @typedef {{ uid: string, title: string, start: Date, end: Date, startTz?: string, endTz?: string }} CalendarEvent
 */

/**
 * Fetch, parse and cache-check today's calendar meetings.
 *
 * Reads ICS URL and optional userEmail from config. Fetches the ICS feed,
 * parses today's events, and checks whether the event list has changed since
 * the last run. The `changed` flag lets callers skip Notion sync when nothing
 * has changed.
 *
 * @returns {Promise<{ events: CalendarEvent[], changed: boolean }>}
 * @throws {Error} If ICS URL is not configured (actionable message with setup command)
 * @throws {Error} If the ICS feed is unreachable (propagated from fetchCalendar)
 */
export async function getTodaysMeetings() {
  // 1. Load config
  const config = await loadConfig();
  const { icsUrl, userEmail } = config;

  // 2. Validate ICS URL is configured
  if (!icsUrl) {
    throw new Error('ICS calendar URL not configured. Run: prepare-my-day setup');
  }

  // 3. Fetch ICS feed — throws "Calendar feed unreachable: ..." on any network failure
  //    Per locked decision: fail immediately, no retries. Do NOT catch here.
  const calendarData = await fetchCalendar(icsUrl);

  // 4. Parse today's events via the parser from plan 02-01
  const events = parseEvents(calendarData, { userEmail });

  // 5. Detect changes via content hash cache
  const changed = await hasEventsChanged(events);

  return { events, changed };
}

// Re-export sub-module functions for direct access by future phases / testing
export { fetchCalendar } from './fetcher.js';
export { parseEvents } from './parser.js';
export { hasEventsChanged } from './cache.js';
