import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import { validateNotionToken, validateDatabase, createNotionClient } from '../auth/notion.js';
import { extractDatabaseId } from '../utils/validation.js';
import { setSecret } from '../credentials/keychain.js';
import { updateConfig } from '../config/manager.js';
import { ACCOUNTS } from '../credentials/constants.js';

async function validateIcsUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) {
      return { valid: false, error: 'URL does not return valid ICS calendar data' };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Could not reach URL: ${error.message}` };
  }
}

export async function setupCommand() {
  console.log('\nPrepare My Day — Setup\n');

  try {
    // Step 1: Outlook Calendar ICS URL
    const icsPrompt = await prompts({
      type: 'text',
      name: 'icsUrl',
      message: 'Outlook calendar ICS URL:',
      validate: value => value.trim() ? true : 'ICS URL is required'
    });

    if (!icsPrompt.icsUrl) {
      console.log('\nSetup cancelled.');
      return;
    }

    const icsUrl = icsPrompt.icsUrl.trim();
    const icsSpinner = ora('Validating calendar feed...').start();

    const icsValidation = await validateIcsUrl(icsUrl);
    if (!icsValidation.valid) {
      icsSpinner.fail(icsValidation.error);
      return;
    }

    icsSpinner.succeed('Calendar feed connected');
    await updateConfig({ icsUrl });

    // Step 2: Notion Integration Token
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

    // Step 3: Notion Database URLs
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

    // Complete
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
