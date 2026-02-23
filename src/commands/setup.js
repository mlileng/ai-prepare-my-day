import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import { createMsalApp, authenticateInteractive } from '../auth/azure.js';
import { validateNotionToken, validateDatabase, createNotionClient } from '../auth/notion.js';
import { extractDatabaseId } from '../utils/validation.js';
import { setSecret } from '../credentials/keychain.js';
import { saveConfig, loadConfig, updateConfig } from '../config/manager.js';
import { ACCOUNTS } from '../credentials/constants.js';

export async function setupCommand() {
  console.log('\nPrepare My Day — Setup\n');

  try {
    // Step 1: Azure AD App Configuration
    const azureConfig = await prompts([
      {
        type: 'text',
        name: 'clientId',
        message: 'Azure AD Application (client) ID:',
        validate: value => value.trim() ? true : 'Client ID is required'
      },
      {
        type: 'text',
        name: 'tenantId',
        message: 'Azure AD Directory (tenant) ID:',
        validate: value => value.trim() ? true : 'Tenant ID is required'
      }
    ]);

    if (!azureConfig.clientId || !azureConfig.tenantId) {
      console.log('\nSetup cancelled.');
      return;
    }

    // Save Azure config immediately
    await updateConfig({
      azureClientId: azureConfig.clientId.trim(),
      azureTenantId: azureConfig.tenantId.trim()
    });

    // Step 2: Azure AD Authentication
    const msalApp = createMsalApp(azureConfig.clientId.trim(), azureConfig.tenantId.trim());
    const spinner = ora('Waiting for browser authorization...').start();

    try {
      const account = await authenticateInteractive(msalApp);
      spinner.succeed(`Authenticated as ${account.username}`);
    } catch (error) {
      spinner.fail('Azure AD authentication failed');
      console.error(error.message);
      return;
    }

    // Step 3: Notion Integration Token
    const notionTokenPrompt = await prompts({
      type: 'password',
      name: 'notionToken',
      message: 'Notion integration token:'
    });

    if (!notionTokenPrompt.notionToken) {
      console.log('\nSetup cancelled.');
      return;
    }

    const notionToken = notionTokenPrompt.notionToken.trim();
    const tokenSpinner = ora('Validating Notion token...').start();

    const tokenValidation = await validateNotionToken(notionToken);
    if (!tokenValidation.valid) {
      tokenSpinner.fail(tokenValidation.error);
      return;
    }

    tokenSpinner.succeed(`Notion connected as ${tokenValidation.botName}`);

    // Store token in Keychain
    await setSecret(ACCOUNTS.NOTION_TOKEN, notionToken);

    // Step 4: Notion Database URLs
    const notionClient = createNotionClient(notionToken);

    // Meetings database
    const meetingsPrompt = await prompts({
      type: 'text',
      name: 'meetingsUrl',
      message: 'Notion Meetings database URL:',
      validate: value => extractDatabaseId(value) ? true : 'Could not extract database ID from URL'
    });

    if (!meetingsPrompt.meetingsUrl) {
      console.log('\nSetup cancelled.');
      return;
    }

    const meetingsId = extractDatabaseId(meetingsPrompt.meetingsUrl);
    const meetingsSpinner = ora('Validating Meetings database...').start();

    const meetingsValidation = await validateDatabase(notionClient, meetingsId, 'meetings');
    if (!meetingsValidation.valid) {
      meetingsSpinner.fail(meetingsValidation.error);
      return;
    }

    meetingsSpinner.succeed(`Meetings database: ${meetingsValidation.title}`);

    // Days database
    const daysPrompt = await prompts({
      type: 'text',
      name: 'daysUrl',
      message: 'Notion Days database URL:',
      validate: value => extractDatabaseId(value) ? true : 'Could not extract database ID from URL'
    });

    if (!daysPrompt.daysUrl) {
      console.log('\nSetup cancelled.');
      return;
    }

    const daysId = extractDatabaseId(daysPrompt.daysUrl);
    const daysSpinner = ora('Validating Days database...').start();

    const daysValidation = await validateDatabase(notionClient, daysId, 'days');
    if (!daysValidation.valid) {
      daysSpinner.fail(daysValidation.error);
      return;
    }

    daysSpinner.succeed(`Days database: ${daysValidation.title}`);

    // Save database IDs to config
    await updateConfig({
      meetingsDatabaseId: meetingsId,
      daysDatabaseId: daysId
    });

    // Step 5: Complete
    console.log('\nSetup complete!\n');

  } catch (error) {
    // Handle prompts cancellation (Ctrl+C)
    if (error.message === 'User force closed the prompt') {
      console.log('\nSetup cancelled.');
      return;
    }
    throw error;
  }
}
