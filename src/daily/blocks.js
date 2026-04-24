/**
 * Helpers for building and sorting meeting content for daily pages.
 *
 * Provides sorting and markdown wikilink generation utilities
 * used by syncDailyPage to produce markdown meeting lines
 * for the daily page.
 *
 * @module daily/blocks
 */

import { formatEventTime } from '../utils/timezone.js';

/**
 * Sort meeting results chronologically with alphabetical tiebreaker.
 *
 * Per locked decision: primary sort is chronological by start time,
 * tiebreaker is alphabetical by eventTitle.
 * Does NOT mutate the input array — returns a new sorted array.
 *
 * @param {Array<{ start: string, eventTitle: string, filePath: string, matchType: string, score: number }>} results
 *   Array of meeting results from reconcileMeetings, each with ISO start string
 * @returns {Array<{ start: string, eventTitle: string, filePath: string, matchType: string, score: number }>}
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
 * Build an array of markdown wikilink strings from sorted meeting results.
 *
 * Each line is formatted as:
 * "- HH:MM [[filePath|eventTitle]]"
 *
 * The .md extension is stripped from filePath before placing it in the wikilink.
 *
 * @param {Array<{ start: string, filePath: string, eventTitle: string }>} sortedResults
 *   Sorted array of meeting results from sortMeetingResults
 * @returns {Array<string>} Array of markdown wikilink strings
 */
export function buildMeetingLines(sortedResults) {
  return sortedResults.map(result => {
    const time = formatEventTime(new Date(result.start));
    const wikiPath = result.filePath.replace(/\.md$/, '');
    return `- ${time} [[${wikiPath}|${result.eventTitle}]]`;
  });
}
