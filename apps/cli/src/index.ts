#!/usr/bin/env node
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer as createNetServer } from "node:net";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isVibeSVGProject, type VibeSVGProject } from "@vibesvg/ast";
import { mcpTools } from "@vibesvg/mcp";
import { exportToSvg } from "@vibesvg/svg";
import { ProjectStore } from "./project-store.js";
import { startHostServer } from "./server.js";

const DEFAULT_PORT = "6201";
const DEFAULT_HOST_PORT = "6202";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PUBLIC_HOST = "localhost";
const DEV_BIND_HOST = "0.0.0.0";
const DEV_PUBLIC_HOST = "localhost";
const cliDirectory = fileURLToPath(new URL(".", import.meta.url));
const packagedWebDirectory = resolve(cliDirectory, "../web");

type CliCommand = "host" | "init" | "open";

type CliOptions = {
  command: CliCommand;
  example?: string;
  help: boolean;
  port?: string;
  portFixed: boolean;
  projectFile?: string;
};

type ExportOptions = {
  clean: boolean;
  example?: string;
  help: boolean;
  out?: string;
  projectFile?: string;
};

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs[0] === "mcp") {
    await handleMcpCommand(rawArgs.slice(1));
    return;
  }

  if (rawArgs[0] === "skills") {
    await handleSkillsCommand(rawArgs.slice(1));
    return;
  }

  if (rawArgs[0] === "export") {
    await handleExportCommand(rawArgs.slice(1));
    return;
  }

  const options = parseArgs(rawArgs);

  if (options.help) {
    printHelp();
    return;
  }

  const projectFile = resolveProjectFile(options);

  if (options.command === "init") {
    const store = new ProjectStore(projectFile);
    store.close();
    console.log(`✓ Project created at ${projectFile}`);
    return;
  }

  if (options.command === "host") {
    const requestedHostPort = options.port ?? DEFAULT_HOST_PORT;
    const hostPort = await requireAvailablePort(requestedHostPort, new Set(), DEV_BIND_HOST);
    const store = new ProjectStore(projectFile);
    const mcpUrl = `http://${DEV_PUBLIC_HOST}:${hostPort}/mcp`;
    const hostServer = startHostServer({
      host: DEV_BIND_HOST,
      mcpUrl,
      port: hostPort,
      store
    });

    console.log(`✓ Project: ${projectFile}`);
    if (hostPort !== requestedHostPort) {
      console.log(`✓ Host port ${requestedHostPort} is unavailable, using ${hostPort}`);
    }
    console.log(`✓ Host running on ws://${DEV_PUBLIC_HOST}:${hostPort}/ws`);
    console.log(`✓ MCP running on ${mcpUrl}`);

    const shutdownHost = () => {
      hostServer.close();
      store.close();
    };

    process.once("SIGINT", shutdownHost);
    process.once("SIGTERM", shutdownHost);
    return;
  }

  const requestedPort = options.port ?? DEFAULT_PORT;
  const packagedWeb = packagedWebDirectoryExists();
  const port = options.portFixed
    ? await requireAvailablePort(requestedPort)
    : await findAvailablePort(requestedPort);
  const requestedHostPort = packagedWeb ? port : nextPort(port);
  const hostPort = packagedWeb
    ? port
    : options.portFixed
      ? await requireAvailablePort(requestedHostPort, new Set([port]))
      : await findAvailablePort(requestedHostPort, new Set([port]));
  const store = new ProjectStore(projectFile);
  const mcpUrl = `http://${DEFAULT_HOST}:${hostPort}/mcp`;
  const hostServer = startHostServer({
    host: DEFAULT_HOST,
    mcpUrl,
    port: hostPort,
    store,
    webDirectory: packagedWeb ? packagedWebDirectory : undefined
  });

  console.log(`✓ Project: ${projectFile}`);
  if (port !== requestedPort) {
    console.log(`✓ UI port ${requestedPort} is unavailable, using ${port}`);
  }
  if (hostPort !== requestedHostPort) {
    console.log(`✓ Host port ${requestedHostPort} is unavailable, using ${hostPort}`);
  }
  const uiUrl = `http://${DEFAULT_PUBLIC_HOST}:${port}/`;
  console.log(`✓ UI running on ${terminalLink(uiUrl)}`);
  console.log(`✓ Host running on ws://${DEFAULT_HOST}:${hostPort}/ws`);
  console.log(`✓ MCP running on ${mcpUrl}`);

  if (packagedWeb) {
    return;
  }

  const child = spawn("pnpm", ["--filter", "web", "dev", "--host", DEFAULT_HOST], {
    cwd: resolve(cliDirectory, "../../.."),
    env: {
      ...process.env,
      VIBESVG_HOST_WS_URL: `ws://${DEFAULT_HOST}:${hostPort}/ws`,
      VITE_VIBESVG_HOST_WS_URL: `ws://${DEFAULT_HOST}:${hostPort}/ws`,
      VIBESVG_PROJECT_FILE: projectFile,
      PORT: port
    },
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
    hostServer.close();
    store.close();
  });

  const shutdown = () => {
    child.kill("SIGTERM");
    hostServer.close();
    store.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function packagedWebDirectoryExists(): boolean {
  return existsSync(resolve(packagedWebDirectory, "index.html"));
}

function terminalLink(url: string, label = url): string {
  if (!process.stdout.isTTY || process.env.CI) {
    return label;
  }

  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

async function findAvailablePort(startPort: string, reservedPorts = new Set<string>(), host = DEFAULT_HOST): Promise<string> {
  let port = Number(startPort);

  while (port <= 65535) {
    const portText = String(port);

    if (!reservedPorts.has(portText) && (await isPortAvailable(port, host))) {
      return portText;
    }

    port += 1;
  }

  throw new Error(`No available port found from ${startPort}.`);
}

async function requireAvailablePort(port: string, reservedPorts = new Set<string>(), host = DEFAULT_HOST): Promise<string> {
  if (reservedPorts.has(port) || !(await isPortAvailable(Number(port), host))) {
    throw new Error(`Port ${port} is unavailable.`);
  }

  return port;
}

function isPortAvailable(port: number, host = DEFAULT_HOST): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const probe = createNetServer();

    probe.once("error", () => {
      resolveAvailable(false);
    });

    probe.once("listening", () => {
      probe.close(() => {
        resolveAvailable(true);
      });
    });

    probe.listen(port, host);
  });
}

