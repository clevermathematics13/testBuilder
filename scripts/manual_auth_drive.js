#!/usr/bin/env node
/**
 * Manual OAuth flow to get a refresh token with full Drive scope
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Read OAuth credentials
const credsPath = path.join(__dirname, '..', 'clasp-oauth.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')).installed;

// Full scopes including drive, documents, spreadsheets, etc.
const SCOPES = [
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.webapp.deploy',
  'https://www.googleapis.com/auth/drive',  // FULL DRIVE SCOPE
  'https://www.googleapis.com/auth/documents',  // DOCUMENTS
  'https://www.googleapis.com/auth/spreadsheets',  // SPREADSHEETS
  'https://www.googleapis.com/auth/presentations',  // PRESENTATIONS
  'https://www.googleapis.com/auth/forms',  // FORMS
  'https://www.googleapis.com/auth/forms.body',  // FORMS BODY
  'https://www.googleapis.com/auth/script.external_request',  // EXTERNAL REQUESTS
  'https://www.googleapis.com/auth/service.management',
  'https://www.googleapis.com/auth/logging.read',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform'
].join(' ');

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}`;

function httpsRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString();

  const { statusCode, text } = await httpsRequest({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (statusCode !== 200) {
    throw new Error(`Token exchange failed (${statusCode}): ${text}`);
  }

  return JSON.parse(text);
}

async function main() {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', creds.client_id);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\n🔑 Authorize with FULL DRIVE scope by visiting:\n');
  console.log(authUrl.toString());
  console.log('\n');

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const code = reqUrl.searchParams.get('code');

    if (!code) {
      res.writeHead(400);
      res.end('No code received');
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      
      // Update .clasprc.json
      const clasprcPath = path.join(os.homedir(), '.clasprc.json');
      const clasprc = JSON.parse(fs.readFileSync(clasprcPath, 'utf8'));
      clasprc.tokens.default = {
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        type: 'authorized_user',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token
      };
      fs.writeFileSync(clasprcPath, JSON.stringify(clasprc, null, 2));

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>✅ Authorization successful!</h1><p>You can close this window and return to VS Code.</p>');
      
      console.log('\n✅ Successfully updated ~/.clasprc.json with full Drive scope!');
      console.log('\nYou can now run: npm run test:grade\n');
      
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    } catch (err) {
      res.writeHead(500);
      res.end(`Error: ${err.message}`);
      console.error(err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for authorization callback on http://localhost:${PORT}...`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
