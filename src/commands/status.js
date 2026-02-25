import { loadConfig } from '../config/manager.js';
import { validateNotionToken } from '../auth/notion.js';

export async function statusCommand() {
  console.log('\nPrepare My Day — Status\n');

  // Check 1: Config file
  let config;
  try {
    config = await loadConfig();
    console.log('[x] Config — ~/.prepare-my-day/config.json');
  } catch (error) {
    console.log('[ ] Config — not found (run: prepare-my-day setup)');
    config = null;
  }

  // Check 2: Outlook calendar (ICS feed)
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
    } catch (error) {
      console.log('[ ] Outlook — feed unreachable (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Outlook — not configured (run: prepare-my-day setup)');
  }

  // Check 3: Notion token
  if (config && config.notionToken) {
    try {
      const validation = await validateNotionToken(config.notionToken);

      if (validation.valid) {
        console.log(`[x] Notion — connected as ${validation.botName}`);
      } else {
        console.log('[ ] Notion — token invalid (run: prepare-my-day setup)');
      }
    } catch (error) {
      console.log('[ ] Notion — not configured (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Notion — not configured (run: prepare-my-day setup)');
  }

  // Check 4: Notion databases
  if (config && config.meetingsDatabaseId) {
    console.log(`[x] Meetings DB — ${config.meetingsDatabaseId.substring(0, 8)}...`);
  } else {
    console.log('[ ] Meetings DB — not configured');
  }

  if (config && config.daysDatabaseId) {
    console.log(`[x] Days DB — ${config.daysDatabaseId.substring(0, 8)}...`);
  } else {
    console.log('[ ] Days DB — not configured');
  }

  console.log();
}
