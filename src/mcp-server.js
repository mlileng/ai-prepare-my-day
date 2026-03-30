import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getTodaysMeetings } from './calendar/index.js';
import { syncMeetings } from './meetings/index.js';
import { syncDailyPage } from './daily/index.js';
import { loadConfig } from './config/manager.js';

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

server.tool(
  'post_to_teams',
  'Posts a message to the configured Teams channel via Power Automate webhook. IRREVERSIBLE — do not call speculatively or as a retry. Call only when the message is final and ready to send.',
  {
    message: z.string().describe('The message text to post')
  },
  async ({ message }) => {
    try {
      // Validate input
      if (!message || typeof message !== 'string' || message.trim() === '') {
        return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: 'message is required' }, null, 2) }] };
      }

      // Load config
      let config;
      try {
        config = await loadConfig();
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: err.message }, null, 2) }] };
      }

      // Check webhook is configured
      if (!config.teamsWebhookUrl) {
        return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: 'Teams webhook not configured. Run: prepare-my-day setup' }, null, 2) }] };
      }

      // Build Adaptive Card payload
      const payload = {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.3',
            body: [{ type: 'TextBlock', text: message, wrap: true }]
          }
        }]
      };

      // POST to webhook
      let response;
      try {
        response = await fetch(config.teamsWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: `Teams: ${err.message}` }, null, 2) }] };
      }

      if (!response.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: `Teams: HTTP ${response.status}` }, null, 2) }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify({ posted: true }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ posted: false, error: err.message }, null, 2) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
