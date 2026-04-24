import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortMeetingResults, buildMeetingLines } from '../src/daily/blocks.js';

const results = [
  { eventTitle: 'Standup', filePath: 'meetings/instances/2026-04-24-standup.md', start: '2026-04-24T09:00:00.000Z', matchType: 'exact', score: 1 },
  { eventTitle: 'Architecture Review', filePath: 'meetings/instances/2026-04-24-architecture-review.md', start: '2026-04-24T08:00:00.000Z', matchType: 'fuzzy', score: 0.9 },
];

test('sortMeetingResults orders chronologically', () => {
  const sorted = sortMeetingResults(results);
  assert.equal(sorted[0].eventTitle, 'Architecture Review');
  assert.equal(sorted[1].eventTitle, 'Standup');
});

test('sortMeetingResults does not mutate input', () => {
  const copy = [...results];
  sortMeetingResults(results);
  assert.deepEqual(results, copy);
});

test('buildMeetingLines returns markdown wikilink strings', () => {
  const sorted = sortMeetingResults(results);
  const lines = buildMeetingLines(sorted);
  assert.equal(lines.length, 2);
  // Each line starts with "- HH:MM"
  assert.ok(lines[0].startsWith('- '));
  assert.ok(lines[0].includes('[[meetings/instances/2026-04-24-architecture-review|Architecture Review]]'));
  assert.ok(lines[1].includes('[[meetings/instances/2026-04-24-standup|Standup]]'));
});

test('buildMeetingLines strips .md extension from filePath in wikilink', () => {
  const lines = buildMeetingLines([results[0]]);
  assert.ok(!lines[0].includes('.md'));
});
