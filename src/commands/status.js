import { loadConfig } from '../config/manager.js';
import { createMsalApp, getAccount, acquireTokenSilent } from '../auth/azure.js';
import { validateNotionToken } from '../auth/notion.js';
import { getSecret } from '../credentials/keychain.js';
import { ACCOUNTS } from '../credentials/constants.js';

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

  // Check 2: Azure AD
  if (config && config.azureClientId && config.azureTenantId) {
    try {
      const msalApp = createMsalApp(config.azureClientId, config.azureTenantId);
      const account = await getAccount(msalApp);

      if (account) {
        try {
          // Try to acquire token silently (this handles auto-refresh)
          await acquireTokenSilent(msalApp);
          console.log(`[x] Outlook — connected as ${account.username} (token valid)`);
        } catch (error) {
          // Check if it's an InteractionRequiredAuthError
          if (error.message && error.message.includes('interaction_required')) {
            console.log('[ ] Outlook — token expired (run: prepare-my-day setup)');
          } else {
            console.log('[ ] Outlook — token expired (run: prepare-my-day setup)');
          }
        }
      } else {
        console.log('[ ] Outlook — not authenticated (run: prepare-my-day setup)');
      }
    } catch (error) {
      console.log('[ ] Outlook — not authenticated (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Outlook — not configured (run: prepare-my-day setup)');
  }

  // Check 3: Notion token
  try {
    const notionToken = await getSecret(ACCOUNTS.NOTION_TOKEN);

    if (notionToken) {
      const validation = await validateNotionToken(notionToken);

      if (validation.valid) {
        console.log(`[x] Notion — connected as ${validation.botName}`);
      } else {
        console.log('[ ] Notion — token invalid (run: prepare-my-day setup)');
      }
    } else {
      console.log('[ ] Notion — not configured (run: prepare-my-day setup)');
    }
  } catch (error) {
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
