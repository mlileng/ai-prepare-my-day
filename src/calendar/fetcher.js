/**
 * ICS feed fetcher: fetches raw ICS text and parses it with node-ical.
 *
 * Returns both the parsed CalendarResponse map and the raw text so that
 * the parser can extract RECURRENCE-ID exceptions before node-ical's
 * UID-keyed map overwrites them with the series master.
 *
 * Locked decision: fail immediately on any error — no retries, no partial results.
 */

import ical from 'node-ical';

/**
 * Fetch an ICS calendar feed from the given URL.
 *
 * @param {string} url - The ICS feed URL to fetch.
 * @returns {Promise<{ data: Record<string, any>, rawText: string }>}
 * @throws {Error} With message "Calendar feed unreachable: <original message>" on any failure.
 */
export async function fetchCalendar(url) {
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw new Error(`Calendar feed unreachable: ${err.message}`);
  }
  const data = ical.parseICS(text);
  return { data, rawText: text };
}
