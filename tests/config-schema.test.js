import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../src/config/schema.js';

test('DEFAULT_CONFIG has obsidianVaultPath and not Notion fields', () => {
  assert.ok('obsidianVaultPath' in DEFAULT_CONFIG);
  assert.ok(!('notionToken' in DEFAULT_CONFIG));
  assert.ok(!('meetingsDatabaseId' in DEFAULT_CONFIG));
  assert.ok(!('daysDatabaseId' in DEFAULT_CONFIG));
});

test('validateConfig passes for valid config', () => {
  const config = {
    obsidianVaultPath: '/some/path',
    icsUrl: null,
    userEmail: null,
    suppressedMeetings: [],
    teamsWebhookUrl: null,
  };
  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateConfig fails when obsidianVaultPath is missing', () => {
  const config = { icsUrl: null, userEmail: null, suppressedMeetings: [], teamsWebhookUrl: null };
  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('obsidianVaultPath')));
});
