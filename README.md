<p align="center">
  <img src="https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/app-icon.svg" alt="VibeSVG" width="144" height="144" />
</p>

<h1 align="center">VibeSVG</h1>

<p align="center">
  Agent-native SVG editor for AI coding agents.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vibesvg"><img src="https://img.shields.io/npm/v/vibesvg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/vibesvg"><img src="https://img.shields.io/npm/dm/vibesvg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/KobayashiRui/vibe-svg-editor/blob/main/LICENSE"><img src="https://img.shields.io/github/license/KobayashiRui/vibe-svg-editor?style=flat-square" alt="MIT license" /></a>
  <img src="https://img.shields.io/node/v/vibesvg?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/pnpm-9.0.0-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 9.0.0" />
</p>

<p align="center">
  English | <a href="https://github.com/KobayashiRui/vibe-svg-editor/blob/main/README.ja.md">日本語</a>
</p>

VibeSVG is an agent-native SVG editor for AI coding agents.
Instead of asking agents to rewrite whole SVG strings, VibeSVG imports SVG into a Geometry AST,
applies targeted patch operations, and exports SVG only at the boundary.

![VibeSVG editor](https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/editor.png)

```txt
SVG
↓ Import
Geometry AST
↓ Patch Operations
Geometry AST
↓ Export
SVG
```

## Demo

![VibeSVG demo](https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/vibesvg-demo.gif)

## Status

VibeSVG is in early development. The current release is CLI-first and focuses on local editor sessions, project files, SVG export, and MCP-based agent workflows.

## SVG Feature Support

VibeSVG represents editable SVG concepts as structured Geometry AST data and generates SVG XML at import/export boundaries.

Available today: geometry nodes and normalized paths, solid fill/stroke, linear and radial gradients, translate/rotate/scale transforms, geometry-referenced clip paths and alpha masks, plus blur and drop shadows.

Next priorities are inner shadows, blend modes, additional high-level effects, pattern paints and markers, reusable symbols/instances, rich text runs, and stronger compatibility with external SVG transform/filter/mask syntax. Boolean Union / Subtract is deliberately deferred: it is a geometry-authoring operation, not a requirement for importing or editing ordinary SVG paths.

## Quick Start

Install VibeSVG:

```sh
npm install -g vibesvg
```

Start a new project:

```sh
vibesvg my-logo
```

This opens `./my-logo.vsvg.json`. If the file does not exist, VibeSVG creates it automatically.

You can also run it without a global install:

```sh
npx vibesvg my-logo
```

## Agent Workflow

VibeSVG keeps the Geometry AST as the source of truth. AI agents should modify projects through patch operations or MCP tools instead of regenerating SVG files.

Default local MCP endpoint:

```txt
http://127.0.0.1:6202/mcp
```

Register the local MCP endpoint:

```sh
vibesvg mcp install codex --url http://127.0.0.1:6202/mcp
vibesvg mcp install claude --url http://127.0.0.1:6202/mcp
```

Install VibeSVG skills:

```sh
vibesvg skills install codex
vibesvg skills install claude
```

## Project Files

VibeSVG project files use the `.vsvg.json` extension and can contain multiple pages. One page maps to one SVG-equivalent Geometry AST document.

Examples:

```txt
examples/playground.vsvg.json
examples/vibesvg.vsvg.json
```

CLI path resolution is deterministic:

```txt
vibesvg              -> ./vibesvg.vsvg.json
vibesvg logo         -> ./logo.vsvg.json
vibesvg logo.vsvg.json -> ./logo.vsvg.json
```

If the resolved project file does not exist, the CLI creates it and continues.

## Repository Layout

```txt
apps/
├ cli/  Local host, CLI entrypoint, MCP coordination
└ web/  SvelteKit editor UI

packages/
├ ast/     Geometry AST definitions
├ editor/  Reusable editor interaction logic
├ kernel/  Geometry operations
├ mcp/     MCP server implementation
└ svg/     SVG import/export
```

## README Assets

README images live in `docs/images`. App runtime assets live in `apps/web/static`.

Current README assets:

```txt
docs/images/app-icon.svg
docs/images/vibesvg-demo.gif
docs/images/editor.png
```

## Developer Workflow

Install dependencies:

```sh
pnpm install
```

Run VibeSVG from this repository:

```sh
pnpm run build:cli
node apps/cli/dist/index.js my-logo
```

Run the default development project:

```sh
pnpm run dev
```

Development defaults:

```txt
Project: examples/playground.vsvg.json
UI:      http://localhost:6201
Host:    ws://localhost:6202/ws
MCP:     http://localhost:6202/mcp
```

Run the official VibeSVG icon project:

```sh
pnpm run dev:icons
```

### Export Icons

Export the icon project into the web app static directory:

```sh
pnpm run export:icons
```

The generated SVG files are written to:

```txt
apps/web/static/icons
```

Running the command again overwrites the generated icon output.

### Package

Build the publishable CLI package:

```sh
pnpm run build:cli
```

Create a local npm tarball for inspection:

```sh
pnpm run pack:cli
```

The package is written to `artifacts/npm` and contains the bundled CLI, built web UI, and VibeSVG skills.
