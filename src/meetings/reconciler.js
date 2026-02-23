/**
 * Meeting reconciliation loop.
 *
 * Matches calendar events against Notion meeting pages using the two-stage
 * matcher (substring + Levenshtein fuzzy). Creates new Notion pages for
 * events with no match. Uses per-event hash caching to skip already-processed
 * events on re-runs within the same day.
 *
 * @module meetings/reconciler
 */

import { matchEvent } from './matcher.js';
import { fetchAllMeetingPages, createMeetingPage, getPageTitle } from './notion.js';
import { hashSingleEvent } from '../calendar/cache.js';

/**
 * Print a summary of reconciliation results to the console.
 *
 * Format: "Meetings: {exact} matched, {fuzzy} fuzzy matched, {created} created"
 * Appends ", {cached} unchanged (cached)" if any cached events were skipped.
 *
 * @param {Array<{matchType: string}>} results
 */
function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (cached > 0) {
    summary += `, ${cached} unchanged (cached)`;
  }
  console.log(summary);
}

/**
 * Reconcile calendar events with Notion meeting pages.
 *
 * For each event:
 *   1. Check per-event hash in cache.meetingMap — if found, skip (cached)
 *   2. Run two-stage matcher (exact substring -> fuzzy -> none)
 *   3. On 'none': create new Notion page with title only
 *   4. Record result with matchType, notionPageId, score
 *
 * Prints a summary at the end. Returns results + updated meetingMap for
 * the caller to persist atomically.
 *
 * @param {Array<import('@notionhq/client').PageObjectResponse>} notionPages - Pages from fetchAllMeetingPages
 * @param {Array<{uid: string, title: string, start: Date, end: Date}>} events - Today's CalendarEvents
 * @param {{ client: import('@notionhq/client').Client, dataSourceId: string, cache: { meetingMap: object } }} opts
 * @returns {Promise<{
 *   results: Array<{ eventTitle: string, matchType: 'exact'|'fuzzy'|'created'|'cached', notionPageId: string, score: number }>,
 *   updatedMeetingMap: object
 * }>}
 */
export async function reconcileMeetings(notionPages, events, { client, dataSourceId, cache }) {
  const results = [];
  const updatedMeetingMap = { ...cache.meetingMap };

  for (const event of events) {
    const eventHash = hashSingleEvent(event);

    // Check cache first — skip already-processed events
    if (cache.meetingMap[eventHash]) {
      results.push({
        eventTitle: event.title,
        matchType: 'cached',
        notionPageId: cache.meetingMap[eventHash],
        score: 0,
      });
      continue;
    }

    // Run the two-stage matcher
    const match = matchEvent(event.title, notionPages, 0.8);

    if (match.type === 'exact') {
      results.push({
        eventTitle: event.title,
        matchType: 'exact',
        notionPageId: match.page.id,
        score: match.score,
      });
      updatedMeetingMap[eventHash] = match.page.id;
    } else if (match.type === 'fuzzy') {
      results.push({
        eventTitle: event.title,
        matchType: 'fuzzy',
        notionPageId: match.page.id,
        score: match.score,
      });
      updatedMeetingMap[eventHash] = match.page.id;
    } else {
      // No match — create a new title-only page
      const newPage = await createMeetingPage(client, dataSourceId, event.title);
      results.push({
        eventTitle: event.title,
        matchType: 'created',
        notionPageId: newPage.id,
        score: 0,
      });
      updatedMeetingMap[eventHash] = newPage.id;
    }
  }

  printSummary(results);

  return { results, updatedMeetingMap };
}
