import { Client } from '@notionhq/client';
import { loadConfig } from '../config/manager.js';

async function checkNotionDatabase(client, databaseId, label) {
  try {
    const db = await client.databases.retrieve({ database_id: databaseId });
    if (db.object === 'database') {
      return `[x] Notion ${label} — connected`;
    }
    return `[ ] Notion ${label} — integration lacks full access (run: prepare-my-day setup)`;
  } catch (err) {
    return `[ ] Notion ${label} — ${err.message} (run: prepare-my-day setup)`;
  }
}

export async function statusCommand() {
  console.log('\nPrepare My Day — Status\n');

  let config;
  try {
    config = await loadConfig();
    console.log('[x] Config — ~/.prepare-my-day/config.json');
  } catch {
    console.log('[ ] Config — not found (run: prepare-my-day setup)');
    config = null;
  }

  // Outlook ICS feed
  if (config && config.icsUrl) {
    try {
      const response = await fetch(config.icsUrl);
      if (response.ok) {
        const text = await response.text();
        if (text.includes('BEGIN:VCALENDAR')) {
          console.log('[x] Outlook — calendar feed reachable');
        } else {
          console.log('[ ] Outlook — feed URL does not return ICS data (run: prepare-my-day setup)');
        }
      } else {
        console.log(`[ ] Outlook — feed returned HTTP ${response.status} (run: prepare-my-day setup)`);
      }
    } catch {
      console.log('[ ] Outlook — feed unreachable (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Outlook — not configured (run: prepare-my-day setup)');
  }

  // Notion
  if (config && config.notionApiKey) {
    const client = new Client({ auth: config.notionApiKey });

    if (config.notionMeetingsDatabaseId) {
      console.log(await checkNotionDatabase(client, config.notionMeetingsDatabaseId, 'meetings database'));
    } else {
      console.log('[ ] Notion meetings database — not configured (run: prepare-my-day setup)');
    }

    if (config.notionDaysDatabaseId) {
      console.log(await checkNotionDatabase(client, config.notionDaysDatabaseId, 'days database'));
    } else {
      console.log('[ ] Notion days database — not configured (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Notion — not configured (run: prepare-my-day setup)');
  }

  console.log();
}
