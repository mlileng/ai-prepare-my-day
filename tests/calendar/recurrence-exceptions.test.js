/**
 * Test suite for RECURRENCE-ID exception handling in src/calendar/parser.js.
 *
 * These tests build real ICS text and parse it through node-ical, because
 * exception handling depends on extractRecurrenceExceptions() reading the raw
 * feed. Uses Node.js built-in test runner (node:test).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ical from 'node-ical';
import { parseEvents } from '../../src/calendar/parser.js';

// Format a Date as an ICS UTC timestamp: YYYYMMDDTHHMMSSZ
function icsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Build a date N days from today at a given UTC hour/minute.
function dayOffset(days, hour, minute = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour, minute, 0));
}

function buildIcs(vevents) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//test//EN',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}

// A weekly series whose occurrence is rescheduled (moved) onto today via a
// RECURRENCE-ID override. The original slot was 8 days ago / 1 day ago; the
// override moves the 1-day-ago occurrence to today. Must yield ONE instance.
test('moved RECURRENCE-ID override produces a single instance, not a duplicate', () => {
  const masterStart = dayOffset(-8, 15, 0);   // series anchor, weekly
  const masterEnd   = dayOffset(-8, 16, 0);
  const originalSlot = dayOffset(-1, 15, 0);   // natural occurrence being overridden
  const movedStart  = dayOffset(0, 16, 0);     // moved to TODAY
  const movedEnd    = dayOffset(0, 17, 0);

  const master = [
    'BEGIN:VEVENT',
    'UID:series-1',
    'SUMMARY:Weekly Sync',
    `DTSTART:${icsUtc(masterStart)}`,
    `DTEND:${icsUtc(masterEnd)}`,
    'RRULE:FREQ=WEEKLY;INTERVAL=1',
    'END:VEVENT',
  ];
  const override = [
    'BEGIN:VEVENT',
    'UID:series-1',
    'SUMMARY:Weekly Sync',
    `RECURRENCE-ID:${icsUtc(originalSlot)}`,
    `DTSTART:${icsUtc(movedStart)}`,
    `DTEND:${icsUtc(movedEnd)}`,
    'END:VEVENT',
  ];

  const rawText = buildIcs([...master, ...override]);
  const data = ical.sync.parseICS(rawText);
  const results = parseEvents(data, { rawText });

  const todays = results.filter(r => r.title === 'Weekly Sync');
  assert.equal(todays.length, 1, `expected 1 instance, got ${todays.length}`);
  assert.equal(todays[0].start.toISOString(), movedStart.toISOString());
});

// A same-day time-shift override (RECURRENCE-ID date == new date) must also
// yield a single instance. This case worked before; guards against regression.
test('same-day time-shift override produces a single instance', () => {
  const masterStart = dayOffset(-7, 14, 0);
  const masterEnd   = dayOffset(-7, 15, 0);
  const originalSlot = dayOffset(0, 14, 0);    // natural occurrence today at 14:00Z
  const movedStart  = dayOffset(0, 18, 0);     // shifted to 18:00Z, same day
  const movedEnd    = dayOffset(0, 19, 0);

  const master = [
    'BEGIN:VEVENT',
    'UID:series-2',
    'SUMMARY:Daily Shift',
    `DTSTART:${icsUtc(masterStart)}`,
    `DTEND:${icsUtc(masterEnd)}`,
    'RRULE:FREQ=WEEKLY;INTERVAL=1',
    'END:VEVENT',
  ];
  const override = [
    'BEGIN:VEVENT',
    'UID:series-2',
    'SUMMARY:Daily Shift',
    `RECURRENCE-ID:${icsUtc(originalSlot)}`,
    `DTSTART:${icsUtc(movedStart)}`,
    `DTEND:${icsUtc(movedEnd)}`,
    'END:VEVENT',
  ];

  const rawText = buildIcs([...master, ...override]);
  const data = ical.sync.parseICS(rawText);
  const results = parseEvents(data, { rawText });

  const todays = results.filter(r => r.title === 'Daily Shift');
  assert.equal(todays.length, 1, `expected 1 instance, got ${todays.length}`);
  assert.equal(todays[0].start.toISOString(), movedStart.toISOString());
});
