import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reportingConfigured,
  resolveIssueId,
  reportOutcome,
} from '../scripts/lib/paperclip-report.js';

const BASE = { PAPERCLIP_API_URL: 'http://pc', PAPERCLIP_API_KEY: 'k', PAPERCLIP_RUN_ID: 'run-1' };
const noSleep = async () => {};
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Scripted fetch: each call consumes the next response (or throws if it's an Error).
function scripted(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

test('reportingConfigured needs URL and key', () => {
  assert.equal(reportingConfigured(BASE), true);
  assert.equal(reportingConfigured({ PAPERCLIP_API_URL: 'x' }), false);
  assert.equal(reportingConfigured({}), false);
});

test('resolveIssueId uses PAPERCLIP_TASK_ID without any request', async () => {
  const { fetchImpl, calls } = scripted([]);
  const id = await resolveIssueId({ ...BASE, PAPERCLIP_TASK_ID: 'task-9' }, { fetchImpl });
  assert.equal(id, 'task-9');
  assert.equal(calls.length, 0);
});

test('resolveIssueId resolves the single issue linked to the run', async () => {
  const { fetchImpl, calls } = scripted([res(200, [{ issueId: 'i-1', identifier: 'DAE-78', status: 'in_progress' }])]);
  const id = await resolveIssueId(BASE, { fetchImpl, sleepImpl: noSleep });
  assert.equal(id, 'i-1');
  assert.equal(calls[0].url, 'http://pc/api/heartbeat-runs/run-1/issues');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

test('resolveIssueId picks the one open issue among several', async () => {
  const { fetchImpl } = scripted([res(200, [
    { issueId: 'a', status: 'done' },
    { issueId: 'b', status: 'in_progress' },
  ])]);
  assert.equal(await resolveIssueId(BASE, { fetchImpl, sleepImpl: noSleep }), 'b');
});

test('resolveIssueId refuses to guess when several issues are open', async () => {
  const { fetchImpl } = scripted([res(200, [
    { issueId: 'a', identifier: 'DAE-1', status: 'in_progress' },
    { issueId: 'b', identifier: 'DAE-2', status: 'todo' },
  ])]);
  await assert.rejects(resolveIssueId(BASE, { fetchImpl, sleepImpl: noSleep }), /cannot pick one: DAE-1, DAE-2/);
});

test('resolveIssueId rejects an empty run, and a missing run id', async () => {
  const { fetchImpl } = scripted([res(200, [])]);
  await assert.rejects(resolveIssueId(BASE, { fetchImpl, sleepImpl: noSleep }), /not linked to any issue/);
  await assert.rejects(
    resolveIssueId({ PAPERCLIP_API_URL: 'u', PAPERCLIP_API_KEY: 'k' }, {}),
    /neither PAPERCLIP_TASK_ID nor PAPERCLIP_RUN_ID/,
  );
});

test('reportOutcome patches done with the JSON line on exit 0', async () => {
  const { fetchImpl, calls } = scripted([
    res(200, [{ issueId: 'i-1', status: 'in_progress' }]),
    res(200, {}),
  ]);
  const out = await reportOutcome(BASE, { exitCode: 0, stdout: 'noise\n{"ok":true}\n', stderr: '' }, { fetchImpl, sleepImpl: noSleep });
  assert.deepEqual(out, { issueId: 'i-1', status: 'done' });
  const patch = calls[1];
  assert.equal(patch.url, 'http://pc/api/issues/i-1');
  assert.equal(patch.init.method, 'PATCH');
  assert.equal(patch.init.headers['X-Paperclip-Run-Id'], 'run-1');
  assert.deepEqual(JSON.parse(patch.init.body), { status: 'done', comment: '{"ok":true}' });
});

test('reportOutcome patches blocked with the error snippet on failure', async () => {
  const { fetchImpl, calls } = scripted([res(200, {})]);
  await reportOutcome({ ...BASE, PAPERCLIP_TASK_ID: 't' }, { exitCode: 1, stdout: '', stderr: 'boom' }, { fetchImpl, sleepImpl: noSleep });
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: 'blocked', comment: 'Sync failed (exit 1): boom' });
});

test('reportOutcome retries 5xx and network errors, then succeeds', async () => {
  const { fetchImpl, calls } = scripted([res(503), new Error('ECONNRESET'), res(200, {})]);
  await reportOutcome({ ...BASE, PAPERCLIP_TASK_ID: 't' }, { exitCode: 0, stdout: '', stderr: '' }, { fetchImpl, sleepImpl: noSleep });
  assert.equal(calls.length, 3);
});

test('reportOutcome does not retry a 4xx, and surfaces it', async () => {
  const { fetchImpl, calls } = scripted([res(403)]);
  await assert.rejects(
    reportOutcome({ ...BASE, PAPERCLIP_TASK_ID: 't' }, { exitCode: 0, stdout: '', stderr: '' }, { fetchImpl, sleepImpl: noSleep }),
    /PATCH issue t failed: HTTP 403/,
  );
  assert.equal(calls.length, 1);
});

test('reportOutcome gives up after the retry budget and throws', async () => {
  const { fetchImpl, calls } = scripted([res(500), res(500), res(500), res(500)]);
  await assert.rejects(
    reportOutcome({ ...BASE, PAPERCLIP_TASK_ID: 't' }, { exitCode: 0, stdout: '', stderr: '' }, { fetchImpl, sleepImpl: noSleep }),
    /HTTP 500/,
  );
  assert.equal(calls.length, 4);
});
