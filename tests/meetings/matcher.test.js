/**
 * Test suite for src/meetings/matcher.js
 *
 * Tests the two-stage matching pipeline:
 *   Stage 1: bidirectional substring match (case-insensitive)
 *   Stage 2: Levenshtein fuzzy match with 0.8 threshold
 *
 * Uses Node.js built-in node:test and node:assert — no extra test dependencies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  levenshteinSimilarity,
  matchEvent,
} from '../../src/meetings/matcher.js';

// --------------------------------------------------------------------------
// Helper: create a mock Notion page with realistic property structure
// --------------------------------------------------------------------------

/**
 * @param {string} title - The page title
 * @param {string} editedTime - ISO 8601 last_edited_time string
 * @returns Notion-like page object
 */
function mockPage(title, editedTime = '2026-02-20T10:00:00.000Z') {
  return {
    object: 'page',
    last_edited_time: editedTime,
    properties: {
      Name: {
        type: 'title',
        title: title === '' ? [] : [{ plain_text: title }],
      },
    },
  };
}

// --------------------------------------------------------------------------
// normalizeTitle
// --------------------------------------------------------------------------

test('normalizeTitle trims and lowercases', () => {
  assert.equal(normalizeTitle('  Team Standup  '), 'team standup');
});

test('normalizeTitle handles null', () => {
  assert.equal(normalizeTitle(null), '');
});

test('normalizeTitle handles undefined', () => {
  assert.equal(normalizeTitle(undefined), '');
});

// --------------------------------------------------------------------------
// levenshteinSimilarity
// --------------------------------------------------------------------------

test('levenshteinSimilarity of identical strings equals 1.0', () => {
  assert.equal(levenshteinSimilarity('Team Standup', 'Team Standup'), 1.0);
});

test('levenshteinSimilarity of empty strings equals 1.0 (division-by-zero guard)', () => {
  assert.equal(levenshteinSimilarity('', ''), 1.0);
});

// --------------------------------------------------------------------------
// matchEvent — Stage 1: exact substring matching
// --------------------------------------------------------------------------

test('exact substring: event title exactly matches Notion page title -> type exact', () => {
  const pages = [mockPage('Team Standup')];
  const result = matchEvent('Team Standup', pages);
  assert.equal(result.type, 'exact');
  assert.equal(result.page, pages[0]);
});

test('bidirectional substring: event shorter than page title -> type exact', () => {
  // "Standup" is contained within "Team Standup"
  const pages = [mockPage('Team Standup')];
  const result = matchEvent('Standup', pages);
  assert.equal(result.type, 'exact');
  assert.equal(result.page, pages[0]);
});

test('bidirectional substring: event longer than page title -> type exact', () => {
  // "Team Standup" contains "Standup"
  const pages = [mockPage('Standup')];
  const result = matchEvent('Team Standup', pages);
  assert.equal(result.type, 'exact');
  assert.equal(result.page, pages[0]);
});

test('case-insensitive substring match: "team standup" matches "Team Standup" -> type exact', () => {
  const pages = [mockPage('Team Standup')];
  const result = matchEvent('team standup', pages);
  assert.equal(result.type, 'exact');
  assert.equal(result.page, pages[0]);
});

test('multiple substring matches: newest last_edited_time wins', () => {
  const older = mockPage('Team Standup', '2026-02-10T10:00:00.000Z');
  const newer = mockPage('Team Standup', '2026-02-20T10:00:00.000Z');
  const pages = [older, newer];
  const result = matchEvent('Team Standup', pages);
  assert.equal(result.type, 'exact');
  assert.equal(result.page, newer);
});

test('empty-titled Notion pages are excluded from substring matching', () => {
  const emptyPage = mockPage('');
  const pages = [emptyPage];
  // Empty page should never produce a substring match since we filter by normPage !== ''
  // With only an empty page in the pool, should fall through to fuzzy then none
  const result = matchEvent('Team Standup', pages);
  assert.notEqual(result.type, 'exact');
});

// --------------------------------------------------------------------------
// matchEvent — Stage 2: fuzzy matching
// --------------------------------------------------------------------------

test('fuzzy match above threshold: similar title -> type fuzzy', () => {
  // "Team Standup Weekly" vs "Team Standup" — no substring match; check fuzzy score
  const pages = [mockPage('Team Standup')];
  const result = matchEvent('Team Standup Weekly', pages);
  // The similarity of "Team Standup Weekly" (19 chars) vs "Team Standup" (12 chars)
  // Levenshtein distance ~7, maxLen=19, score = 1 - 7/19 ≈ 0.63
  // Actually let's compute: "team standup weekly" vs "team standup" — dist = 7, maxLen = 19
  // score = 1 - 7/19 = 0.632 — below 0.8 threshold
  // So this should be 'none', NOT 'fuzzy' — let's use a better example
  // "Team Standap" vs "Team Standup" — dist = 1, maxLen = 12, score = 1 - 1/12 ≈ 0.917
  // But "Standap" does not contain "Standup" and vice versa -> goes to fuzzy stage
  // This test should verify a score >= 0.8
  // Reframe: if score >= 0.8 -> fuzzy; otherwise none
  // For "Team Standup Weekly" we get ~0.63 — that would be 'none'
  // Let's test with "Team Standup!" which differs by 1 char: dist=1, maxLen=13, score≈0.923 > 0.8
  // But "Team Standup!" does contain "Team Standup" as substring — that would be exact!
  // Use a slight misspelling that doesn't substring match:
  // "Teem Standup" vs "Team Standup": dist=1, maxLen=12, score≈0.917 — no substring match
  const pagesForFuzzy = [mockPage('Team Standup')];
  const resultFuzzy = matchEvent('Teem Standup', pagesForFuzzy);
  // "teem standup" does not include "team standup" and vice versa
  // dist('teem standup', 'team standup') = 1, maxLen=12, score = 11/12 ≈ 0.917 >= 0.8
  assert.equal(resultFuzzy.type, 'fuzzy');
});

test('below threshold: dissimilar titles -> type none', () => {
  const pages = [mockPage('Team Standup')];
  const result = matchEvent('Budget Review', pages);
  assert.equal(result.type, 'none');
  assert.equal(result.page, null);
});

test('multiple fuzzy matches: newest edited first, then best score as tiebreaker', () => {
  // "Teem Standup" does not contain "Beem Standup" and vice versa (no substring match)
  // but their similarity is high: dist('teem standup', 'beem standup') = 1, maxLen = 12
  // score = 1 - 1/12 ≈ 0.917 >= 0.8 -> fuzzy
  const older = mockPage('Beem Standup', '2026-02-10T10:00:00.000Z');
  const newer = mockPage('Beem Standup', '2026-02-20T10:00:00.000Z');
  const pages = [older, newer];
  const result = matchEvent('Teem Standup', pages);
  // Both pages have the same score; newest should win
  assert.equal(result.type, 'fuzzy');
  assert.equal(result.page, newer);
});

test('empty-titled pages excluded from fuzzy matching', () => {
  const emptyPage = mockPage('');
  const pages = [emptyPage];
  const result = matchEvent('Budget Review', pages);
  assert.equal(result.type, 'none');
  assert.equal(result.page, null);
});
