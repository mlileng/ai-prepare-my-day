import os from 'os';
import path from 'path';

// Keychain service name for storing credentials
export const SERVICE_NAME = 'prepare-my-day';

// Account keys for different credential types
export const ACCOUNTS = {
  NOTION_TOKEN: 'notion-integration-token'
};

// Config directory and file paths
export const CONFIG_DIR = path.join(os.homedir(), '.prepare-my-day');
export const CONFIG_FILE = 'config.json';
