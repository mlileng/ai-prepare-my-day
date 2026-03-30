import os from 'os';
import path from 'path';

// Config directory and file paths
export const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
export const CONFIG_FILE = 'config.json';

/**
 * Default configuration object with all expected fields
 * Partial setup is allowed (values can be null)
 */
export const DEFAULT_CONFIG = {
  meetingsDatabaseId: null,
  daysDatabaseId: null,
  icsUrl: null,
  userEmail: null,
  notionToken: null,
  suppressedMeetings: [],
  teamsWebhookUrl: null
};

/**
 * Validate a config object
 * @param {any} config - The config object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];

  // Check that config is an object
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  // Check that all required keys exist (but values can be null)
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
