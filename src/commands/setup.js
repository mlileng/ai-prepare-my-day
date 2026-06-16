import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import { Client } from '@notionhq/client';
import { updateConfig } from '../config/manager.js';

async function validateIcsUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) return { valid: false, error: 'URL does not return valid ICS calendar data' };
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Could not reach URL: ${error.message}` };
  }
}

async function validateNotionDatabase(apiKey, databaseId, label) {
  try {
    const client = new Client({ auth: apiKey });
    const db = await client.databases.retrieve({ database_id: databaseId });
    if (db.object !== 'database') {
      return { valid: false, error: `${label}: integration does not have full access to this database` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `${label}: ${err.message}` };
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
      validate: value => value.trim() ? true : 'ICS URL is required',
    });
    if (!icsPrompt.icsUrl) { console.log('\nSetup cancelled.'); return; }

    const icsUrl = icsPrompt.icsUrl.trim();
    const icsSpinner = ora('Validating calendar feed...').start();
    const icsValidation = await validateIcsUrl(icsUrl);
    if (!icsValidation.valid) { icsSpinner.fail(icsValidation.error); return; }
    icsSpinner.succeed('Calendar feed connected');
    await updateConfig({ icsUrl });

    // Step 2: Notion API key
    const apiKeyPrompt = await prompts({
      type: 'text',
      name: 'notionApiKey',
      message: 'Notion integration API key (starts with secret_):',
      validate: value => value.trim() ? true : 'Notion API key is required',
    });
    if (!apiKeyPrompt.notionApiKey) { console.log('\nSetup cancelled.'); return; }
    const notionApiKey = apiKeyPrompt.notionApiKey.trim();

    // Step 3: Meetings database ID
    const meetingsDbPrompt = await prompts({
      type: 'text',
      name: 'notionMeetingsDatabaseId',
      message: 'Notion meetings database ID:',
      validate: value => value.trim() ? true : 'Meetings database ID is required',
    });
    if (!meetingsDbPrompt.notionMeetingsDatabaseId) { console.log('\nSetup cancelled.'); return; }
    const notionMeetingsDatabaseId = meetingsDbPrompt.notionMeetingsDatabaseId.trim();

    // Step 4: Days database ID
    const daysDbPrompt = await prompts({
      type: 'text',
      name: 'notionDaysDatabaseId',
      message: 'Notion days database ID:',
      validate: value => value.trim() ? true : 'Days database ID is required',
    });
    if (!daysDbPrompt.notionDaysDatabaseId) { console.log('\nSetup cancelled.'); return; }
    const notionDaysDatabaseId = daysDbPrompt.notionDaysDatabaseId.trim();

    // Validate both databases with the provided API key
    const notionSpinner = ora('Validating Notion databases...').start();
    const meetingsValidation = await validateNotionDatabase(notionApiKey, notionMeetingsDatabaseId, 'Meetings database');
    if (!meetingsValidation.valid) { notionSpinner.fail(meetingsValidation.error); return; }
    const daysValidation = await validateNotionDatabase(notionApiKey, notionDaysDatabaseId, 'Days database');
    if (!daysValidation.valid) { notionSpinner.fail(daysValidation.error); return; }
    notionSpinner.succeed('Notion databases connected');

    await updateConfig({ notionApiKey, notionMeetingsDatabaseId, notionDaysDatabaseId });

    // Step 5: User email (for declined-event filtering)
    const emailPrompt = await prompts({
      type: 'text',
      name: 'userEmail',
      message: 'Your email address (for filtering declined meetings):',
    });
    if (emailPrompt.userEmail && emailPrompt.userEmail.trim()) {
      await updateConfig({ userEmail: emailPrompt.userEmail.trim() });
    }

    // Step 6: Teams webhook URL (optional)
    const teamsPrompt = await prompts({
      type: 'text',
      name: 'teamsWebhookUrl',
      message: 'Teams webhook URL (optional — press Enter to skip):',
    });
    if (teamsPrompt.teamsWebhookUrl && teamsPrompt.teamsWebhookUrl.trim()) {
      await updateConfig({ teamsWebhookUrl: teamsPrompt.teamsWebhookUrl.trim() });
    }

    // Step 7: Display timezone (optional)
    const timezonePrompt = await prompts({
      type: 'text',
      name: 'timezone',
      message: 'Display timezone (e.g. Europe/Oslo — press Enter to use system default):',
      validate: value => {
        if (!value.trim()) return true;
        try {
          Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
          return true;
        } catch {
          return `Unknown timezone "${value.trim()}". Use an IANA ID like America/Chicago or Europe/London.`;
        }
      },
    });
    if (timezonePrompt.timezone && timezonePrompt.timezone.trim()) {
      await updateConfig({ timezone: timezonePrompt.timezone.trim() });
    }

    console.log('\nSetup complete!\n');
  } catch (error) {
    if (error.message === 'User force closed the prompt') {
      console.log('\nSetup cancelled.');
      return;
    }
    throw error;
  }
}
