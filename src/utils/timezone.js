/**
 * Timezone-safe time formatting utilities for calendar events.
 * Handles both IANA timezone IDs (e.g., 'America/New_York') and
 * Windows-style timezone IDs (e.g., 'Eastern Standard Time') with a
 * graceful fallback to system timezone.
 */

/**
 * Format a Date object as a zero-padded HH:MM string in the system's local timezone.
 *
 * Always uses the system timezone so that all events display at the time the
 * user will experience them locally, regardless of what timezone the event
 * was originally created in. This keeps display times consistent with the
 * sort order (which is UTC-based) and with the user's daily page view.
 *
 * @param {Date} date - A Date object (node-ical DateWithTimeZone or plain Date)
 * @returns {string} Time formatted as "HH:MM"
 */
export function formatEventTime(date) {
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: systemTimezone,
  });
  return formatter.format(date);
}

/**
 * Format a start+end date pair as an "HH:MM–HH:MM" range string.
 *
 * @param {Date & { tz?: string }} start - Start time with optional `.tz`
 * @param {Date & { tz?: string }} end   - End time with optional `.tz`
 * @returns {string} Range formatted as "HH:MM–HH:MM"
 */
export function formatEventRange(start, end) {
  return `${formatEventTime(start)}–${formatEventTime(end)}`;
}
