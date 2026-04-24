import { matchEvent } from './matcher.js';
import { createMeetingInstance, createMeetingSeries } from './obsidian.js';
import { hashSingleEvent } from '../calendar/cache.js';

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;
  const seriesCreated = results.filter(r => r.seriesCreated).length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (seriesCreated > 0) summary += ` (${seriesCreated} series stub${seriesCreated > 1 ? 's' : ''} auto-created)`;
  if (cached > 0) summary += `, ${cached} unchanged (cached)`;
  console.log(summary);
}

export async function reconcileMeetings(seriesPages, events, { vaultPath, date, cache }) {
  const results = [];
  const updatedMeetingMap = { ...cache.meetingMap };

  for (const event of events) {
    const eventHash = hashSingleEvent(event);

    if (cache.meetingMap[eventHash]) {
      results.push({
        eventTitle: event.title,
        matchType: 'cached',
        filePath: cache.meetingMap[eventHash],
        score: 0,
        start: event.start.toISOString(),
      });
      continue;
    }

    const match = matchEvent(event.title, seriesPages, 0.8);

    let seriesSlug;
    let seriesId;
    let matchType;
    let score;

    if (match.type === 'exact' || match.type === 'fuzzy') {
      seriesSlug = match.page.slug;
      seriesId = match.page.id;
      matchType = match.type;
      score = match.score;
    } else {
      seriesSlug = toSlug(event.title);
      matchType = 'created';
      score = 0;
      if (event.isRecurring) {
        const seriesRelPath = await createMeetingSeries(vaultPath, event, date, seriesSlug);
        seriesId = seriesRelPath;
      } else {
        seriesId = null;
      }
    }

    const filePath = await createMeetingInstance(vaultPath, event, date, seriesSlug, seriesId);

    results.push({
      eventTitle: event.title,
      matchType,
      filePath,
      score,
      start: event.start.toISOString(),
      seriesCreated: matchType === 'created' && !!event.isRecurring,
    });
    updatedMeetingMap[eventHash] = filePath;
  }

  printSummary(results);
  return { results, updatedMeetingMap };
}
