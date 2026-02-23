/**
 * Extract a 32-character database ID from a Notion URL or ID string
 * @param {string} urlOrId - Notion URL, UUID-formatted ID, or bare 32-char hex ID
 * @returns {string|null} - The 32-character hex ID or null if not found
 */
export function extractDatabaseId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') {
    return null;
  }

  const input = urlOrId.trim();

  // Case 1: Already a 32-char hex string (no hyphens)
  if (/^[a-f0-9]{32}$/i.test(input)) {
    return input.toLowerCase();
  }

  // Case 2: UUID format with hyphens (8-4-4-4-12 pattern)
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input)) {
    return input.replace(/-/g, '').toLowerCase();
  }

  // Case 3: URL - extract 32-char hex ID from path
  // Notion URLs can be:
  // https://www.notion.so/workspace/Page-Title-{32hexchars}
  // https://www.notion.so/{32hexchars}
  // https://www.notion.so/workspace/Page-Title-{32hexchars}?v=...
  // Or with hyphens in UUID format in the URL

  // First, remove hyphens from any UUID-formatted segments in the URL
  const normalizedUrl = input.replace(/([a-f0-9]{8})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{4})-([a-f0-9]{12})/gi, '$1$2$3$4$5');

  // Now match 32-char hex string
  const match = normalizedUrl.match(/[a-f0-9]{32}/i);

  return match ? match[0].toLowerCase() : null;
}

/**
 * Check if a URL is a valid Notion URL with extractable database ID
 * @param {string} url - The URL to validate
 * @returns {boolean}
 */
export function isValidNotionUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Must contain notion.so domain
  if (!url.includes('notion.so')) {
    return false;
  }

  // Must have extractable database ID
  return extractDatabaseId(url) !== null;
}
