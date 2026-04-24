import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const prompts = require('prompts');

import ora from 'ora';
import fs from 'node:fs/promises';
import path from 'node:path';
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

async function validateVaultPath(vaultPath) {
  try {
    const obsidianDir = path.join(vaultPath, '.obsidian');
    await fs.access(obsidianDir);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Path does not exist or is not an Obsidian vault (no .obsidian/ folder found)' };
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

    // Step 2: Obsidian vault path
    const vaultPrompt = await prompts({
      type: 'text',
      name: 'obsidianVaultPath',
      message: 'Obsidian vault path (absolute):',
      validate: value => value.trim() ? true : 'Vault path is required',
    });
    if (!vaultPrompt.obsidianVaultPath) { console.log('\nSetup cancelled.'); return; }

    const obsidianVaultPath = vaultPrompt.obsidianVaultPath.trim();
    const vaultSpinner = ora('Validating vault...').start();
    const vaultValidation = await validateVaultPath(obsidianVaultPath);
    if (!vaultValidation.valid) { vaultSpinner.fail(vaultValidation.error); return; }
    vaultSpinner.succeed(`Vault connected: ${obsidianVaultPath}`);
    await updateConfig({ obsidianVaultPath });

    // Step 3: User email (for declined-event filtering)
    const emailPrompt = await prompts({
      type: 'text',
      name: 'userEmail',
      message: 'Your email address (for filtering declined meetings):',
    });
    if (emailPrompt.userEmail && emailPrompt.userEmail.trim()) {
      await updateConfig({ userEmail: emailPrompt.userEmail.trim() });
    }

    // Step 4: Teams webhook URL (optional)
    const teamsPrompt = await prompts({
      type: 'text',
      name: 'teamsWebhookUrl',
      message: 'Teams webhook URL (optional — press Enter to skip):',
    });
    if (teamsPrompt.teamsWebhookUrl && teamsPrompt.teamsWebhookUrl.trim()) {
      await updateConfig({ teamsWebhookUrl: teamsPrompt.teamsWebhookUrl.trim() });
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
