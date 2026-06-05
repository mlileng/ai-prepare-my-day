import { loadConfig } from '../config/manager.js';
import { findTodayNote, createDailyNote, hasMeetingsSection, prependMeetingsSection } from './obsidian.js';
import { sortMeetingResults, buildMeetingLines } from './blocks.js';

export async function syncDailyPage(results) {
  if (results.length === 0) {
    console.log('No meetings to link — skipping daily page');
    return;
  }

  const config = await loadConfig();
  if (!config.obsidianVaultPath) {
    throw new Error('Obsidian vault not configured. Run: prepare-my-day setup');
  }

  const vaultPath = config.obsidianVaultPath;
  const date = new Date().toISOString().slice(0, 10);

  const sorted = sortMeetingResults(results);
  const meetingLines = buildMeetingLines(sorted, config.timezone);

  const exists = await findTodayNote(vaultPath, date);

  if (!exists) {
    await createDailyNote(vaultPath, date, meetingLines);
    console.log('Daily page created with meetings section');
    return;
  }

  const alreadyDone = await hasMeetingsSection(vaultPath, date);
  if (alreadyDone) {
    console.log('Daily page already has meetings — skipping');
    return;
  }

  await prependMeetingsSection(vaultPath, date, meetingLines);
  console.log(`Daily page updated: ${results.length} meeting(s) linked`);
}

export { findTodayNote, hasMeetingsSection } from './obsidian.js';
