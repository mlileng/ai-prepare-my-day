/**
 * Test suite for src/calendar/parser.js and src/utils/timezone.js
 *
 * Uses Node.js built-in test runner (node:test) — requires Node 18+.
 * All tests map to a locked filtering decision documented in 02-CONTEXT.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents } from '../../src/calendar/parser.js';
import { formatEventTime, formatEventRange } from '../../src/utils/timezone.js';

// ---------------------------------------------------------------------------
// Helper: construct a minimal VEVENT-like object for today
// ---------------------------------------------------------------------------
function mockEvent(overrides = {}) {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0);
  return {
    type: 'VEVENT',
    uid: 'test-uid-' + Math.random().toString(36).slice(2),
    summary: 'Test Meeting',
    start,
    end,
    status: 'CONFIRMED',
    ...overrides,
  };
}

/**
 * Wrap a single event into a CalendarResponse-shaped object.
 * node-ical returns an object keyed by UID.
 */
function toCalendarData(...events) {
  const data = {};
  for (const ev of events) {
    data[ev.uid] = ev;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// 1. Basic timed meeting today
test('includes a basic timed meeting happening today', () => {
  const event  = mockEvent({ summary: 'Standup', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Standup');
  assert.deepEqual(result[0].start, event.start);
  assert.deepEqual(result[0].end, event.end);
});

// 2. All-day events (dateOnly) are excluded
test('excludes all-day events (dateOnly)', () => {
  const start = Object.assign(new Date(), { dateOnly: true });
  const event = mockEvent({ start });
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 0);
});

// 3. All-day events (datetype: date) are excluded
test('excludes all-day events (datetype: date)', () => {
  const event  = mockEvent({ datetype: 'date' });
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 0);
});

// 4. Cancelled events are excluded
test('excludes cancelled events', () => {
  const event  = mockEvent({ status: 'CANCELLED' });
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 0);
});

// 5. Events not happening today are excluded
test('excludes events not happening today', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start  = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0, 0);
  const end    = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 11, 0, 0);
  const event  = mockEvent({ start, end });
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 0);
});

