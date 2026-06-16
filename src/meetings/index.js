import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';
import { loadCache, saveCache } from '../calendar/cache.js';
import { resolveDataSourceId, fetchAllMeetingPages } from './notion.js';
import { reconcileMeetings } from './reconciler.js';

export async function syncMeetings(events, { changed }) {
  if (!changed) {
    console.log('Meetings unchanged since last run — skipping');
    return [];
  }

  const config = await loadConfig();
  if (!config.notionApiKey || !config.notionMeetingsDatabaseId) {
    throw new Error('Notion not configured. Run: prepare-my-day setup');
  }

  const client = new Client({ auth: config.notionApiKey });
  const dataSourceId = await resolveDataSourceId(client, config.notionMeetingsDatabaseId);
  const seriesPages = await fetchAllMeetingPages(client, dataSourceId);
  const cache = await loadCache();
  const date = new Date().toISOString().slice(0, 10);

  const { results, updatedMeetingMap } = await reconcileMeetings(seriesPages, events, {
    client,
    dataSourceId,
    date,
    cache,
  });

  await saveCache(
    date,
    cache.hash ?? '',
    updatedMeetingMap
  );

  return results;
}

export { matchEvent } from './matcher.js';
