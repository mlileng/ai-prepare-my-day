/**
 * Timezone-safe time formatting utilities for calendar events.
 * Handles both IANA timezone IDs (e.g., 'America/New_York') and
 * Windows-style timezone IDs (e.g., 'Eastern Standard Time') with a
 * graceful fallback to system timezone.
 */

/**
 * Format a Date object as a zero-padded HH:MM string in the given timezone.
 *
 * Falls back to the system timezone when tz is null or undefined, preserving
 * the original behaviour for installs that have no timezone configured.
 *
 * @param {Date} date - A Date object (node-ical DateWithTimeZone or plain Date)
 * @param {string|null} [tz] - IANA timezone ID (e.g. 'America/Chicago'). Defaults to system tz.
 * @returns {string} Time formatted as "HH:MM"
 */
export function formatEventTime(date, tz) {
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
  return formatter.format(date);
}

/**
 * Format a start+end date pair as an "HH:MM–HH:MM" range string.
 *
 * @param {Date & { tz?: string }} start - Start time with optional `.tz`
 * @param {Date & { tz?: string }} end   - End time with optional `.tz`
 * @param {string|null} [tz] - IANA timezone ID. Defaults to system tz.
 * @returns {string} Range formatted as "HH:MM–HH:MM"
 */
export function formatEventRange(start, end, tz) {
  return `${formatEventTime(start, tz)}–${formatEventTime(end, tz)}`;
}
