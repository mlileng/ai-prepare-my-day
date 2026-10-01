#!/usr/bin/env node
// Runs the calendar sync and updates the Paperclip issue based on exit code.
// Expects PAPERCLIP_API_URL and PAPERCLIP_API_KEY in env, plus either
// PAPERCLIP_TASK_ID or PAPERCLIP_RUN_ID (the process adapter only sets the
// latter, so the issue is resolved from the run).
//
// Exit codes: the sync's own exit code, or REPORT_FAILED_EXIT when the sync
// succeeded but the outcome could not be recorded in Paperclip. Without the
// latter a good run is left with no status and escalates to a human.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reportingConfigured, reportOutcome } from './lib/paperclip-report.js';

const REPORT_FAILED_EXIT = 3;

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

let finalExit = exitCode;
if (reportingConfigured(process.env)) {
  try {
    const { issueId, status } = await reportOutcome(process.env, { exitCode, stdout, stderr });
    process.stderr.write(`[paperclip-sync-runner] issue ${issueId} -> ${status}\n`);
  } catch (err) {
    process.stderr.write(`[paperclip-sync-runner] could not record outcome: ${err.message}\n`);
    if (exitCode === 0) finalExit = REPORT_FAILED_EXIT;
  }
}

process.exit(finalExit);
