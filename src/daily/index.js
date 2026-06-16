import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';
import { resolveDataSourceId } from '../meetings/notion.js';
import { findTodayPage, createTodayPage, hasMeetingsSection, prependMeetingsSection } from './notion.js';
import { sortMeetingResults, buildMeetingBlocks } from './blocks.js';

export async function syncDailyPage(results) {
  if (results.length === 0) {
    console.log('No meetings to link — skipping daily page');
    return;
  }

  const config = await loadConfig();
  if (!config.notionApiKey || !config.notionDaysDatabaseId) {
    throw new Error('Notion not configured. Run: prepare-my-day setup');
  }

  const client = new Client({ auth: config.notionApiKey });
  const daysDataSourceId = await resolveDataSourceId(client, config.notionDaysDatabaseId);

  const sorted = sortMeetingResults(results);
  const meetingBlocks = buildMeetingBlocks(sorted, config.timezone);

  const existingPage = await findTodayPage(client, daysDataSourceId);

  if (!existingPage) {
    await createTodayPage(client, daysDataSourceId, meetingBlocks);
    console.log('Daily page created with meetings section');
    return;
  }

  const alreadyDone = await hasMeetingsSection(client, existingPage.id);
  if (alreadyDone) {
    console.log('Daily page already has meetings — skipping');
    return;
  }

  await prependMeetingsSection(client, existingPage.id, meetingBlocks);
  console.log(`Daily page updated: ${results.length} meeting(s) linked`);
}
