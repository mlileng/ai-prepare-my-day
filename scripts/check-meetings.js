#!/usr/bin/env node
/**
 * Dry-run: inspect calendar events without touching Notion.
 * No Notion API calls are made.
 *
 * Usage:
 *   node scripts/check-meetings.js                      # meetings that would sync to Notion
 *   node scripts/check-meetings.js --all                # all timed events from the feed for today
 *   node scripts/check-meetings.js --raw                # every VEVENT in the feed, no date filter
 *   node scripts/check-meetings.js --find "title"       # search for a specific event by title
 *   node scripts/check-meetings.js --debug "title"      # show raw rrule expansion results for a title
 */

import ical from 'node-ical';
import { getTodaysMeetings } from '../src/calendar/index.js';
import { loadConfig } from '../src/config/manager.js';
import { formatEventRange } from '../src/utils/timezone.js';

const showAll = process.argv.includes('--all');
const showRaw = process.argv.includes('--raw');
const findIdx = process.argv.indexOf('--find');
const findQuery = findIdx !== -1 ? process.argv[findIdx + 1]?.toLowerCase() : null;
const debugIdx = process.argv.indexOf('--debug');
const debugQuery = debugIdx !== -1 ? process.argv[debugIdx + 1]?.toLowerCase() : null;

if (debugQuery) {
  const config = await loadConfig();
  const calendarData = await ical.async.fromURL(config.icsUrl);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  for (const component of Object.values(calendarData)) {
    if (component.type !== 'VEVENT') continue;
    const title = typeof component.summary === 'string' ? component.summary : (component.summary?.val ?? '');
    if (!title.toLowerCase().includes(debugQuery)) continue;

    console.log(`\nEvent: "${title}"`);
    console.log(`  component.start  : ${component.start?.toISOString?.() ?? component.start}`);
    console.log(`  component.rrule  : ${component.rrule ? 'yes' : 'no'}`);
    console.log(`  component.status : ${component.status ?? '(none)'}`);
    console.log(`  todayStart (local): ${todayStart.toISOString()}`);
    console.log(`  todayEnd   (local): ${todayEnd.toISOString()}`);

    if (!component.rrule) {
      console.log('  No rrule — skipping expansion test.');
      continue;
    }

    const windows = [
      { label: 'tight (today only)',  from: todayStart, to: todayEnd },
      { label: '±1 day',             from: new Date(todayStart - 864e5), to: new Date(todayEnd + 864e5) },
      { label: '±7 days',            from: new Date(todayStart - 7*864e5), to: new Date(todayEnd + 7*864e5) },
      { label: '±30 days',           from: new Date(todayStart - 30*864e5), to: new Date(todayEnd + 30*864e5) },
      { label: '±90 days',           from: new Date(todayStart - 90*864e5), to: new Date(todayEnd + 90*864e5) },
    ];

    for (const w of windows) {
      try {
        const expanded = ical.expandRecurringEvent(component, { from: w.from, to: w.to });
        const todayInsts = expanded.filter(i => i.start >= todayStart && i.start <= todayEnd);
        console.log(`  [${w.label}] total expanded: ${expanded.length}, today instances: ${todayInsts.length}`);
        for (const i of expanded) console.log(`    → ${i.start?.toISOString?.()}`);
      } catch (err) {
        console.log(`  [${w.label}] ERROR: ${err.message}`);
      }
    }
  }
} else if (findQuery) {
  const config = await loadConfig();
  if (!config.icsUrl) {
    console.error('ICS URL not configured. Run: prepare-my-day setup');
    process.exit(1);
  }

  const calendarData = await ical.async.fromURL(config.icsUrl);
  const now = new Date();
  const matches = [];

  for (const component of Object.values(calendarData)) {
    if (component.type !== 'VEVENT') continue;

    const title = typeof component.summary === 'string'
      ? component.summary
      : (component.summary?.val ?? '');

    if (!title.toLowerCase().includes(findQuery)) continue;

    // Collect all instances (recurring or single)
    const instances = [];
    try {
      if (component.rrule) {
        // Expand a 6-month window centred on today to catch past and upcoming instances
        const windowStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        const windowEnd   = new Date(now.getFullYear(), now.getMonth() + 3, 31);
        const expanded = ical.expandRecurringEvent(component, { from: windowStart, to: windowEnd });
        for (const inst of expanded) {
          instances.push({ start: inst.start, end: inst.end, recurring: true });
        }
      } else {
        instances.push({ start: component.start, end: component.end, recurring: false });
      }
    } catch (err) {
      instances.push({ start: component.start, end: component.end, recurring: false, expandError: err.message });
    }

    for (const inst of instances) {
      const tags = [];
      if (inst.recurring) tags.push('recurring');
      if (inst.expandError) tags.push(`expand-error: ${inst.expandError}`);
      if (component.status === 'CANCELLED') tags.push('cancelled');
      if (inst.start?.dateOnly || component.datetype === 'date') tags.push('all-day');

      const attendees = Array.isArray(component.attendee)
        ? component.attendee
        : component.attendee ? [component.attendee] : [];
      const realCount = attendees.filter(a => a?.params?.CUTYPE !== 'ROOM' && a?.params?.CUTYPE !== 'RESOURCE').length;
      if (attendees.length > 0) tags.push(`attendees: ${realCount} real / ${attendees.length} total`);

      const startStr = inst.start ? inst.start.toISOString() : '(no start)';
      matches.push({ title, startStr, tags, start: inst.start ?? new Date(0) });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  if (matches.length === 0) {
    console.log(`No events found matching "${findQuery}".`);
  } else {
    console.log(`${matches.length} instance(s) matching "${findQuery}":\n`);
    for (const m of matches) {
      const suffix = m.tags.length ? `\n      [${m.tags.join(', ')}]` : '';
      console.log(`  ${m.startStr}  ${m.title}${suffix}`);
    }
  }
} else if (showAll || showRaw) {
  const config = await loadConfig();
  if (!config.icsUrl) {
    console.error('ICS URL not configured. Run: prepare-my-day setup');
    process.exit(1);
  }

  const calendarData = await ical.async.fromURL(config.icsUrl);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  console.log(`Local date boundary: ${todayStart.toISOString()} — ${todayEnd.toISOString()}\n`);

  const rows = [];

  for (const component of Object.values(calendarData)) {
    if (component.type !== 'VEVENT') continue;

    const title = typeof component.summary === 'string'
      ? component.summary
      : (component.summary?.val ?? '(no title)');

    if (showRaw) {
      // No date filtering — show everything with its raw start timestamp
      const start = component.start;
      const tags = [];
      if (component.rrule) tags.push('recurring');
      if (start?.dateOnly || component.datetype === 'date') tags.push('all-day');
      if (component.status === 'CANCELLED') tags.push('cancelled');
      const startStr = start ? start.toISOString() : '(no start)';
      rows.push({ sort: start ?? new Date(0), startStr, title, tags });
      continue;
    }

    // --all: expand recurring events and apply today boundary
    let instances = [];
    let expandError = null;
    try {
      if (component.rrule) {
        const expanded = ical.expandRecurringEvent(component, { from: todayStart, to: todayEnd });
        instances = expanded.map(inst => ({ start: inst.start, end: inst.end, isFullDay: inst.isFullDay }));
      } else if (component.start >= todayStart && component.start <= todayEnd) {
        instances = [{ start: component.start, end: component.end }];
      }
    } catch (err) {
      expandError = err.message;
    }

    if (expandError) {
      rows.push({ sort: new Date(0), startStr: '(expand failed)', title, tags: [`ERROR: ${expandError}`] });
      continue;
    }

    for (const inst of instances) {
      const isAllDay = inst.isFullDay || inst.start?.dateOnly || component.datetype === 'date';
      const range = isAllDay ? '(all day)' : formatEventRange(inst.start, inst.end);
      const tags = [];
      if (isAllDay) tags.push('all-day');
      if (component.status === 'CANCELLED') tags.push('cancelled');
      rows.push({ sort: inst.start, startStr: range, title, tags });
    }
  }

  rows.sort((a, b) => a.sort - b.sort);

  if (rows.length === 0) {
    console.log(showRaw
      ? 'No VEVENT components found in the feed at all.'
      : 'No events found for today in the calendar feed.');
  } else {
    const label = showRaw
      ? `${rows.length} VEVENT(s) in feed (no date filter):`
      : `${rows.length} event(s) from feed for today:`;
    console.log(`${label}\n`);
    for (const r of rows) {
      const suffix = r.tags.length ? `  [${r.tags.join(', ')}]` : '';
      console.log(`  ${r.startStr.padEnd(35)} ${r.title}${suffix}`);
    }
  }
} else {
  const { events } = await getTodaysMeetings();

  if (events.length === 0) {
    console.log('No meetings found for today.');
  } else {
    console.log(`${events.length} meeting(s) that would appear on today's Notion daily page:\n`);
    for (const e of events) {
      console.log(`  ${e.displayRange.padEnd(22)} ${e.title}`);
    }
  }
}
