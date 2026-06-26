/**
 * Calendar event parser: transforms raw node-ical CalendarResponse into
 * a filtered list of today's meetings.
 *
 * Locked filtering decisions (from user):
 *  - All-day events are excluded
 *  - Cancelled events (STATUS:CANCELLED) are excluded
 *  - Declined events (user PARTSTAT=DECLINED) are excluded when userEmail provided
 *  - Solo events (user is only real attendee) are excluded when attendee data is present
 *  - Events without attendee data are included with a one-time warning (Outlook fallback)
 *  - Recurring events are expanded to today's instance
 *  - Malformed events are skipped with a warning (no crash)
 *  - Meeting times carry timezone information for correct display
 */

import ical from 'node-ical';
import { formatEventTime, formatEventRange } from '../utils/timezone.js';

/**
 * @typedef {{ tz?: string } & Date} DateWithTz
 * @typedef {{ uid: string, title: string, isRecurring: boolean, start: Date, end: Date, startTz?: string, endTz?: string, displayStart: string, displayEnd: string, displayRange: string }} CalendarEvent
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a plain string title from node-ical's summary field, which can be
 * either a string or a ParameterValue object ({ val: string, params: {} }).
 *
 * @param {string | { val: string } | undefined} summary
 * @returns {string}
 */
function getTitle(summary) {
  if (typeof summary === 'string') return summary;
  return summary?.val ?? '';
}

/**
 * Normalise the attendee field to an array.
 * node-ical returns a single object for one attendee and an array for multiple.
 *
 * @param {any} event
 * @returns {any[]}
 */
function normalizeAttendees(event) {
  if (!event.attendee) return [];
  if (Array.isArray(event.attendee)) return event.attendee;
  return [event.attendee];
}

/**
 * Return true if the attendee is a real person (not a room or resource).
 *
 * @param {any} att
 * @returns {boolean}
 */
function isRealAttendee(att) {
  const cutype = att?.params?.CUTYPE;
  return cutype !== 'ROOM' && cutype !== 'RESOURCE';
}

/**
 * Scan raw ICS text for VEVENT blocks that are recurrence exceptions
 * (i.e. contain a RECURRENCE-ID line). Parse each one using node-ical
 * (with VTIMEZONE context) and return a map keyed by a composite
 * uid:recurrence:<isoDate> string so they survive the UID collision
 * that would otherwise let the series master overwrite them.
 *
 * @param {string} rawText - Raw ICS feed text.
 * @returns {Record<string, any>} Map of composite key → node-ical event object.
 */
