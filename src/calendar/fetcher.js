/**
 * ICS feed fetcher: wraps node-ical's async.fromURL to fetch a calendar feed.
 *
 * Locked decision: fail immediately on any error — no retries, no partial results.
 * The fetcher is intentionally thin; all parsing complexity lives in parser.js.
 */

import ical from 'node-ical';

/**
 * Fetch an ICS calendar feed from the given URL.
 *
 * @param {string} url - The ICS feed URL to fetch.
 * @returns {Promise<Record<string, any>>} - CalendarResponse object keyed by UID.
 * @throws {Error} With message "Calendar feed unreachable: <original message>" on any failure.
 */
export async function fetchCalendar(url) {
  try {
    const data = await ical.async.fromURL(url);
    return data;
  } catch (err) {
    throw new Error(`Calendar feed unreachable: ${err.message}`);
  }
}
