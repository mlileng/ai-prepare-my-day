#!/usr/bin/env node
// Runs the calendar sync and updates the Paperclip issue based on exit code.
// Expects PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_TASK_ID in env.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncScript = join(__dirname, '..', 'src', 'index.js');

const proc = spawnSync(process.execPath, [syncScript, 'sync', '--json'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

const stdout = proc.stdout?.toString() ?? '';
const stderr = proc.stderr?.toString() ?? '';
const exitCode = proc.status ?? 1;

// Pass through stderr and stdout so Paperclip captures them
if (stderr) process.stderr.write(stderr);
if (stdout) process.stdout.write(stdout);

const {
  PAPERCLIP_API_URL,
  PAPERCLIP_API_KEY,
  PAPERCLIP_TASK_ID,
  PAPERCLIP_RUN_ID,
} = process.env;

if (PAPERCLIP_API_URL && PAPERCLIP_API_KEY && PAPERCLIP_TASK_ID) {
  let comment;
  let status;

  if (exitCode === 0) {
    const jsonLine = stdout.trim().split('\n').reverse().find(l => l.startsWith('{'));
    comment = jsonLine ?? 'Sync completed successfully';
    status = 'done';
  } else {
    const errSnippet = (stderr || stdout).trim().slice(0, 400);
    comment = `Sync failed (exit ${exitCode})${errSnippet ? ': ' + errSnippet : ''}`;
    status = 'blocked';
  }

  const body = JSON.stringify({ status, comment });
  const headers = {
    'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
    'Content-Type': 'application/json',
    ...(PAPERCLIP_RUN_ID ? { 'X-Paperclip-Run-Id': PAPERCLIP_RUN_ID } : {}),
  };

  try {
    const resp = await fetch(`${PAPERCLIP_API_URL}/api/issues/${PAPERCLIP_TASK_ID}`, {
      method: 'PATCH',
      headers,
      body,
    });
    if (!resp.ok) {
      process.stderr.write(`[paperclip-sync-runner] PATCH issue failed: ${resp.status}\n`);
    }
  } catch (err) {
    process.stderr.write(`[paperclip-sync-runner] PATCH issue error: ${err.message}\n`);
  }
}

process.exit(exitCode);
