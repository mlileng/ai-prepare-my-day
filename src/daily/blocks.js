import { formatEventTime } from '../utils/timezone.js';

export function sortMeetingResults(results) {
  return [...results].sort((a, b) => {
    const timeDiff = new Date(a.start) - new Date(b.start);
    if (timeDiff !== 0) return timeDiff;
    return a.eventTitle.localeCompare(b.eventTitle);
  });
}

export function buildMeetingBlocks(sortedResults, timezone) {
  return sortedResults.map(result => {
    const time = formatEventTime(new Date(result.start), timezone);
    return {
      type: 'to_do',
      to_do: {
        rich_text: [
          {
            type: 'text',
            text: { content: `${time} ` },
          },
          {
            type: 'mention',
            mention: {
              type: 'page',
              page: { id: result.pageId },
            },
          },
        ],
        checked: false,
      },
    };
  });
}
