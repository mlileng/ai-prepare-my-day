#!/usr/bin/env node

import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('prepare-my-day')
  .description('Sync Outlook meetings to Notion')
  .version('0.1.0');

program
  .command('setup')
  .description('Configure Azure AD and Notion authentication')
  .action(setupCommand);

program
  .command('status')
  .description('Check authentication status')
  .action(statusCommand);

program.parse(process.argv);
