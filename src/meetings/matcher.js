/**
 * Meeting title matcher module.
 *
 * Implements a two-stage pipeline for matching calendar event titles
 * against existing Notion meeting page titles:
 *
 *   Stage 1: Bidirectional substring match (case-insensitive)
 *   Stage 2: Levenshtein fuzzy scoring (threshold 0.8 by default)
 *
 * Exports: normalizeTitle, levenshteinSimilarity, matchEvent
 */

import { distance } from 'fastest-levenshtein';

// --------------------------------------------------------------------------
// Public: normalizeTitle
// --------------------------------------------------------------------------

/**
 * Normalize a title for comparison.
 * - Lowercase and trim whitespace
 * - Collapse multiple spaces to single space
 * - Normalize smart quotes to ASCII equivalents
 * Returns empty string for null/undefined input.
 *
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return (title ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

// --------------------------------------------------------------------------
// Internal: getPageTitle
// --------------------------------------------------------------------------

/**
 * Extract the plain-text title from a Notion page object.
 * Searches for the property with type 'title' (regardless of key name).
 * Returns empty string if no title property is found or it is empty.
 *
 * @param {{ properties: Record<string, { type: string, title?: Array<{ plain_text: string }> }> }} page
 * @returns {string}
 */
function getPageTitle(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === 'title');
  if (!titleProp || !titleProp.title || titleProp.title.length === 0) return '';
  return titleProp.title.map(t => t.plain_text).join('');
}

// --------------------------------------------------------------------------
// Public: levenshteinSimilarity
// --------------------------------------------------------------------------

/**
 * Compute normalized similarity between two strings using Levenshtein distance.
 *   score = 1 - (distance / max(len_a, len_b))
 * Both empty strings returns 1.0 (identical; guards against division by zero).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 to 1.0
 */
export function levenshteinSimilarity(a, b) {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  return 1 - distance(normA, normB) / maxLen;
}

// --------------------------------------------------------------------------
// Public: matchEvent
// --------------------------------------------------------------------------

/**
 * Match a calendar event title against an array of Notion pages.
 *
 * Stage 1 — Bidirectional substring (case-insensitive):
 *   - If normPage.includes(normEvent) OR normEvent.includes(normPage)
 *   - Empty-titled pages are skipped
 *   - Multiple matches: sort by last_edited_time desc, then similarity score desc
 *   - Returns { type: 'exact', page, score }
 *
 * Stage 2 — Levenshtein fuzzy:
 *   - Score every non-empty-titled page
 *   - Sort by last_edited_time desc, then score desc
 *   - Best score >= threshold: returns { type: 'fuzzy', page, score }
 *   - Best score < threshold: returns { type: 'none', page: null, score }
 *
 * @param {string} eventTitle - Calendar event title
 * @param {Array<object>} notionPages - Array of Notion page objects
 * @param {number} [threshold=0.8] - Minimum similarity score for fuzzy match
 * @returns {{ type: 'exact'|'fuzzy'|'none', page: object|null, score: number }}
 */
export function matchEvent(eventTitle, notionPages, threshold = 0.8) {
  const normEvent = normalizeTitle(eventTitle);

  // Stage 1: bidirectional substring check (locked decision)
  const substringMatches = notionPages.filter(page => {
    const normPage = normalizeTitle(getPageTitle(page));
    if (normPage === '') return false; // skip empty-titled pages
    return normPage.includes(normEvent) || normEvent.includes(normPage);
  });

  if (substringMatches.length > 0) {
    // Sort: newest last_edited_time first, similarity score as tiebreaker
    const scored = substringMatches.map(page => ({
      page,
      score: levenshteinSimilarity(eventTitle, getPageTitle(page)),
      editedAt: new Date(page.last_edited_time).getTime(),
    }));
    scored.sort((a, b) => b.editedAt - a.editedAt || b.score - a.score);
    return { type: 'exact', page: scored[0].page, score: scored[0].score };
  }

  // Stage 2: fuzzy scoring (locked decision: fall back when no substring match)
  const fuzzy = notionPages
    .filter(page => getPageTitle(page) !== '')
    .map(page => ({
      page,
      score: levenshteinSimilarity(eventTitle, getPageTitle(page)),
      editedAt: new Date(page.last_edited_time).getTime(),
    }));

  // Sort: best score first, then newest as tiebreaker
  fuzzy.sort((a, b) => b.score - a.score || b.editedAt - a.editedAt);

  if (fuzzy.length > 0 && fuzzy[0].score >= threshold) {
    return { type: 'fuzzy', page: fuzzy[0].page, score: fuzzy[0].score };
  }

  return { type: 'none', page: null, score: fuzzy[0]?.score ?? 0 };
}
