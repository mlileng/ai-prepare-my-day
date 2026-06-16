import ora from 'ora';
import { getTodaysMeetings } from '../calendar/index.js';
import { syncMeetings } from '../meetings/index.js';
import { syncDailyPage } from '../daily/index.js';

function getRunMeta() {
  const ts = new Date().toISOString();
  const trigger = process.env.PREPARE_MY_DAY_TRIGGER || (process.env.TERM ? 'cli' : 'cron');
  return { ts, trigger };
}

function printSyncSummary(events, results) {
  const { ts, trigger } = getRunMeta();
  const dailyPageStatus = results.length > 0 ? 'updated' : 'no meetings to link';
  console.log('');
  console.log('Sync complete:');
  console.log(`  Ran at         : ${ts}`);
  console.log(`  Triggered by   : ${trigger}`);
  console.log(`  Events fetched : ${events.length}`);
  console.log(`  Daily page     : ${dailyPageStatus}`);
}

async function syncCommandJson() {
  // Redirect console.log to stderr so pipeline's internal printSummary
  // calls don't pollute stdout and break JSON parsing by Paperclip.
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

  const { ts, trigger } = getRunMeta();
  const result = {
    ran_at: ts,
    triggered_by: trigger,
    meetings_found: 0,
    meetings_created: 0,
    meetings_matched: 0,
    daily_page_updated: false,
    errors: [],
  };

  // Stage 1: Calendar
  let events;
  let changed;
  try {
    ({ events, changed } = await getTodaysMeetings());
    result.meetings_found = events.length;
  } catch (err) {
    result.errors.push(`Calendar: ${err.message}`);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
  }

  // Stage 2: Meetings
  let results;
  try {
    results = await syncMeetings(events, { changed });
    result.meetings_created = results.filter(r => r.matchType === 'created').length;
    result.meetings_matched = results.filter(r => r.matchType === 'exact' || r.matchType === 'fuzzy').length;
  } catch (err) {
    result.errors.push(`Meetings: ${err.message}`);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(1);
  }

  // Stage 3: Daily Page
  try {
    await syncDailyPage(results);
    result.daily_page_updated = results.length > 0;
  } catch (err) {
    result.errors.push(`Daily page: ${err.message}`);
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.errors.length > 0) process.exit(1);
}

export async function syncCommand(options = {}) {
  if (options.json) {
    return syncCommandJson();
  }

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

  printSyncSummary(events, results);
}
