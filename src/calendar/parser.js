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
 * @typedef {{ uid: string, title: string, start: Date, end: Date, startTz?: string, endTz?: string, displayStart: string, displayEnd: string, displayRange: string }} CalendarEvent
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
  const { userEmail, suppressedMeetings = [] } = options;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // First pass: check whether ANY event in the feed carries attendee data.
  // This matters because Outlook ICS URLs without full-detail permissions omit ATTENDEE lines.
  let feedHasAttendeeData = false;
  let attendeeWarningEmitted = false;

  for (const component of Object.values(calendarData)) {
    if (component.type !== 'VEVENT') continue;
    if (component.attendee !== undefined) {
      feedHasAttendeeData = true;
      break;
    }
  }

  const results = [];

  for (const component of Object.values(calendarData)) {
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
        instances = expanded.filter(
          inst => !inst.isFullDay && inst.start >= todayStart && inst.start <= todayEnd
        );
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
        start:        eventStart,
        end:          eventEnd,
        startTz:      event.start?.tz,
        endTz:        event.end?.tz,
        displayStart: formatEventTime(eventStart),
        displayEnd:   formatEventTime(eventEnd),
        displayRange: formatEventRange(eventStart, eventEnd),
      });
    }
  }

  // 8. Sort by start time ascending
  results.sort((a, b) => a.start.getTime() - b.start.getTime());

  return results;
}
