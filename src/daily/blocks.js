/**
 * Helpers for building and sorting Notion meeting block content.
 *
 * Provides formatting, sorting, and Notion block construction utilities
 * used by syncDailyPage to produce to-do checkboxes with time prefixes
 * and @page mentions on the daily page.
 *
 * @module daily/blocks
 */

/**
 * Format a Date object as a 12-hour time string with AM/PM.
 *
 * Per locked decision: 12-hour format with AM/PM, no leading zero on hour.
 * Examples: "9:00 AM", "10:30 PM", "12:00 PM"
 *
 * @param {Date} date - The date/time to format
 * @returns {string} 12-hour time string, e.g. "9:00 AM"
 */
export function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Sort meeting results chronologically with alphabetical tiebreaker.
 *
 * Per locked decision: primary sort is chronological by start time,
 * tiebreaker is alphabetical by eventTitle.
 * Does NOT mutate the input array — returns a new sorted array.
 *
 * @param {Array<{ start: string, eventTitle: string, notionPageId: string, matchType: string, score: number }>} results
 *   Array of meeting results from reconcileMeetings, each with ISO start string
 * @returns {Array<{ start: string, eventTitle: string, notionPageId: string, matchType: string, score: number }>}
 *   New sorted array
 */
export function sortMeetingResults(results) {
  return [...results].sort((a, b) => {
    const timeDiff = new Date(a.start) - new Date(b.start);
    if (timeDiff !== 0) return timeDiff;
    return a.eventTitle.localeCompare(b.eventTitle);
  });
}

/**
 * Build an array of Notion to-do block objects from sorted meeting results.
 *
 * Per locked decision: each block is an unchecked to-do checkbox with
 * a time prefix (12-hour format) and a native @page mention linking to
 * the meeting's Notion page.
 *
 * @param {Array<{ start: string, notionPageId: string, eventTitle: string }>} sortedResults
 *   Sorted array of meeting results from sortMeetingResults
 * @returns {Array<object>} Array of Notion to_do block objects
 */
export function buildMeetingBlocks(sortedResults) {
  return sortedResults.map(result => ({
    type: 'to_do',
    to_do: {
      rich_text: [
        {
          type: 'text',
          text: { content: `${formatTime(new Date(result.start))} ` },
        },
        {
          type: 'mention',
          mention: {
            type: 'page',
            page: { id: result.notionPageId },
          },
        },
      ],
      checked: false,
    },
  }));
}
