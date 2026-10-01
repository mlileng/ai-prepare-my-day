// Reports a sync outcome back to the Paperclip issue that triggered the run.
//
// Paperclip's `process` adapter sets PAPERCLIP_API_URL, PAPERCLIP_API_KEY and
// PAPERCLIP_RUN_ID but NOT PAPERCLIP_TASK_ID, so the issue is resolved from the
// run when the task id is absent. Every failure to report is surfaced to the
// caller — a run whose outcome can't be recorded must not look like a success.

const RETRY_DELAYS_MS = [500, 2000, 5000];
const OPEN_STATUSES = ['in_progress', 'todo', 'blocked'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status) {
  return status === 408 || status === 429 || status >= 500;
}

// fetch with retry on network errors and retryable statuses. Returns the final
// Response, or throws the last network error.
async function fetchWithRetry(url, init, { fetchImpl, sleepImpl, delays }) {
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await fetchImpl(url, init);
      if (resp.ok || !isRetryable(resp.status) || attempt === delays.length) return resp;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === delays.length) throw err;
    }
    await sleepImpl(delays[attempt]);
  }
  throw lastError;
}

export function reportingConfigured(env) {
  return Boolean(env.PAPERCLIP_API_URL && env.PAPERCLIP_API_KEY);
}

export async function resolveIssueId(env, opts = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = sleep,
    delays = RETRY_DELAYS_MS,
  } = opts;

  if (env.PAPERCLIP_TASK_ID) return env.PAPERCLIP_TASK_ID;
  if (!env.PAPERCLIP_RUN_ID) {
    throw new Error('neither PAPERCLIP_TASK_ID nor PAPERCLIP_RUN_ID is set');
  }

  const url = `${env.PAPERCLIP_API_URL}/api/heartbeat-runs/${env.PAPERCLIP_RUN_ID}/issues`;
  const resp = await fetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${env.PAPERCLIP_API_KEY}` } },
    { fetchImpl, sleepImpl, delays },
  );
  if (!resp.ok) throw new Error(`resolving issue for run failed: HTTP ${resp.status}`);

  const issues = await resp.json();
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error('run is not linked to any issue');
  }
  if (issues.length === 1) return issues[0].issueId;

  const open = issues.filter((i) => OPEN_STATUSES.includes(i.status));
  if (open.length === 1) return open[0].issueId;
  throw new Error(
    `run is linked to ${issues.length} issues (${open.length} open) — cannot pick one: ` +
      issues.map((i) => i.identifier ?? i.issueId).join(', '),
  );
}

export async function reportOutcome(env, { exitCode, stdout, stderr }, opts = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = sleep,
    delays = RETRY_DELAYS_MS,
  } = opts;

  const issueId = await resolveIssueId(env, { fetchImpl, sleepImpl, delays });

  let comment;
  let status;
  if (exitCode === 0) {
    const jsonLine = stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
    comment = jsonLine ?? 'Sync completed successfully';
    status = 'done';
  } else {
    const errSnippet = (stderr || stdout).trim().slice(0, 400);
    comment = `Sync failed (exit ${exitCode})${errSnippet ? ': ' + errSnippet : ''}`;
    status = 'blocked';
  }

  const resp = await fetchWithRetry(
    `${env.PAPERCLIP_API_URL}/api/issues/${issueId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.PAPERCLIP_API_KEY}`,
        'Content-Type': 'application/json',
        ...(env.PAPERCLIP_RUN_ID ? { 'X-Paperclip-Run-Id': env.PAPERCLIP_RUN_ID } : {}),
      },
      body: JSON.stringify({ status, comment }),
    },
    { fetchImpl, sleepImpl, delays },
  );
  if (!resp.ok) throw new Error(`PATCH issue ${issueId} failed: HTTP ${resp.status}`);
  return { issueId, status };
}
