import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE } from './schema.js';
import { DEFAULT_CONFIG, validateConfig } from './schema.js';

/**
 * Get the full path to the config file
 * @returns {string}
 */
export function getConfigPath() {
  return path.join(CONFIG_DIR, CONFIG_FILE);
}

/**
 * Ensure the config directory exists
 * @returns {Promise<void>}
 */
export async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Load the configuration file
 * @returns {Promise<object>} The configuration object
 * @throws {Error} With user-friendly message if file not found or has invalid JSON
 */
export async function loadConfig() {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Merge with defaults to ensure new fields get default values
    return { ...DEFAULT_CONFIG, ...config };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('Config file not found. Run: prepare-my-day setup');
    } else if (err instanceof SyntaxError) {
      throw new Error(`Config file has invalid JSON syntax at ${configPath}. Fix the syntax or delete the file and run setup again.`);
    }
    // Re-throw any other unexpected errors
    throw err;
  }
}

/**
 * Save configuration to file
 * @param {object} config - The configuration object to save
 * @returns {Promise<void>}
 * @throws {Error} If config validation fails
 */
export async function saveConfig(config) {
  // Validate config
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config: ${validation.errors.join(', ')}`);
  }

  // Ensure directory exists
  await ensureConfigDir();

  // Write config file
  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Update configuration with partial values
 * @param {object} updates - Partial configuration object with fields to update
 * @returns {Promise<void>}
 */
export async function updateConfig(updates) {
  // Try to load existing config, or use defaults if not found
  let existingConfig;
  try {
    existingConfig = await loadConfig();
  } catch (err) {
    if (err.message.includes('Config file not found')) {
      existingConfig = { ...DEFAULT_CONFIG };
    } else {
      throw err;
    }
  }

  // Merge updates
  const updatedConfig = { ...existingConfig, ...updates };

  // Save merged config
  await saveConfig(updatedConfig);
}
