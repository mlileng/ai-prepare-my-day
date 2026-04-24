import { loadConfig } from '../config/manager.js';
import { loadCache, saveCache } from '../calendar/cache.js';
import { fetchAllSeries } from './obsidian.js';
import { reconcileMeetings } from './reconciler.js';

export async function syncMeetings(events, { changed }) {
  if (!changed) {
    console.log('Meetings unchanged since last run — skipping');
    return [];
  }

  const config = await loadConfig();
  if (!config.obsidianVaultPath) {
    throw new Error('Obsidian vault not configured. Run: prepare-my-day setup');
  }

  const seriesPages = await fetchAllSeries(config.obsidianVaultPath);
  const cache = await loadCache();
  const date = new Date().toISOString().slice(0, 10);

  const { results, updatedMeetingMap } = await reconcileMeetings(seriesPages, events, {
    vaultPath: config.obsidianVaultPath,
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
