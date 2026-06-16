import os from 'os';
import path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
export const CONFIG_FILE = 'config.json';

export const DEFAULT_CONFIG = {
  icsUrl: null,
  userEmail: null,
  teamsWebhookUrl: null,
  timezone: null,
  notionApiKey: null,
  notionMeetingsDatabaseId: null,
  notionDaysDatabaseId: null,
};

export function validateConfig(config) {
  const errors = [];

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  const requiredKeys = Object.keys(DEFAULT_CONFIG);
  for (const key of requiredKeys) {
    if (!(key in config)) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
