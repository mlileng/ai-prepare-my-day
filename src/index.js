#!/usr/bin/env node

import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';
import { cronSetupCommand } from './commands/cron-setup.js';
import { launchdSetupCommand } from './commands/launchd-setup.js';

const program = new Command();

program
  .name('prepare-my-day')
  .description('Sync Outlook calendar meetings to Notion')
  .version('0.7.0');

program
  .command('setup')
  .description('Configure calendar feed and Notion databases')
  .action(setupCommand);

program
  .command('status')
  .description('Check authentication status')
  .action(statusCommand);

program
  .command('sync')
  .description('Sync today\'s meetings to Notion')
  .option('--json', 'Output structured JSON result instead of spinner UI')
  .option('--once-per-day', 'Skip if sync already ran today (used by LaunchAgent)')
  .action(syncCommand);

program
  .command('cron-setup')
  .description('Print crontab entry for scheduled daily runs')
  .action(cronSetupCommand);

program
  .command('launchd-setup')
  .description('Install or remove the macOS LaunchAgent for scheduled sync')
  .option('--install', 'Write plist to ~/Library/LaunchAgents/ and load it via launchctl')
  .option('--uninstall', 'Unload and remove the LaunchAgent plist')
  .action(launchdSetupCommand);

await program.parseAsync(process.argv);
