/**
 * Timezone-safe time formatting utilities for calendar events.
 * Handles both IANA timezone IDs (e.g., 'America/New_York') and
 * Windows-style timezone IDs (e.g., 'Eastern Standard Time') with a
 * graceful fallback to system timezone.
 */

/**
 * Format a Date object as a zero-padded HH:MM string.
 * Uses the timezone attached to the date object as `.tz` (node-ical DateWithTimeZone),
 * falling back to system timezone if the `.tz` value is unrecognised (e.g., Windows IDs).
 *
 * @param {Date & { tz?: string }} date - A Date, optionally with an IANA timezone string in `.tz`
 * @returns {string} Time formatted as "HH:MM"
 */
export function formatEventTime(date) {
  const timezone = date?.tz;

  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timezone ? { timeZone: timezone } : {})
    });
    return formatter.format(date);
  } catch (_err) {
    // Windows-style timezone IDs (e.g., 'Eastern Standard Time') cause a RangeError
    // in Intl.DateTimeFormat. Fall back to the system's local timezone.
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: systemTimezone
    });
    return formatter.format(date);
  }
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
