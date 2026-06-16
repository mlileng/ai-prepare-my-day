import { matchEvent } from './matcher.js';
import { createMeetingPage } from './notion.js';
import { hashSingleEvent } from '../calendar/cache.js';

function printSummary(results) {
  const exact = results.filter(r => r.matchType === 'exact').length;
  const fuzzy = results.filter(r => r.matchType === 'fuzzy').length;
  const created = results.filter(r => r.matchType === 'created').length;
  const cached = results.filter(r => r.matchType === 'cached').length;

  let summary = `Meetings: ${exact} matched, ${fuzzy} fuzzy matched, ${created} created`;
  if (cached > 0) summary += `, ${cached} unchanged (cached)`;
  console.log(summary);
}

export async function reconcileMeetings(seriesPages, events, { client, dataSourceId, date, cache }) {
  const results = [];
  const updatedMeetingMap = { ...cache.meetingMap };

  for (const event of events) {
    const eventHash = hashSingleEvent(event);

    if (cache.meetingMap[eventHash]) {
      results.push({
        eventTitle: event.title,
        matchType: 'cached',
        pageId: cache.meetingMap[eventHash],
        score: 0,
        start: event.start.toISOString(),
      });
      continue;
    }

    const match = matchEvent(event.title, seriesPages, 0.8);

    let pageId;
    let matchType;
    let score;

    if (match.type === 'exact' || match.type === 'fuzzy') {
      pageId = match.page.id;
      matchType = match.type;
      score = match.score;
    } else {
      const page = await createMeetingPage(client, dataSourceId, event.title);
      pageId = page.id;
      matchType = 'created';
      score = 0;
    }

    results.push({
      eventTitle: event.title,
      matchType,
      pageId,
      score,
      start: event.start.toISOString(),
    });
    updatedMeetingMap[eventHash] = pageId;
  }

  printSummary(results);
  return { results, updatedMeetingMap };
}
