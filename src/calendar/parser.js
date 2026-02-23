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
  const { userEmail } = options;

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

    // 3. All-day filter (locked decision)
    if (event.start?.dateOnly === true || event.datetype === 'date') continue;

    // 4. Recurring expansion & today boundary check (wrapped for malformed handling)
    let instances = [];
    try {
      if (event.rrule) {
        const expanded = ical.expandRecurringEvent(event, { from: todayStart, to: todayEnd });
        // Filter out full-day instances that may sneak through
        instances = expanded.filter(inst => !inst.isFullDay);
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
    if (feedHasAttendeeData) {
      const attendees = normalizeAttendees(event);
      const realAttendees = attendees.filter(isRealAttendee);
      // Solo event: only one real attendee (or none)
      if (realAttendees.length <= 1) continue;
    } else {
      // Outlook ICS fallback: no attendee data on any event — emit one-time warning
      if (!attendeeWarningEmitted) {
        console.warn(
          'Calendar feed lacks attendee data — solo event filtering disabled. ' +
          'Re-generate ICS URL with "Can view all details" permission to enable.'
        );
        attendeeWarningEmitted = true;
      }
      // Include all timed events (attendee filtering skipped)
    }

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
  results.sort((a, b) => a.start - b.start);

  return results;
}
