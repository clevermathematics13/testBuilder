#!/usr/bin/env node
require('dotenv').config();
/*
 * Run an Apps Script function from the terminal via Execution API.
 *
 * Usage:
 *   node scripts/gas_run_api.js <deploymentId> <functionName> [paramsJson]
 *   GAS_DEPLOYMENT_ID=<deploymentId> node scripts/gas_run_api.js <functionName> [paramsJson]
 *
 * Examples:
 *   node scripts/gas_run_api.js AKfy... apiHealthCheck
 *   node scripts/gas_run_api.js AKfy... runMSA_VR_One_ForWebApp '["1Q0j..."]'
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

function usageAndExit(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error(
    "Usage:\n" +
      "  node scripts/gas_run_api.js <deploymentId> <functionName> [paramsJson]\n" +
      "  GAS_DEPLOYMENT_ID=<deploymentId> node scripts/gas_run_api.js <functionName> [paramsJson]"
  );
  process.exit(1);
}

function isDeploymentId(s) {
  return typeof s === "string" && s.startsWith("AKfy");
}

function readClaspTokens() {
  const authFile = process.env.CLASP_AUTH_FILE || path.join(os.homedir(), ".clasprc.json");
  if (!fs.existsSync(authFile)) {
    throw new Error(`Auth file not found: ${authFile}`);
  }

  const data = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const tokenSet = data && data.tokens && data.tokens.default;
  if (!tokenSet || !tokenSet.client_id || !tokenSet.client_secret || !tokenSet.refresh_token) {
    throw new Error(`Invalid auth data in: ${authFile}`);
  }
  return tokenSet;
}

function httpsRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode || 0,
          text
        });
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function refreshAccessToken(tokens) {
  const body = new URLSearchParams({
    client_id: tokens.client_id,
    client_secret: tokens.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token"
  }).toString();

  const { statusCode, text } = await httpsRequest({
    method: "POST",
    url: "https://oauth2.googleapis.com/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Token refresh failed (${statusCode}): ${text}`);
  }

  const parsed = JSON.parse(text);
  if (!parsed.access_token) {
    throw new Error(`Token refresh response missing access_token: ${text}`);
  }
  return parsed.access_token;
}

async function runFunction({ deploymentId, functionName, parameters, devMode }) {
  const tokens = readClaspTokens();
  const accessToken = await refreshAccessToken(tokens);

  const requestBody = JSON.stringify({
    function: functionName,
    parameters,
    devMode
  });

  const { statusCode, text } = await httpsRequest({
    method: "POST",
    url: `https://script.googleapis.com/v1/scripts/${deploymentId}:run`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: requestBody
  });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Execution API returned non-JSON (${statusCode}): ${text}`);
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Execution API failed (${statusCode}): ${JSON.stringify(parsed, null, 2)}`);
  }

  if (parsed.error) {
    const message = parsed.error.message || "Unknown execution error";
    const details = parsed.error.details ? `\nDetails: ${JSON.stringify(parsed.error.details, null, 2)}` : "";
    throw new Error(`Script execution error: ${message}${details}`);
  }

  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) usageAndExit();

  let deploymentId = process.env.GAS_DEPLOYMENT_ID || "";
  let functionName = "";
  let paramsRaw = "[]";

  if (isDeploymentId(args[0])) {
    deploymentId = args[0];
    functionName = args[1];
    paramsRaw = args[2] || "[]";
  } else {
    functionName = args[0];
    paramsRaw = args[1] || "[]";
  }

  if (!deploymentId) usageAndExit("Missing deploymentId. Pass it as first arg or GAS_DEPLOYMENT_ID.");
  if (!functionName) usageAndExit("Missing functionName.");

  let parameters;
  try {
    parameters = JSON.parse(paramsRaw);
  } catch (e) {
    usageAndExit(`Invalid params JSON: ${paramsRaw}`);
  }
  if (!Array.isArray(parameters)) {
    usageAndExit("paramsJson must be a JSON array.");
  }

  const devMode = process.env.GAS_DEV_MODE === "true";
  const result = await runFunction({ deploymentId, functionName, parameters, devMode });

  if (result.response && Object.prototype.hasOwnProperty.call(result.response, "result")) {
    console.log(JSON.stringify(result.response.result, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