function resolveProjectFile(options: Pick<CliOptions, "example" | "projectFile">): string {
  if (options.example && options.projectFile) {
    throw new Error("--example cannot be used with a project path.");
  }

  if (options.example) {
    return resolveExampleProjectFile(options.example);
  }

  const rawPath = options.projectFile ?? "vibesvg.vsvg.json";
  const trimmedPath = rawPath.replace(/[\\/]+$/, "");
  const filePath = /\.vsvg\.json$/i.test(trimmedPath) ? trimmedPath : `${trimmedPath}.vsvg.json`;

  return resolve(process.cwd(), filePath);
}

function resolveExampleProjectFile(exampleName: string): string {
  const normalizedName = exampleName.trim().replace(/\.vsvg\.json$/i, "");

  if (!/^[\w-]+$/.test(normalizedName)) {
    throw new Error(`Invalid example name: ${exampleName}`);
  }

  return resolve(cliDirectory, "../../..", "examples", `${normalizedName}.vsvg.json`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: "open",
    example: undefined,
    help: false,
    port: undefined,
    portFixed: false,
    projectFile: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if ((arg === "host" || arg === "init") && options.command === "open" && options.projectFile === undefined) {
      options.command = arg;
      continue;
    }

    if (arg === "--port") {
      const value = args[index + 1];

      if (!value || value.startsWith("-")) {
        throw new Error("--port requires a value.");
      }

      options.port = parsePort(value);
      options.portFixed = true;
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      options.portFixed = true;
      continue;
    }

    if (arg === "--example") {
      const value = args[index + 1];

      if (!value || value.startsWith("-")) {
        throw new Error("--example requires a value.");
      }

      options.example = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--example=")) {
      options.example = arg.slice("--example=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.projectFile !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    options.projectFile = arg;
  }

  return options;
}

async function handleExportCommand(args: string[]): Promise<void> {
  const options = parseExportArgs(args);

  if (options.help) {
    printExportHelp();
    return;
  }

  const projectFile = resolveProjectFile(options);
  const project = await readProject(projectFile);
  const outDir = resolve(process.cwd(), options.out ?? `${projectFileStem(projectFile)}-svg`);
  const usedNames = new Map<string, number>();

  if (options.clean) {
    await rm(outDir, { recursive: true, force: true });
  }

  await mkdir(outDir, { recursive: true });

  for (const page of project.pages) {
    const basename = uniqueExportFilename(fileSafeName(page.name || page.id), usedNames);
    await writeFile(resolve(outDir, `${basename}.svg`), exportToSvg(page.document), "utf8");
  }

  console.log(`✓ Exported ${project.pages.length} SVG file${project.pages.length === 1 ? "" : "s"} to ${outDir}`);
}

function parseExportArgs(args: string[]): ExportOptions {
  const options: ExportOptions = {
    clean: false,
    example: undefined,
    help: false,
    out: undefined,
    projectFile: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--clean") {
      options.clean = true;
      continue;
    }

    if (arg === "--out") {
      const value = args[index + 1];

      if (!value || value.startsWith("-")) {
        throw new Error("--out requires a value.");
      }

      options.out = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--example") {
      const value = args[index + 1];

      if (!value || value.startsWith("-")) {
        throw new Error("--example requires a value.");
      }

      options.example = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--example=")) {
      options.example = arg.slice("--example=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown export option: ${arg}`);
    }

    if (options.projectFile !== undefined) {
      throw new Error(`Unexpected export argument: ${arg}`);
    }

    options.projectFile = arg;
  }

  return options;
}

async function readProject(projectFile: string): Promise<VibeSVGProject> {
  const project = JSON.parse(await readFile(projectFile, "utf8")) as unknown;

  if (!isVibeSVGProject(project)) {
    throw new Error(`Invalid VibeSVG project: ${projectFile}`);
  }

  return project;
}

function projectFileStem(projectFile: string): string {
  return basename(projectFile).replace(/\.vsvg\.json$/i, "") || "vibesvg-project";
}

function fileSafeName(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "vibesvg";
}

function uniqueExportFilename(basename: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(basename) ?? 0;
  usedNames.set(basename, count + 1);

  return count === 0 ? basename : `${basename}-${count + 1}`;
}

async function handleMcpCommand(args: string[]): Promise<void> {
  const [action, target] = args;

  if (!action || action === "-h" || action === "--help") {
    console.log(`Usage:
  vibesvg mcp install <codex|claude> --url <mcp-url> [--project <project-dir>]`);
    return;
  }

  if (action !== "install") {
    throw new Error(`Unknown mcp command: ${action}`);
  }

  const url = optionValue(args, "--url");

  if (!url) {
    throw new Error("Missing MCP URL. Usage: vibesvg mcp install <codex|claude> --url <mcp-url>");
  }

  if (target === "codex") {
    const path = await installCodexMcpConfig(url);
    console.log(`Codex MCP configured for VibeSVG (${path})`);
    return;
  }

  if (target === "claude") {
    const projectPath = optionValue(args, "--project");
    const path = await installClaudeMcpConfig(url, projectPath ? resolve(process.cwd(), projectPath) : undefined);
    console.log(`Claude Code MCP configured for VibeSVG (${path})`);
    return;
  }

  throw new Error("Missing MCP target. Usage: vibesvg mcp install <codex|claude> --url <mcp-url>");
}

async function handleSkillsCommand(args: string[]): Promise<void> {
  const [action, target] = args;

  if (!action || action === "-h" || action === "--help") {
    console.log(`Usage:
  vibesvg skills install <codex|claude> [--project <project-dir>] [--dest <skills-dir>] [--force]`);
    return;
  }

  if (action !== "install") {
    throw new Error(`Unknown skills command: ${action}`);
  }

  const destination = resolveSkillsDestination(target, {
    dest: optionValue(args, "--dest"),
    project: optionValue(args, "--project")
  });
  const source = await resolveSkillsSource();
  const force = args.includes("--force");
  const result = await installSkills(source, destination, force);
  const installedSummary = result.installed.length ? result.installed.join(", ") : "none";
  const skippedSummary = result.skipped.length ? `; skipped existing: ${result.skipped.join(", ")}` : "";

  console.log(`VibeSVG skills installed for ${target} (${destination})`);
  console.log(`Installed: ${installedSummary}${skippedSummary}`);

  if (result.skipped.length) {
    console.log("Use --force to replace existing VibeSVG skills.");
  }
}

function resolveSkillsDestination(target: string | undefined, options: { dest?: string; project?: string }): string {
  if (target !== "codex" && target !== "claude") {
    throw new Error("Missing skills target. Usage: vibesvg skills install <codex|claude>");
  }

  if (options.dest) {
    return resolve(process.cwd(), options.dest);
  }

  if (target === "codex") {
    return resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"), "skills");
  }

  if (target === "claude") {
    if (options.project) {
      return resolve(process.cwd(), options.project, ".claude", "skills");
    }

    return resolve(process.env.CLAUDE_HOME || resolve(homedir(), ".claude"), "skills");
  }

  throw new Error("Missing skills target. Usage: vibesvg skills install <codex|claude>");
}

async function resolveSkillsSource(): Promise<string> {
  const candidates = [
    resolve(cliDirectory, "../../..", "skills"),
    resolve(cliDirectory, "..", "skills"),
    resolve(cliDirectory, "skills")
  ];

  for (const candidate of candidates) {
    if ((await listSkillDirectories(candidate)).length) {
      return candidate;
    }
  }

  throw new Error("VibeSVG skills directory was not found.");
}

async function installSkills(source: string, destination: string, force: boolean): Promise<{ installed: string[]; skipped: string[] }> {
  const skills = await listSkillDirectories(source);
  const installed: string[] = [];
  const skipped: string[] = [];

  await mkdir(destination, { recursive: true });

  for (const skillPath of skills) {
    const name = basename(skillPath);
    const destinationPath = resolve(destination, name);

    if (await pathExists(destinationPath)) {
      if (!force) {
        skipped.push(name);
        continue;
      }

      await rm(destinationPath, { recursive: true, force: true });
    }

    await cp(skillPath, destinationPath, { recursive: true });
    installed.push(name);
  }

  return { installed, skipped };
}

async function listSkillDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const directories: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillPath = resolve(path, entry.name);

      if (await pathExists(resolve(skillPath, "SKILL.md"))) {
        directories.push(skillPath);
      }
    }

    return directories.sort((a, b) => basename(a).localeCompare(basename(b)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

async function installCodexMcpConfig(url: string): Promise<string> {
  if (commandHelpIncludes("codex", ["mcp", "add", "--help"], "--url")) {
    commandOutputIgnored("codex", ["mcp", "remove", "vibesvg"]);
    commandOutput("codex", ["mcp", "add", "vibesvg", "--url", url]);
  }

  const path = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"), "config.toml");
  const content = await readOptionalTextFile(path);
  let nextContent = upsertTomlTable(
    content,
    "mcp_servers.vibesvg",
    `enabled = true\nurl = ${JSON.stringify(url)}`
  );

  for (const tool of mcpTools()) {
    nextContent = upsertTomlTable(
      nextContent,
      `mcp_servers.vibesvg.tools.${tool.name}`,
      `approval_mode = "approve"`
    );
  }

  await writeTextFile(path, nextContent);
  return path;
}

async function installClaudeMcpConfig(url: string, projectPath?: string): Promise<string> {
  if (
    commandHelpIncludes("claude", ["mcp", "add", "--help"], "--transport") &&
    commandHelpIncludes("claude", ["mcp", "add", "--help"], "--scope")
  ) {
    commandOutputIgnored("claude", ["mcp", "remove", "--scope", "user", "vibesvg"]);
    commandOutput("claude", ["mcp", "add", "--scope", "user", "--transport", "http", "vibesvg", url]);
    return "Claude Code user scope";
  }

  if (!projectPath) {
    throw new Error("Claude Code CLI MCP command is unavailable. Pass --project <project-dir> to write .mcp.json.");
  }

  const path = resolve(projectPath, ".mcp.json");
  const content = await readOptionalTextFile(path);
  const root = content.trim() ? JSON.parse(content) as unknown : {};
  const nextRoot = root && typeof root === "object" && !Array.isArray(root) ? root as Record<string, unknown> : {};
  const existingServers = nextRoot.mcpServers;
  const servers = existingServers && typeof existingServers === "object" && !Array.isArray(existingServers)
    ? existingServers as Record<string, unknown>
    : {};

  servers.vibesvg = { url };
  nextRoot.mcpServers = servers;
  await writeTextFile(path, `${JSON.stringify(nextRoot, null, 2)}\n`);
  return path;
}

function commandHelpIncludes(command: string, args: string[], needle: string): boolean {
  try {
    return commandOutput(command, args).includes(needle);
  } catch {
    return false;
  }
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commandOutputIgnored(command: string, args: string[]): void {
  try {
    execFileSync(command, args, { stdio: "ignore" });
  } catch {
    // Removing an existing MCP registration is best-effort before re-adding it.
  }
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

function upsertTomlTable(content: string, table: string, body: string): string {
  const header = `[${table}]`;
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);

  if (start === -1) {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}${header}\n${body}\n`;
  }

  let end = start + 1;

  while (end < lines.length && !/^\s*\[.+]\s*$/.test(lines[end] ?? "")) {
    end += 1;
  }

  const nextLines = [...lines.slice(0, start), header, body, ...lines.slice(end)];

  return `${nextLines.join("\n").trimEnd()}\n`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function nextPort(port: string): string {
  const next = Number(port) + 1;

  if (next > 65535) {
    throw new Error(`Cannot derive host port from UI port: ${port}`);
  }

  return String(next);
}

function parsePort(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port: ${value}`);
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return String(port);
}

function printHelp(): void {
  console.log(`VibeSVG

Usage:
  vibesvg [project]
  vibesvg host [project]
  vibesvg host --example <name>
  vibesvg init [project]
  vibesvg export [project] [--out <dir>] [--clean]
  vibesvg export --example <name> [--out <dir>] [--clean]
  vibesvg mcp install <codex|claude> --url <mcp-url> [--project <project-dir>]
  vibesvg skills install <codex|claude> [--project <project-dir>] [--force]

Project paths may omit .vsvg.json:
  vibesvg logo       -> logo.vsvg.json
  vibesvg logo.vsvg.json

Options:
  --port <port>     Web UI port for open mode. Host/MCP port for host mode.
                    Defaults to ${DEFAULT_PORT} for open mode and ${DEFAULT_HOST_PORT} for host mode.
  --example <name>  Use examples/<name>.vsvg.json.

Explicit --port values are always treated as fixed ports.
`);
}

function printExportHelp(): void {
  console.log(`VibeSVG SVG Export

Usage:
  vibesvg export [project] [--out <dir>] [--clean]
  vibesvg export --example <name> [--out <dir>] [--clean]

Options:
  --out <dir>      Output directory. Defaults to <project-stem>-svg.
  --clean          Remove the output directory before writing SVG files.
  --example <name> Export examples/<name>.vsvg.json.
`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
