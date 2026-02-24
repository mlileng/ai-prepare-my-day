#!/usr/bin/env node

import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';
import { cronSetupCommand } from './commands/cron-setup.js';

const program = new Command();

program
  .name('prepare-my-day')
  .description('Sync Outlook meetings to Notion')
  .version('0.1.0');

program
  .command('setup')
  .description('Configure calendar feed and Notion authentication')
  .action(setupCommand);

program
  .command('status')
  .description('Check authentication status')
  .action(statusCommand);

program
  .command('sync')
  .description('Sync today\'s meetings to Notion')
  .action(syncCommand);

program
  .command('cron-setup')
  .description('Print crontab entry for scheduled daily runs')
  .action(cronSetupCommand);

await program.parseAsync(process.argv);
