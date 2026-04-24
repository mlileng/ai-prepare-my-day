import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/manager.js';

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function statusCommand() {
  console.log('\nPrepare My Day — Status\n');

  let config;
  try {
    config = await loadConfig();
    console.log('[x] Config — ~/.prepare-my-day/config.json');
  } catch {
    console.log('[ ] Config — not found (run: prepare-my-day setup)');
    config = null;
  }

  // Outlook ICS feed
  if (config && config.icsUrl) {
    try {
      const response = await fetch(config.icsUrl);
      if (response.ok) {
        const text = await response.text();
        if (text.includes('BEGIN:VCALENDAR')) {
          console.log('[x] Outlook — calendar feed reachable');
        } else {
          console.log('[ ] Outlook — feed URL does not return ICS data (run: prepare-my-day setup)');
        }
      } else {
        console.log(`[ ] Outlook — feed returned HTTP ${response.status} (run: prepare-my-day setup)`);
      }
    } catch {
      console.log('[ ] Outlook — feed unreachable (run: prepare-my-day setup)');
    }
  } else {
    console.log('[ ] Outlook — not configured (run: prepare-my-day setup)');
  }

  // Obsidian vault
  if (config && config.obsidianVaultPath) {
    const vaultExists = await pathExists(config.obsidianVaultPath);
    if (vaultExists) {
      console.log(`[x] Obsidian vault — ${config.obsidianVaultPath}`);
    } else {
      console.log(`[ ] Obsidian vault — path not found: ${config.obsidianVaultPath}`);
    }

    const seriesExists = await pathExists(path.join(config.obsidianVaultPath, 'meetings', 'series'));
    console.log(seriesExists
      ? '[x] Meetings series folder — meetings/series/'
      : '[ ] Meetings series folder — meetings/series/ not found'
    );

    const instancesExists = await pathExists(path.join(config.obsidianVaultPath, 'meetings', 'instances'));
    console.log(instancesExists
      ? '[x] Meeting instances folder — meetings/instances/'
      : '[ ] Meeting instances folder — meetings/instances/ not found'
    );
  } else {
    console.log('[ ] Obsidian vault — not configured (run: prepare-my-day setup)');
  }

  console.log();
}
