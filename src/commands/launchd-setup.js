import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PLIST_LABEL = 'com.mlileng.prepare-my-day.sync';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function generatePlist() {
  const nodePath = process.execPath;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(__dirname, '../index.js');
  const logPath = path.join(os.homedir(), '.prepare-my-day', 'sync.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(nodePath)}</string>
        <string>${xmlEscape(scriptPath)}</string>
        <string>sync</string>
        <string>--once-per-day</string>
    </array>

    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PREPARE_MY_DAY_TRIGGER</key>
        <string>launchd</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${xmlEscape(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(logPath)}</string>

    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;
}

export function launchdSetupCommand(options = {}) {
  if (options.install) {
    const plist = generatePlist();
    const uid = os.userInfo().uid;
    const logPath = path.join(os.homedir(), '.prepare-my-day', 'sync.log');

    // Unload existing agent if already loaded (ignore errors — it may not be loaded)
    try {
      execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Not currently loaded — fine
    }

    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(PLIST_PATH, plist, 'utf8');

    try {
      execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`);
    } catch (err) {
      console.error(`Failed to load LaunchAgent: ${err.message}`);
      process.exit(1);
    }

    console.log(`Installed: ${PLIST_PATH}`);
    console.log('Sync will run at 07:00 on weekdays, and on login if a run was missed.');
    console.log('If sync has not run yet today, it will start momentarily.');
    return;
  }

  if (options.uninstall) {
    const uid = os.userInfo().uid;
    try {
      execSync(`launchctl bootout gui/${uid} "${PLIST_PATH}"`, { stdio: 'ignore' });
    } catch {
      // Already not loaded
    }
    if (fs.existsSync(PLIST_PATH)) {
      fs.unlinkSync(PLIST_PATH);
      console.log(`Removed: ${PLIST_PATH}`);
    } else {
      console.log('LaunchAgent plist not found — nothing to remove.');
    }
    return;
  }

  // Default: print generated plist for inspection
  console.log(generatePlist());
}
