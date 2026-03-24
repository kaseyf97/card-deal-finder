// eBay OAuth token helper
// Uses "client credentials" grant to get an application token (no user login needed).
// Tokens last 2 hours — we cache and auto-refresh.

let cachedToken = null;
let expiresAt = 0;

export async function getToken() {
  // Return cached token if it's still valid (with 5 min buffer)
  if (cachedToken && Date.now() < expiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  // Base64 encode "AppID:CertID" for the Authorization header
  const credentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('eBay token error:', res.status, errText);
    throw new Error('Failed to get eBay token');
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is in seconds — convert to ms and add to current time
  expiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}
