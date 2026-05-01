import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSuppressedTerms } from '../../src/calendar/suppression.js';

const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
const SUPPRESS_FILE = path.join(CONFIG_DIR, 'suppress.txt');
const BACKUP_FILE = path.join(CONFIG_DIR, 'suppress.txt.bak');

// Back up any real suppress.txt before tests, restore after
before(async () => {
  try {
    await fs.copyFile(SUPPRESS_FILE, BACKUP_FILE);
    await fs.unlink(SUPPRESS_FILE);
  } catch {
    // File didn't exist — nothing to back up
  }
});

after(async () => {
  try {
    await fs.unlink(SUPPRESS_FILE);
  } catch { /* already gone */ }
  try {
    await fs.copyFile(BACKUP_FILE, SUPPRESS_FILE);
    await fs.unlink(BACKUP_FILE);
  } catch { /* no backup existed */ }
});

test('returns empty array when suppress.txt does not exist', async () => {
  const result = await loadSuppressedTerms();
  assert.deepEqual(result, []);
});

test('returns empty array when suppress.txt is empty', async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SUPPRESS_FILE, '');
  const result = await loadSuppressedTerms();
  assert.deepEqual(result, []);
});

test('strips comments and blank lines, returns clean string array', async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SUPPRESS_FILE, [
    '# Blocked time',
    'Work Block (Meetings are Fine)',
    '',
    '# Stand-ups',
    'MRE Daily Scrum (New)',
    '  MKB Daily Scrum  ',  // leading/trailing whitespace
    '# trailing comment',
  ].join('\n'));

  const result = await loadSuppressedTerms();
  assert.deepEqual(result, [
    'Work Block (Meetings are Fine)',
    'MRE Daily Scrum (New)',
    'MKB Daily Scrum',
  ]);
});