// 6. Title from string summary
test('extracts title from string summary', () => {
  const event = mockEvent({ summary: 'Team Standup', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result[0].title, 'Team Standup');
});

// 7. Title from ParameterValue object summary
test('extracts title from ParameterValue object summary', () => {
  const event = mockEvent({ summary: { val: 'Team Standup', params: {} }, attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result[0].title, 'Team Standup');
});

// 8. Solo event (single attendee) is excluded
test('excludes solo events when attendee data present', () => {
  const event = mockEvent({ attendee: { val: 'mailto:me@co.com', params: { PARTSTAT: 'ACCEPTED' } } });
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 0);
});

// 9. Event with multiple real attendees is included
test('includes events with multiple real attendees', () => {
  const event = mockEvent({ attendee: [
    { val: 'mailto:me@co.com',    params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:other@co.com', params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 1);
});

// 10. ROOM/RESOURCE attendees are not counted as real attendees
test('excludes ROOM/RESOURCE attendees from count', () => {
  const event = mockEvent({ attendee: [
    { val: 'mailto:me@co.com',      params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:room@co.com',    params: { CUTYPE: 'ROOM', PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  // Only one real attendee left → solo event → excluded
  assert.equal(result.length, 0);
});

// 11. Outlook fallback: no attendee data → include all timed events
test('includes all events when no attendee data present (Outlook fallback)', () => {
  const event  = mockEvent(); // no attendee field
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 1);
});

// 12. Declined events are excluded when userEmail provided
test('excludes declined events when userEmail provided', () => {
  const event = mockEvent({ attendee: [
    { val: 'mailto:me@co.com',    params: { PARTSTAT: 'DECLINED' } },
    { val: 'mailto:other@co.com', params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event), { userEmail: 'me@co.com' });
  assert.equal(result.length, 0);
});

// 13. Malformed events are skipped with a warning, not a crash
test('skips malformed events with warning and returns other valid events', () => {
  const badEvent = mockEvent({
    uid: 'bad-uid',
    rrule: { between: () => { throw new Error('bad rrule'); } }
  });
  const goodEvent = mockEvent({ attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});

  // Suppress console.warn for this test
  const originalWarn = console.warn;
  let warningCalled = false;
  console.warn = () => { warningCalled = true; };

  let result;
  assert.doesNotThrow(() => {
    result = parseEvents(toCalendarData(badEvent, goodEvent));
  });
  console.warn = originalWarn;

  assert.ok(warningCalled, 'Expected console.warn to be called for malformed event');
  // The good event should still appear
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Test Meeting');
});

// 14. Results are sorted by start time ascending
test('sorts results by start time', () => {
  const now   = new Date();
  const early = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9,  0, 0);
  const late  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);
  const earlyEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);
  const lateEnd  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0);

  const twoAttendees = [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ];

  const laterEvent  = mockEvent({ uid: 'later',  summary: 'Later',  start: late,  end: lateEnd,  attendee: twoAttendees });
  const earlierEvent = mockEvent({ uid: 'earlier', summary: 'Earlier', start: early, end: earlyEnd, attendee: twoAttendees });

  // Pass later event first to test sort
  const data = { 'later': laterEvent, 'earlier': earlierEvent };
  const result = parseEvents(data);

  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Earlier');
  assert.equal(result[1].title, 'Later');
});

// ---------------------------------------------------------------------------
// Timezone utility tests
// ---------------------------------------------------------------------------

// 15. formatEventTime uses IANA timezone from event
test('formatEventTime uses IANA timezone from event', () => {
  const date = Object.assign(new Date(2025, 5, 15, 14, 30, 0), { tz: 'America/New_York' });
  const result = formatEventTime(date);
  assert.match(result, /^\d{2}:\d{2}$/, 'Expected HH:MM format');
});

// 16. formatEventTime falls back to system timezone for Windows timezone ID
test('formatEventTime falls back to system timezone for Windows timezone ID', () => {
  const date = Object.assign(new Date(2025, 5, 15, 14, 30, 0), { tz: 'Eastern Standard Time' });
  let result;
  assert.doesNotThrow(() => {
    result = formatEventTime(date);
  });
  assert.match(result, /^\d{2}:\d{2}$/, 'Expected HH:MM format even with Windows timezone');
});

// 17. formatEventRange returns HH:MM–HH:MM format
test('formatEventRange returns correct range string', () => {
  const start = Object.assign(new Date(2025, 5, 15, 9,  0, 0), { tz: 'UTC' });
  const end   = Object.assign(new Date(2025, 5, 15, 10, 30, 0), { tz: 'UTC' });
  const result = formatEventRange(start, end);
  assert.match(result, /^\d{2}:\d{2}–\d{2}:\d{2}$/, 'Expected HH:MM–HH:MM format');
});

// ---------------------------------------------------------------------------
// CalendarEvent display field tests
// ---------------------------------------------------------------------------

// 18. CalendarEvent includes displayStart and displayEnd fields
test('CalendarEvent includes displayStart and displayEnd fields', () => {
  const now   = new Date();
  const start = Object.assign(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0),
    { tz: 'America/Chicago' }
  );
  const end   = Object.assign(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0),
    { tz: 'America/Chicago' }
  );
  const event = mockEvent({ start, end, attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 1);
  assert.equal(typeof result[0].displayStart, 'string', 'displayStart should be a string');
  assert.equal(typeof result[0].displayEnd, 'string', 'displayEnd should be a string');
  assert.match(result[0].displayStart, /^\d{2}:\d{2}$/, 'displayStart should be HH:MM format');
  assert.match(result[0].displayEnd,   /^\d{2}:\d{2}$/, 'displayEnd should be HH:MM format');
});

// ---------------------------------------------------------------------------
// Suppression list tests
// ---------------------------------------------------------------------------

// 20. Exact-match suppression: event title matching a suppressed term exactly is excluded
test('suppression list: excludes event whose title exactly matches a suppressed term', () => {
  const event = mockEvent({ summary: 'Work Block', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event), { suppressedMeetings: ['Work Block'] });
  assert.equal(result.length, 0);
});

// 21. Substring suppression: term suppresses event whose title contains it as a substring
test('suppression list: excludes event whose title contains a suppressed term as substring', () => {
  const event = mockEvent({ summary: 'Work Block (Meetings are Fine)', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event), { suppressedMeetings: ['Work Block'] });
  assert.equal(result.length, 0);
});

// 22. Case-insensitivity: suppressed term in different casing still matches
test('suppression list: match is case-insensitive', () => {
  const event = mockEvent({ summary: 'Work Block (Meetings are Fine)', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event), { suppressedMeetings: ['work block'] });
  assert.equal(result.length, 0);
});

// 23. Non-matching term: event whose title does not contain the suppressed term is included
test('suppression list: includes event whose title does not match any suppressed term', () => {
  const event = mockEvent({ summary: 'Team Standup', attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event), { suppressedMeetings: ['Work Block'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Team Standup');
});

// 19. CalendarEvent includes displayRange field in HH:MM–HH:MM format
test('CalendarEvent includes displayRange field in HH:MM–HH:MM format', () => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9,  0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
  const event = mockEvent({ start, end, attendee: [
    { val: 'mailto:alice@co.com', params: { PARTSTAT: 'ACCEPTED' } },
    { val: 'mailto:bob@co.com',   params: { PARTSTAT: 'ACCEPTED' } },
  ]});
  const result = parseEvents(toCalendarData(event));
  assert.equal(result.length, 1);
  assert.equal(typeof result[0].displayRange, 'string', 'displayRange should be a string');
  assert.match(result[0].displayRange, /^\d{2}:\d{2}–\d{2}:\d{2}$/, 'displayRange should be HH:MM–HH:MM format');
});
