import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(ROOT, ".strava-token.json");
let PORT;
let REDIRECT_URI;
const pendingStates = new Map();

async function loadEnvironment() {
  try {
    const contents = await readFile(join(ROOT, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readTokens() {
  try {
    return JSON.parse(await readFile(TOKEN_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveTokens(tokens) {
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function requireStravaConfig() {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    throw new Error("Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to your .env file first.");
  }
  return { clientId: STRAVA_CLIENT_ID, clientSecret: STRAVA_CLIENT_SECRET };
}

async function exchangeToken(parameters) {
  const { clientId, clientSecret } = requireStravaConfig();
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...parameters,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || result.errors?.[0]?.message || "Strava token request failed.");
  }
  return result;
}

async function getValidTokens() {
  const tokens = await readTokens();
  if (!tokens) return null;
  if (tokens.expires_at > Math.floor(Date.now() / 1000) + 60) return tokens;

  const refreshed = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  const updated = { ...tokens, ...refreshed };
  await saveTokens(updated);
  return updated;
}

async function getRuns(days) {
  const tokens = await getValidTokens();
  if (!tokens) return null;

  const after = Math.floor((Date.now() - (days + 6) * 24 * 60 * 60 * 1000) / 1000);
  const runs = [];
  for (let page = 1; ; page += 1) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities");
    url.searchParams.set("after", String(after));
    url.searchParams.set("per_page", "200");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const activities = await response.json();
    if (!response.ok) {
      throw new Error(
        activities.message || activities.errors?.[0]?.message || "Could not load activities from Strava.",
      );
    }

    for (const activity of activities) {
      if (activity.type !== "Run" && activity.type !== "TrailRun") continue;
      runs.push({
        date: String(activity.start_date_local || activity.start_date).slice(0, 10),
        distance: Number(activity.distance) || 0,
      });
    }
    if (activities.length < 200) break;
  }
  return runs;
}

function serveStatic(pathname, response) {
  const publicRoot = join(ROOT, "public");
  const requested = pathname === "/" ? "index.html" : pathname;
  const filePath = normalize(join(publicRoot, requested));
  if (!filePath.startsWith(`${publicRoot}/`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  readFile(filePath)
    .then((contents) => {
      response.writeHead(200, {
        "Content-Type": types[extname(filePath)] || "application/octet-stream",
      });
      response.end(contents);
    })
    .catch((error) => {
      if (error.code === "ENOENT" || error.code === "EISDIR") {
        sendJson(response, 404, { error: "Not found" });
      } else {
        sendJson(response, 500, { error: "Unable to read the requested file." });
      }
    });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/auth/strava") {
      const { clientId } = requireStravaConfig();
      const state = randomBytes(24).toString("hex");
      pendingStates.set(state, Date.now() + 10 * 60 * 1000);
      const authorization = new URL("https://www.strava.com/oauth/authorize");
      authorization.search = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        approval_prompt: "auto",
        scope: "activity:read_all",
        state,
      }).toString();
      response.writeHead(302, { Location: authorization.toString() });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      const state = url.searchParams.get("state");
      const expiry = state && pendingStates.get(state);
      if (!expiry || expiry < Date.now()) {
        if (state) pendingStates.delete(state);
        sendJson(response, 400, { error: "Authorization expired or could not be verified. Please try again." });
        return;
      }
      pendingStates.delete(state);
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        sendJson(response, 400, { error: `Strava authorization was ${oauthError}.` });
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        sendJson(response, 400, { error: "Strava did not return an authorization code." });
        return;
      }
      const tokens = await exchangeToken({ grant_type: "authorization_code", code });
      await saveTokens(tokens);
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      const tokens = await readTokens();
      sendJson(response, 200, {
        connected: Boolean(tokens),
        athlete: tokens?.athlete
          ? { firstname: tokens.athlete.firstname, lastname: tokens.athlete.lastname }
          : null,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runs") {
      const days = Number(url.searchParams.get("days") || 90);
      if (![30, 90, 180, 365].includes(days)) {
        sendJson(response, 400, { error: "Choose a range of 30, 90, 180, or 365 days." });
        return;
      }
      const runs = await getRuns(days);
      if (!runs) {
        sendJson(response, 401, { error: "Connect your Strava account to see your runs." });
        return;
      }
      sendJson(response, 200, { runs });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/")) {
      serveStatic(url.pathname, response);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "The request could not be completed." });
  }
});

await loadEnvironment();
PORT = Number(process.env.PORT || 3000);
REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
server.listen(PORT, () => {
  console.log(`Strava running dashboard ready at http://localhost:${PORT}`);
});
