import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
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
    serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Stride dashboard ready at http://localhost:${PORT}`);
});
