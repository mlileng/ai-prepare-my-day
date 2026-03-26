import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getTodaysMeetings } from './calendar/index.js';
import { syncMeetings } from './meetings/index.js';
import { syncDailyPage } from './daily/index.js';

// Redirect console.log to stderr — stdout is the MCP stdio protocol channel.
// Imports are hoisted, but the pipeline functions only call console.log at
// runtime (when the tool is invoked), so this redirect is in place in time.
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

const server = new McpServer({
  name: 'executive-assistant',
  version: '1.0.0',
});

server.tool(
  'sync_calendar',
  "Syncs today's calendar meetings to Notion and updates the daily page. Returns structured JSON with meeting counts and any errors. Safe to call multiple times — idempotent via content hash cache.",
  {}, // no input parameters
  async () => {
    const result = {
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
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // Stage 2: Meetings
    let results;
    try {
      results = await syncMeetings(events, { changed });
      result.meetings_created = results.filter(r => r.matchType === 'created').length;
      result.meetings_matched = results.length - result.meetings_created;
    } catch (err) {
      result.errors.push(`Meetings: ${err.message}`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // Stage 3: Daily Page
    try {
      await syncDailyPage(results);
      result.daily_page_updated = results.length > 0;
    } catch (err) {
      result.errors.push(`Daily page: ${err.message}`);
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
