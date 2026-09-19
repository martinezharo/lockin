// One-time helper: turn a Chrome Web Store OAuth client into the long-lived
// refresh token the release workflow needs. Everything stays on this machine;
// nothing is written to disk and nothing leaves the loopback interface.

import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, env } from 'node:process';

const PORT = 8080;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const rl = createInterface({ input: stdin, output: stdout });
const clientId = env.CWS_CLIENT_ID || await rl.question('Client ID: ');
const clientSecret = env.CWS_CLIENT_SECRET || await rl.question('Client secret: ');
rl.close();

if (!clientId.trim() || !clientSecret.trim()) {
  console.error('Both the client id and the client secret are required.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
authUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId.trim(),
  redirect_uri: REDIRECT,
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent'
}).toString();

console.log('\nOpen this URL, sign in as the publisher account and approve:\n');
console.log(authUrl.toString());
console.log('\nWaiting for the redirect on ' + REDIRECT + ' …');

const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, REDIRECT);
    const received = url.searchParams.get('code');
    const failure = url.searchParams.get('error');
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(received ? 'Authorization received. Return to the terminal.' : `Authorization failed: ${failure}`);
    server.close();
    received ? resolve(received) : reject(new Error(failure || 'no authorization code was returned'));
  });
  server.on('error', reject);
  server.listen(PORT, '127.0.0.1');
});

const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT
  })
});

const payload = await response.json();
if (!response.ok || !payload.refresh_token) {
  console.error('\nThe token exchange failed:');
  console.error(JSON.stringify({ ...payload, access_token: undefined }, null, 2));
  console.error('\nA missing refresh_token usually means the account already granted this client.');
  console.error('Revoke it at https://myaccount.google.com/permissions and run this again.');
  process.exit(1);
}

console.log('\nStore this as the CWS_REFRESH_TOKEN repository secret:\n');
console.log(payload.refresh_token);
console.log('\nIt does not expire while the OAuth consent screen stays in production.');
