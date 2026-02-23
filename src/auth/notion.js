import { Client, APIErrorCode, isNotionClientError } from '@notionhq/client';
import { extractDatabaseId } from '../utils/validation.js';

/**
 * Create a Notion API client
 * @param {string} token - Notion integration token
 * @returns {Client}
 */
export function createNotionClient(token) {
  return new Client({ auth: token });
}

/**
 * Validate a Notion integration token
 * @param {string} token - The integration token to validate
 * @returns {Promise<{valid: boolean, botName?: string, error?: string}>}
 */
export async function validateNotionToken(token) {
  try {
    const client = createNotionClient(token);
    const response = await client.users.me({});

    return {
      valid: true,
      botName: response.name
    };
  } catch (err) {
    if (isNotionClientError(err) && err.code === APIErrorCode.Unauthorized) {
      return {
        valid: false,
        error: 'Invalid integration token'
      };
    }

    return {
      valid: false,
      error: err.message
    };
  }
}

/**
 * Validate access to a Notion database
 * @param {Client} client - The Notion client instance
 * @param {string} databaseId - The database ID to validate
 * @param {string} label - Label for error messages ('meetings' or 'days')
 * @returns {Promise<{valid: boolean, title?: string, error?: string}>}
 */
export async function validateDatabase(client, databaseId, label) {
  try {
    const response = await client.databases.retrieve({ database_id: databaseId });

    return {
      valid: true,
      title: response.title[0]?.plain_text || 'Untitled'
    };
  } catch (err) {
    if (isNotionClientError(err)) {
      if (err.code === APIErrorCode.ObjectNotFound) {
        return {
          valid: false,
          error: `Notion: ${label} database not found. Make sure you've shared the database with your integration, then check the URL in ~/.prepare-my-day/config.json`
        };
      }

      if (err.code === APIErrorCode.Unauthorized) {
        return {
          valid: false,
          error: 'Notion: integration token invalid. Run: prepare-my-day setup'
        };
      }
    }

    return {
      valid: false,
      error: `Notion API error: ${err.message}`
    };
  }
}
