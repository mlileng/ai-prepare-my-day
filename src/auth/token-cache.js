import fs from 'fs/promises';
import { MSAL_CACHE_FILE } from '../credentials/constants.js';
import { ensureConfigDir } from '../config/manager.js';

/**
 * Create an MSAL ICachePlugin for file-based token persistence
 * @param {string} cachePath - Path to the cache file (defaults to MSAL_CACHE_FILE)
 * @returns {object} Cache plugin object with beforeCacheAccess and afterCacheAccess callbacks
 */
export function createCachePlugin(cachePath = MSAL_CACHE_FILE) {
  return {
    async beforeCacheAccess(cacheContext) {
      try {
        const cacheData = await fs.readFile(cachePath, 'utf-8');
        cacheContext.tokenCache.deserialize(cacheData);
      } catch (err) {
        // ENOENT on first run is expected - cache doesn't exist yet
        if (err.code !== 'ENOENT') {
          console.error('Error reading token cache:', err);
        }
      }
    },

    async afterCacheAccess(cacheContext) {
      if (cacheContext.cacheHasChanged) {
        try {
          // Ensure config directory exists before writing
          await ensureConfigDir();
          const cacheData = cacheContext.tokenCache.serialize();
          await fs.writeFile(cachePath, cacheData, 'utf-8');
        } catch (err) {
          console.error('Error writing token cache:', err);
        }
      }
    }
  };
}
