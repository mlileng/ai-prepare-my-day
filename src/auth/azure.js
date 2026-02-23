import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import open from 'open';
import { createCachePlugin } from './token-cache.js';
import { MSAL_CACHE_FILE, ACCOUNTS } from '../credentials/constants.js';
import { setSecret } from '../credentials/keychain.js';

// Azure AD OAuth configuration
const SCOPES = ['https://graph.microsoft.com/Calendars.Read'];
const REDIRECT_URI = 'http://localhost';

/**
 * Create an MSAL PublicClientApplication with file-based token cache
 * @param {string} clientId - Azure AD application (client) ID
 * @param {string} tenantId - Azure AD directory (tenant) ID
 * @returns {PublicClientApplication}
 */
export function createMsalApp(clientId, tenantId) {
  const config = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`
    },
    cache: {
      cachePlugin: createCachePlugin(MSAL_CACHE_FILE)
    }
  };

  return new PublicClientApplication(config);
}

/**
 * Authenticate interactively using browser-based OAuth flow
 * @param {PublicClientApplication} msalApp - The MSAL application instance
 * @returns {Promise<{accessToken: string, account: object}>}
 */
export async function authenticateInteractive(msalApp) {
  const authResult = await msalApp.acquireTokenInteractive({
    scopes: SCOPES,
    openBrowser: async (url) => {
      await open(url);
    },
    successTemplate: `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #10b981;
              margin: 0 0 1rem 0;
              font-size: 2rem;
            }
            p {
              color: #6b7280;
              margin: 0;
              font-size: 1.125rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Successfully signed in!</h1>
            <p>You can close this window.</p>
          </div>
        </body>
      </html>
    `,
    errorTemplate: `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #ef4444;
              margin: 0 0 1rem 0;
              font-size: 2rem;
            }
            p {
              color: #6b7280;
              margin: 0;
              font-size: 1.125rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Authentication failed</h1>
            <p>{{error}}</p>
          </div>
        </body>
      </html>
    `
  });

  // Store the account homeAccountId for future silent auth
  if (authResult.account) {
    await setSecret(ACCOUNTS.AZURE_OAUTH, {
      homeAccountId: authResult.account.homeAccountId,
      username: authResult.account.username
    });
  }

  return {
    accessToken: authResult.accessToken,
    account: authResult.account
  };
}

/**
 * Acquire token silently using cached tokens (no user interaction)
 * @param {PublicClientApplication} msalApp - The MSAL application instance
 * @returns {Promise<{accessToken: string, account: object}>}
 * @throws {Error} If no account found or interaction is required
 */
export async function acquireTokenSilent(msalApp) {
  // Get all accounts from token cache
  const accounts = await msalApp.getTokenCache().getAllAccounts();

  if (accounts.length === 0) {
    throw new Error('No Azure AD account found. Run: prepare-my-day setup');
  }

  try {
    const authResult = await msalApp.acquireTokenSilent({
      account: accounts[0],
      scopes: SCOPES
    });

    return {
      accessToken: authResult.accessToken,
      account: authResult.account
    };
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      throw new Error('Outlook auth expired. Run: prepare-my-day setup');
    }
    throw err;
  }
}

/**
 * Get the cached account without acquiring a token
 * @param {PublicClientApplication} msalApp - The MSAL application instance
 * @returns {Promise<object|null>} The account object or null if not found
 */
export async function getAccount(msalApp) {
  const accounts = await msalApp.getTokenCache().getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}
