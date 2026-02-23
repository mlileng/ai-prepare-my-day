/**
 * Notion API helpers for the meetings database.
 *
 * Provides four functions used by the reconciler to interact with
 * the user's Notion meetings database:
 *   - resolveDataSourceId: get the data_source_id from a meetings database_id
 *   - fetchAllMeetingPages: paginate all pages from a data source
 *   - getPageTitle: extract plain-text title from a Notion page object
 *   - createMeetingPage: create a new title-only meeting page
 *
 * Note: Uses dataSources.query() (NOT databases.query()) per @notionhq/client v5.9.0 API.
 */

/**
 * Resolve a Notion data_source_id from a meetings database_id.
 *
 * Uses databases.retrieve() to fetch the database object, then reads
 * the first data_source_id from database.data_sources. Both PartialDatabaseObjectResponse
 * and missing data_sources are guarded against with actionable error messages.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} meetingsDatabaseId - UUID of the meetings database
 * @returns {Promise<string>} The first data_source_id
 * @throws {Error} If database lacks data_sources or integration lacks full access
 */
export async function resolveDataSourceId(client, meetingsDatabaseId) {
  const database = await client.databases.retrieve({ database_id: meetingsDatabaseId });

  // PartialDatabaseObjectResponse doesn't include data_sources
  if (database.object !== 'database') {
    throw new Error(
      'Cannot access meetings database data sources. Ensure the Notion integration has full access to the database and the database ID in ~/.prepare-my-day/config.json is correct.'
    );
  }

  if (!database.data_sources?.length > 0) {
    throw new Error(
      'Cannot access meetings database data sources. Ensure the Notion integration has full access to the database and the database ID in ~/.prepare-my-day/config.json is correct.'
    );
  }

  return database.data_sources[0].id;
}

/**
 * Fetch all pages from a Notion data source via cursor-based pagination.
 *
 * Uses dataSources.query() (NOT databases.query()) per @notionhq/client v5.9.0.
 * Iterates through all pages until has_more is false.
 * Only collects results where result.object === 'page'.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} dataSourceId - The data_source_id from resolveDataSourceId
 * @returns {Promise<Array<import('@notionhq/client').PageObjectResponse>>}
 */
export async function fetchAllMeetingPages(client, dataSourceId) {
  const pages = [];
  let cursor = undefined;

  do {
    const response = await client.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object === 'page') {
        pages.push(result);
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor !== undefined);

  return pages;
}

/**
 * Extract the plain-text title from a Notion page object.
 *
 * Searches for the property with type === 'title', regardless of its key name.
 * Returns empty string if no title property is found or the title array is empty.
 *
 * @param {{ properties: Record<string, { type: string, title?: Array<{ plain_text: string }> }> }} page
 * @returns {string}
 */
export function getPageTitle(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === 'title');
  if (!titleProp || !titleProp.title || titleProp.title.length === 0) return '';
  return titleProp.title.map(t => t.plain_text).join('');
}

/**
 * Create a new meeting page in Notion with a title only (no body content).
 *
 * Per locked decision: title-only pages, no template content, no children.
 * Logs the creation to console: "Created: {title}".
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} dataSourceId - The data_source_id from resolveDataSourceId
 * @param {string} title - The meeting title for the new page
 * @returns {Promise<import('@notionhq/client').PageObjectResponse>} The created page object
 */
export async function createMeetingPage(client, dataSourceId, title) {
  const page = await client.pages.create({
    parent: {
      type: 'data_source_id',
      data_source_id: dataSourceId,
    },
    properties: {
      title: {
        type: 'title',
        title: [
          {
            type: 'text',
            text: { content: title },
          },
        ],
      },
    },
  });

  console.log(`Created: ${title}`);
  return page;
}