function extractRecurrenceExceptions(rawText) {
  // Collect all VTIMEZONE blocks — needed to correctly parse timezone-aware dates
  const vtimezones = [];
  const tzRegex = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gi;
  let tzMatch;
  while ((tzMatch = tzRegex.exec(rawText)) !== null) {
    vtimezones.push(tzMatch[0]);
  }
  const tzBlock = vtimezones.join('\r\n');

  const exceptions = {};
  const blocks = rawText.split(/BEGIN:VEVENT/i).slice(1);

  for (const block of blocks) {
    const vevent = block.split(/END:VEVENT/i)[0];
    if (!/RECURRENCE-ID/i.test(vevent)) continue;

    const icsWrapper =
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${tzBlock}\r\nBEGIN:VEVENT${vevent}END:VEVENT\r\nEND:VCALENDAR`;

    let parsed;
    try {
      parsed = ical.parseICS(icsWrapper);
    } catch {
      continue;
    }

    const event = Object.values(parsed).find(e => e.type === 'VEVENT');
    if (!event?.uid || !event.recurrenceid) continue;

    const rid = event.recurrenceid instanceof Date
      ? event.recurrenceid
      : new Date(String(event.recurrenceid));
    if (isNaN(rid.getTime())) continue;

    const key = `${event.uid}:recurrence:${rid.toISOString()}`;
    exceptions[key] = event;
  }

  return exceptions;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a node-ical CalendarResponse and return today's qualifying meetings.
 *
 * @param {Record<string, any>} calendarData - Object returned by node-ical (keyed by UID)
 * @param {{ userEmail?: string }} [options]
 * @returns {CalendarEvent[]}
 */
export function parseEvents(calendarData, options = {}) {
  const { userEmail, suppressedMeetings = [], timezone = null, rawText = '' } = options;

  // Extract RECURRENCE-ID exceptions from raw text before the UID map loses them
  const exceptions = rawText ? extractRecurrenceExceptions(rawText) : {};
  const workingData = { ...calendarData, ...exceptions };

  // Build two per-UID suppression sets from the exceptions:
  //  - exceptionDatesByUid: YYYYMMDD of each exception's ORIGINAL recurrence
  //    slot (RECURRENCE-ID). Suppresses same-day overrides from RRULE expansion.
  //  - exceptionStartsByUid: ISO timestamp of each exception's NEW start
  //    (DTSTART). node-ical's expandRecurringEvent applies overrides in place,
  //    so a moved occurrence surfaces at its new date/time in the expansion.
  //    When an override moves an occurrence to a different date, the original
  //    date no longer matches, so we must also suppress by the moved start to
  //    avoid a duplicate against the standalone-extracted exception below.
  const exceptionDatesByUid = {};
  const exceptionStartsByUid = {};
  for (const exc of Object.values(exceptions)) {
    if (!exc.uid || !exc.recurrenceid) continue;
    const rid = exc.recurrenceid instanceof Date
      ? exc.recurrenceid
      : new Date(String(exc.recurrenceid));
    if (isNaN(rid.getTime())) continue;
    const dateStr = rid.toISOString().slice(0, 10).replace(/-/g, '');
    if (!exceptionDatesByUid[exc.uid]) exceptionDatesByUid[exc.uid] = new Set();
    exceptionDatesByUid[exc.uid].add(dateStr);

    if (exc.start instanceof Date && !isNaN(exc.start.getTime())) {
      if (!exceptionStartsByUid[exc.uid]) exceptionStartsByUid[exc.uid] = new Set();
      exceptionStartsByUid[exc.uid].add(exc.start.toISOString());
    }
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // First pass: check whether ANY event in the feed carries attendee data.
  // This matters because Outlook ICS URLs without full-detail permissions omit ATTENDEE lines.
  let feedHasAttendeeData = false;
  let attendeeWarningEmitted = false;

  for (const component of Object.values(workingData)) {
    if (component.type !== 'VEVENT') continue;
    if (component.attendee !== undefined) {
      feedHasAttendeeData = true;
      break;
    }
  }

  const results = [];

  for (const component of Object.values(workingData)) {
    // 1. Type guard — skip non-VEVENT components (VTIMEZONE, VCALENDAR, etc.)
    if (component.type !== 'VEVENT') continue;

    const event = component;

    // 2. Cancelled filter (locked decision)
    if (event.status === 'CANCELLED') continue;

    // 2b. Title prefix filter — skip events with non-actionable prefixes
    const title = getTitle(event.summary).trim().toLowerCase();
    if (title.startsWith('canceled:') || title.startsWith('following:')) continue;

    // 2c. Suppression list filter — skip events whose title contains a suppressed term
    if (suppressedMeetings.some(term => title.includes(term.toLowerCase()))) continue;

    // 3. All-day filter (locked decision)
    if (event.start?.dateOnly === true || event.datetype === 'date') continue;

    // 4. Recurring expansion & today boundary check (wrapped for malformed handling)
    let instances = [];
    try {
      if (event.rrule) {
        // Always expand from the event's own DTSTART rather than from today.
        //
        // node-ical's rrule-temporal has a jump optimisation that, when the
        // search window starts more than one recurrence interval after DTSTART,
        // advances the internal dtstart forward by that interval. This causes
        // it to skip RDATE-based occurrences that fall between the jumped
        // dtstart and the actual occurrence date.
        //
        // Starting from DTSTART guarantees steps=0 (no jump), so all RRULE
        // and RDATE occurrences up to todayEnd are generated correctly. We
        // then filter the results down to actual today instances.
        //
        // Guard: if DTSTART is after today there can be no instances today.
        if (event.start > todayEnd) {
          instances = [];
          continue;
        }
        const expanded = ical.expandRecurringEvent(event, { from: event.start, to: todayEnd });
        // Filter to actual today and exclude full-day instances
        const exDates = exceptionDatesByUid[event.uid] ?? new Set();
        const exStarts = exceptionStartsByUid[event.uid] ?? new Set();
        instances = expanded.filter(inst => {
          if (inst.isFullDay || inst.start < todayStart || inst.start > todayEnd) return false;
          // Suppress occurrence if its original slot was overridden (same-day shift)
          const instDateStr = inst.start.toISOString().slice(0, 10).replace(/-/g, '');
          if (exDates.has(instDateStr)) return false;
          // Suppress occurrence if it is a moved override already added standalone
          if (exStarts.has(inst.start.toISOString())) return false;
          return true;
        });
      } else {
        // Non-recurring: check if the event falls within today
        if (event.start >= todayStart && event.start <= todayEnd) {
          instances = [{ start: event.start, end: event.end }];
        }
      }
    } catch (err) {
      console.warn(`Warning: skipping malformed event "${getTitle(event.summary)}": ${err.message}`);
      continue;
    }

    if (instances.length === 0) continue;

    // 5. DECLINED filter (locked decision) — check before building results
    if (userEmail) {
      const attendees = normalizeAttendees(event);
      const userAtt = attendees.find(att => {
        const email = att?.val?.replace(/^mailto:/i, '').toLowerCase();
        return email === userEmail.toLowerCase();
      });
      if (userAtt?.params?.PARTSTAT === 'DECLINED') continue;
    }

    // 6. Attendee / solo filter (locked decision)
    const attendees = normalizeAttendees(event);
    if (attendees.length > 0) {
      // This event has attendee data — apply solo filter
      const realAttendees = attendees.filter(isRealAttendee);
      if (realAttendees.length <= 1) continue;
    } else if (!feedHasAttendeeData) {
      // No attendee data anywhere in the feed — Outlook ICS fallback, emit one-time warning
      if (!attendeeWarningEmitted) {
        console.warn(
          'Calendar feed lacks attendee data — solo event filtering disabled. ' +
          'Re-generate ICS URL with "Can view all details" permission to enable.'
        );
        attendeeWarningEmitted = true;
      }
      // Include all timed events (attendee filtering skipped)
    }
    // else: feedHasAttendeeData=true but this event has no attendee field —
    // cannot determine solo status, so include the event

    // 7. Build CalendarEvent objects for each instance
    for (const instance of instances) {
      const eventStart = instance.start ?? event.start;
      const eventEnd   = instance.end   ?? event.end;
      // Preserve .tz from the original event for formatting
      if (event.start?.tz && eventStart && !eventStart.tz) eventStart.tz = event.start.tz;
      if (event.end?.tz   && eventEnd   && !eventEnd.tz)   eventEnd.tz   = event.end.tz;

      results.push({
        uid:          event.uid,
        title:        getTitle(event.summary),
        isRecurring:  !!event.rrule,
        start:        eventStart,
        end:          eventEnd,
        startTz:      event.start?.tz,
        endTz:        event.end?.tz,
        displayStart: formatEventTime(eventStart, timezone),
        displayEnd:   formatEventTime(eventEnd, timezone),
        displayRange: formatEventRange(eventStart, eventEnd, timezone),
      });
    }
  }

  // 8. Sort by start time ascending
  results.sort((a, b) => a.start.getTime() - b.start.getTime());

  return results;
}
