import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { Socket } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleMcpBody } from "@vibesvg/mcp";
import type { ProjectStore } from "./project-store.js";
import { WebSocketHub } from "./websocket.js";

export type HostServer = {
  close(): void;
  server: Server;
};

export type HostServerOptions = {
  host: string;
  mcpUrl: string;
  port: string;
  store: ProjectStore;
  webDirectory?: string;
};

export function startHostServer(options: HostServerOptions): HostServer {
  const websocketHub = new WebSocketHub(options.store);
  const app = createHostApp(options);
  const server = createServer(async (request, response) => {
    try {
      if (options.webDirectory && shouldServeWebAsset(request)) {
        const served = await serveWebAsset(options.webDirectory, request, response);

        if (served) {
          return;
        }
      }

      const fetchRequest = await nodeRequestToFetchRequest(request);
      const fetchResponse = await app.fetch(fetchRequest);
      await writeFetchResponse(response, fetchResponse);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    }
  });

  server.on("upgrade", (request, socket) => {
    websocketHub.handleUpgrade(request, socket as Socket);
  });

  server.listen(Number(options.port), options.host);

  return {
    close() {
      websocketHub.close();
      server.close();
    },
    server
  };
}

function createHostApp(options: HostServerOptions): Hono {
  const app = new Hono();

  app.use("/mcp", cors());

  app.get("/health", (context) => {
    return context.json({
      ok: true,
      server: "vibesvg-cli",
      mcpUrl: options.mcpUrl,
      projectFile: options.store.projectFile
    });
  });

  app.get("/project", (context) => {
    return context.json({
      hostWebSocketUrl: websocketUrl(context.req.raw.url, options.host, options.port),
      project: options.store.readProject(),
      revision: options.store.revision()
    });
  });

  app.options("/mcp", (context) => {
    return context.body(null, 204);
  });

  app.post("/mcp", async (context) => {
    const body = await context.req.json();
    const result = await handleMcpBody({ store: options.store }, body);

    if (!result) {
      return context.json({}, 202);
    }

    return context.json(result);
  });

  app.notFound((context) => {
    return context.json({ ok: false, error: "Not found." }, 404);
  });

  return app;
}

function shouldServeWebAsset(request: IncomingMessage): boolean {
  const method = request.method ?? "GET";

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  return !pathname.startsWith("/mcp") && pathname !== "/health" && pathname !== "/project" && pathname !== "/ws";
}

async function serveWebAsset(webDirectory: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedWebDirectory = resolve(webDirectory);
  const candidatePath = resolve(resolvedWebDirectory, normalize(requestedPath));

  if (!candidatePath.startsWith(`${resolvedWebDirectory}${sep}`) && candidatePath !== resolvedWebDirectory) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }

  const filePath = await webFilePath(candidatePath, resolvedWebDirectory);

  if (!filePath) {
    return false;
  }

  const headers: Record<string, string> = {
    "content-type": contentTypeForPath(filePath)
  };

  const fileStat = await stat(filePath);
  headers["content-length"] = String(fileStat.size);

  if (request.method === "HEAD") {
    response.writeHead(200, headers);
    response.end();
    return true;
  }

  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
  return true;
}

async function webFilePath(candidatePath: string, webDirectory: string): Promise<string | undefined> {
  if (existsSync(candidatePath) && (await stat(candidatePath)).isFile()) {
    return candidatePath;
  }

  const indexPath = join(webDirectory, "index.html");
  return existsSync(indexPath) ? indexPath : undefined;
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function websocketUrl(rawUrl: string, host: string, port: string): string {
  const url = new URL(rawUrl);
  const hostname = host === "0.0.0.0" ? "localhost" : url.hostname;
  return `ws://${hostname}:${port}/ws`;
}

async function nodeRequestToFetchRequest(request: IncomingMessage): Promise<Request> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = request.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url, {
    method,
    headers,
    body: hasBody ? (await readRequestBody(request)).toString("utf8") : undefined
  });
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
    });

    request.on("end", () => {
      resolveBody(Buffer.concat(chunks));
    });

    request.on("error", rejectBody);
  });
}

async function writeFetchResponse(response: ServerResponse, fetchResponse: Response): Promise<void> {
  response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()));
  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}
