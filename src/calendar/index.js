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
import { loadSuppressedTerms } from './suppression.js';

/**
 * @typedef {{ uid: string, title: string, start: Date, end: Date, startTz?: string, endTz?: string, displayStart: string, displayEnd: string, displayRange: string }} CalendarEvent
 */

/**
 * Fetch, parse and cache-check today's calendar meetings.
 *
 * Reads ICS URL and userEmail from config; loads suppression terms from
 * `~/.prepare-my-day/suppress.txt`. Fetches the ICS feed, parses today's
 * events, and checks whether the event list has changed since the last run.
 *
 * @returns {Promise<{ events: CalendarEvent[], changed: boolean }>}
 * @throws {Error} If ICS URL is not configured (actionable message with setup command)
 * @throws {Error} If the ICS feed is unreachable (propagated from fetchCalendar)
 */
export async function getTodaysMeetings() {
  // 1. Load config and suppression list in parallel
  const [config, suppressedMeetings] = await Promise.all([
    loadConfig(),
    loadSuppressedTerms(),
  ]);
  const { icsUrl, userEmail, timezone } = config;

  // 2. Validate ICS URL is configured
  if (!icsUrl) {
    throw new Error('ICS calendar URL not configured. Run: prepare-my-day setup');
  }

  // 3. Fetch ICS feed — fail-fast, no retries
  const calendarData = await fetchCalendar(icsUrl);

  // 4. Parse today's events
  const events = parseEvents(calendarData, { userEmail, suppressedMeetings, timezone });

  // 5. Detect changes via content hash cache
  const changed = await hasEventsChanged(events);

  return { events, changed };
}

// Re-export sub-module functions for direct access by future phases / testing
export { fetchCalendar } from './fetcher.js';
export { parseEvents } from './parser.js';
export { hasEventsChanged } from './cache.js';
export { formatEventTime, formatEventRange } from '../utils/timezone.js';
