/**
 * Notion API helpers for the daily page (days database).
 *
 * Provides four functions used by syncDailyPage to find, create,
 * and update the user's daily page in Notion:
 *   - findTodayPage: query days database by today's date
 *   - createTodayPage: create daily page with @Today title, Date property, Meetings section
 *   - hasMeetingsSection: detect existing Meetings H2 heading for re-run guard
 *   - prependMeetingsSection: insert Meetings H2 + to-do blocks above existing content
 *
 * Note: Uses dataSources.query() (NOT databases.query()) per @notionhq/client v5.9.0 API.
 *
 * @module daily/notion
 */

/**
 * Find today's daily page in the days database.
 *
 * Queries the days data source by the "Date" property with today's date
 * (YYYY-MM-DD format, date portion only). Per locked decision: query by
 * "Date" property using exact date match.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} daysDataSourceId - The data_source_id for the days database
 * @returns {Promise<import('@notionhq/client').PageObjectResponse|null>} The page, or null if not found
 */
export async function findTodayPage(client, daysDataSourceId) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const response = await client.dataSources.query({
    data_source_id: daysDataSourceId,
    filter: {
      property: 'Date',
      date: { equals: todayStr },
    },
    page_size: 1,
  });

  return response.results.find(r => r.object === 'page') ?? null;
}

/**
 * Create today's daily page in the days database.
 *
 * Per locked decision: page has @Today title (template_mention_date: 'today'),
 * Date property set to today's YYYY-MM-DD, and content containing an H2
 * "Meetings" heading followed by meeting to-do blocks.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} daysDataSourceId - The data_source_id for the days database
 * @param {Array<object>} meetingBlocks - Notion to_do block objects from buildMeetingBlocks
 * @returns {Promise<import('@notionhq/client').PageObjectResponse>} The created page object
 */
export async function createTodayPage(client, daysDataSourceId, meetingBlocks) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const page = await client.pages.create({
    parent: {
      type: 'data_source_id',
      data_source_id: daysDataSourceId,
    },
    properties: {
      title: {
        type: 'title',
        title: [
          {
            type: 'mention',
            mention: {
              type: 'template_mention',
              template_mention: {
                type: 'template_mention_date',
                template_mention_date: 'today',
              },
            },
          },
        ],
      },
      Date: {
        type: 'date',
        date: { start: todayStr },
      },
    },
    content: [
      {
        type: 'heading_2',
        heading_2: {
          rich_text: [
            { type: 'text', text: { content: 'Meetings' } },
          ],
        },
      },
      ...meetingBlocks,
    ],
  });

  return page;
}

/**
 * Check whether the daily page already has a "Meetings" H2 heading.
 *
 * Scans the first 10 blocks of the page (Meetings is always prepended
 * so it will be near the top). Guards against PartialBlockObjectResponse
 * by checking block.type before accessing block.heading_2.
 *
 * Per locked decision: re-run detection by H2 "Meetings" heading presence.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} pageId - The Notion page ID to inspect
 * @returns {Promise<boolean>} True if a "Meetings" H2 exists
 */
export async function hasMeetingsSection(client, pageId) {
  const response = await client.blocks.children.list({
    block_id: pageId,
    page_size: 10,
  });

  return response.results.some(block => {
    if (!block.type) return false;
    if (block.type !== 'heading_2') return false;
    const richText = block.heading_2?.rich_text ?? [];
    const plainText = richText.map(t => t.plain_text ?? '').join('').trim();
    return plainText === 'Meetings';
  });
}

/**
 * Prepend a Meetings H2 heading and meeting to-do blocks above existing page content.
 *
 * Per locked decision: Meetings section always prepended at top of page,
 * H2 heading, no divider. Uses position: { type: 'start' } to insert
 * above all existing blocks.
 *
 * @param {import('@notionhq/client').Client} client - Authenticated Notion client
 * @param {string} pageId - The Notion page ID to update
 * @param {Array<object>} meetingBlocks - Notion to_do block objects from buildMeetingBlocks
 * @returns {Promise<void>}
 */
export async function prependMeetingsSection(client, pageId, meetingBlocks) {
  await client.blocks.children.append({
    block_id: pageId,
    children: [
      {
        type: 'heading_2',
        heading_2: {
          rich_text: [
            { type: 'text', text: { content: 'Meetings' } },
          ],
        },
      },
      ...meetingBlocks,
    ],
    position: { type: 'start' },
  });
}
