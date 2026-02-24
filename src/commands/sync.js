/**
 * sync command — orchestrates the full prepare-my-day pipeline.
 *
 * Runs three stages in sequence:
 *   1. Calendar: fetch today's meetings via getTodaysMeetings()
 *   2. Meetings: sync matched events to Notion via syncMeetings()
 *   3. Daily Page: link meeting pages to today's daily page via syncDailyPage()
 *
 * Each stage has its own ora spinner. On any failure the spinner displays
 * the error message (not a stack trace) and process exits with code 1.
 *
 * @module commands/sync
 */

import ora from 'ora';
import { getTodaysMeetings } from '../calendar/index.js';
import { syncMeetings } from '../meetings/index.js';
import { syncDailyPage } from '../daily/index.js';

/**
 * Print a structured sync summary after all three stages complete.
 *
 * The reconciler's internal printSummary() already prints the match breakdown
 * (exact/fuzzy/created/cached) during Stage 2. This summary is additive —
 * it wraps the top-level orchestration result only.
 *
 * @param {Array} events - Calendar events returned from getTodaysMeetings
 * @param {Array} results - Reconciliation results from syncMeetings
 */
function printSyncSummary(events, results) {
  const dailyPageStatus = results.length > 0 ? 'updated' : 'no meetings to link';
  console.log('');
  console.log('Sync complete:');
  console.log(`  Events fetched : ${events.length}`);
  console.log(`  Daily page     : ${dailyPageStatus}`);
}

/**
 * syncCommand — entry point for the `prepare-my-day sync` command.
 *
 * Async function registered as commander action handler.
 * Each stage wraps only its own API call in try/catch.
 * The spinner is created before the try block and finalized inside it.
 * process.exit(1) in the catch block prevents subsequent stages from running.
 */
export async function syncCommand() {
  // Stage 1: Calendar
  const calendarSpinner = ora('Fetching calendar events...').start();
  let events;
  let changed;
  try {
    ({ events, changed } = await getTodaysMeetings());
    calendarSpinner.succeed(`Calendar: ${events.length} event(s) for today`);
  } catch (err) {
    calendarSpinner.fail(`Calendar: ${err.message}`);
    process.exit(1);
  }

  // Stage 2: Meetings
  const meetingsSpinner = ora('Syncing meetings to Notion...').start();
  let results;
  try {
    results = await syncMeetings(events, { changed });
    meetingsSpinner.succeed('Meetings synced');
  } catch (err) {
    meetingsSpinner.fail(`Meetings: ${err.message}`);
    process.exit(1);
  }

  // Stage 3: Daily Page
  const dailySpinner = ora('Updating daily page...').start();
  try {
    await syncDailyPage(results);
    dailySpinner.succeed('Daily page updated');
  } catch (err) {
    dailySpinner.fail(`Daily page: ${err.message}`);
    process.exit(1);
  }

  // Summary
  printSyncSummary(events, results);
}
