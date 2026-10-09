import { createServer } from "node:http";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const devClients = new Set();

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function serveDevEvents(request, response) {
  if (process.env.STRIDE_DEV !== "1") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
  devClients.add(response);
  request.on("close", () => devClients.delete(response));
}

function notifyDevClients() {
  for (const client of devClients) client.write("event: reload\ndata: {}\n\n");
}

function serveStatic(pathname, response) {
  const publicRoot = join(ROOT, "public");
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid path" });
    return;
  }
  const requested = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
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
  if (request.method === "GET" && url.pathname.startsWith("/")) {
    if (url.pathname === "/__dev/status") {
      sendJson(response, 200, { enabled: process.env.STRIDE_DEV === "1" });
      return;
    }
    if (url.pathname === "/__dev/events") {
      serveDevEvents(request, response);
      return;
    }
    serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Stride dashboard ready at http://localhost:${PORT}`);
});

if (process.env.STRIDE_DEV === "1") {
  let reloadTimer;
  const publicWatcher = watch(join(ROOT, "public"), { recursive: true }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(notifyDevClients, 100);
  });
  publicWatcher.on("error", (error) => {
    console.error("Development file watcher failed:", error);
  });

  const keepAlive = setInterval(() => {
    for (const client of devClients) client.write(": keep-alive\n\n");
  }, 15_000);
  server.on("close", () => {
    clearInterval(keepAlive);
    publicWatcher.close();
  });
}
