import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SUPPRESS_FILE = path.join(os.homedir(), '.prepare-my-day', 'suppress.txt');

export async function loadSuppressedTerms() {
  let content;
  try {
    content = await fs.readFile(SUPPRESS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
