/**
 * cron-setup command — prints a ready-to-paste crontab entry.
 *
 * Resolves node path dynamically from process.execPath (not `which node`)
 * so the crontab entry works correctly in cron's minimal PATH environment.
 *
 * @module commands/cron-setup
 */

import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

/**
 * cronSetupCommand — entry point for the `prepare-my-day cron-setup` command.
 *
 * Sync function (not async) — all values are resolved synchronously.
 * Prints crontab entry with dynamically resolved node path and script path.
 */
export function cronSetupCommand() {
  // Resolve the absolute path to the node executable currently running this script.
  // Using process.execPath avoids dependence on PATH resolution, which is critical
  // in cron's minimal environment.
  const nodePath = process.execPath;

  // Resolve __dirname equivalent for ESM modules.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Resolve absolute path to src/index.js (one directory up from src/commands/).
  const scriptPath = path.resolve(__dirname, '../index.js');

  // Resolve the log file path in the user's home directory.
  const logPath = path.join(os.homedir(), '.prepare-my-day', 'sync.log');

  console.log('Prepare My Day — Cron Setup');
  console.log('');
  console.log('Add this line to your crontab (run: crontab -e):');
  console.log('');
  console.log(`0 7 * * 1-5 ${nodePath} ${scriptPath} sync >> ${logPath} 2>&1`);
  console.log('');
  console.log('This runs sync at 07:00 on weekdays (Mon-Fri).');
  console.log('To run daily including weekends, change "1-5" to "*".');
  console.log('');
  console.log('macOS notes:');
  console.log('- Grant Full Disk Access to /usr/sbin/cron in');
  console.log('    System Settings > Privacy & Security > Full Disk Access');
  console.log("- Run 'prepare-my-day sync' manually once before enabling cron");
  console.log('    to pre-authorize Keychain access');
}
