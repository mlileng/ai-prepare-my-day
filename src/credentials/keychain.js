import { createRequire } from 'module';
import { SERVICE_NAME } from './constants.js';

// Import CommonJS keychain package
const require = createRequire(import.meta.url);
const keychain = require('keychain');

/**
 * Store a secret in the macOS Keychain
 * @param {string} account - The account key (e.g., ACCOUNTS.AZURE_OAUTH)
 * @param {any} value - The value to store (will be JSON-stringified)
 * @returns {Promise<void>}
 */
export async function setSecret(account, value) {
  return new Promise((resolve, reject) => {
    const stringValue = JSON.stringify(value);
    keychain.setPassword(
      { account, service: SERVICE_NAME, password: stringValue },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Retrieve a secret from the macOS Keychain
 * @param {string} account - The account key to retrieve
 * @returns {Promise<any|null>} The stored value (JSON-parsed), or null if not found
 */
export async function getSecret(account) {
  return new Promise((resolve, reject) => {
    keychain.getPassword(
      { account, service: SERVICE_NAME },
      (err, password) => {
        if (err) {
          // "Could not find password" is not an error - just means no secret stored yet
          if (err.message && err.message.includes('Could not find')) {
            resolve(null);
          } else {
            reject(err);
          }
        } else {
          try {
            resolve(JSON.parse(password));
          } catch (parseErr) {
            reject(new Error(`Failed to parse stored secret for ${account}: ${parseErr.message}`));
          }
        }
      }
    );
  });
}

/**
 * Delete a secret from the macOS Keychain
 * @param {string} account - The account key to delete
 * @returns {Promise<void>}
 */
export async function deleteSecret(account) {
  return new Promise((resolve, reject) => {
    keychain.deletePassword(
      { account, service: SERVICE_NAME },
      (err) => {
        // Silently succeed if secret doesn't exist
        if (err && err.message && err.message.includes('Could not find')) {
          resolve();
        } else if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}
