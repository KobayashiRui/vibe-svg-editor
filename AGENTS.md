# VibeSVG

Agent-native SVG editor powered by Geometry AST and patch-based editing.

VibeSVG is an open-source SVG editor designed for AI agents such as:

- Codex
- Claude Code
- Gemini CLI

The editor supports both manual editing and AI-driven editing using a shared Geometry AST.

---

# Vision

Traditional AI SVG workflows regenerate entire SVG files.

VibeSVG takes a different approach.

```txt
SVG
↓ Import

Geometry AST
↓
Patch Operations
↓
Geometry AST

↓ Export
SVG
```

AI agents never directly rewrite SVG strings.

AI agents generate patch operations that modify the Geometry AST.

---

# Core Principles

## Geometry AST is the Source of Truth

SVG is only used for:

- Import
- Export

Internal editing must always operate on Geometry AST.

---

## Patch-based Editing

Never regenerate an entire document when a small modification is sufficient.

Preferred:

```json
{
  "op": "update",
  "target": "node-12",
  "changes": {
    "strokeWidth": 3
  }
}
```

Avoid:

```txt
Generate a completely new SVG.
```

---

## Geometry Kernel

AI should not perform geometry calculations.

AI describes intent.

The Geometry Kernel performs actual geometry modifications.

Examples:

- Move
- Rotate
- Scale
- Offset
- Round Corner
- Smooth
- Mirror

---

## Simplicity Over Abstraction

Avoid introducing:

- Semantic AST
- DSL-first architecture
- Complex reconstruction systems

Geometry AST is sufficient.

Keep the architecture simple.

---

# Repository Structure

```txt
vibesvg/

apps/
├ cli/
└ web/

packages/
├ ast/
├ svg/
├ kernel/
├ editor/
└ mcp/

skills/
```

---

# apps/web

SvelteKit application.

Responsibilities:

- Editor UI
- Canvas
- Layer Tree
- Properties Panel
- Comments Panel

The editor UI must remain reusable.

Future hosted deployments should reuse this application.

---

# apps/cli

Primary entrypoint for v0.1.

Launches:

- Local Web UI
- CLI Host Server
- MCP Server

Example:

```bash
npx vibesvg
```

Expected behavior:

```txt
✓ UI running on http://127.0.0.1:6201
✓ Host running on ws://127.0.0.1:6202/ws
✓ MCP running on http://127.0.0.1:6202/mcp
```

The initial release is CLI-first.

No hosted web application is required.

The CLI host is the local coordination process for editor sessions, project file updates, WebSocket sync, and MCP calls.
The web editor should connect to the CLI host through WebSocket and exchange Geometry AST project snapshots or patch-based updates.
MCP shares the same host process so agent edits and manual editor edits stay synchronized.

Project file paths passed to the CLI may omit `.vsvg.json`.

Examples:

```bash
vibesvg
vibesvg logo
vibesvg logo.vsvg.json
vibesvg init logo
```

Expected path resolution:

```txt
vibesvg          -> ./vibesvg.vsvg.json
vibesvg logo     -> ./logo.vsvg.json
vibesvg logo.vsvg.json -> ./logo.vsvg.json
```

If the resolved project file does not exist, the CLI should create it and continue without prompting.

Keep CLI behavior deterministic and non-interactive so installed agent skills can launch VibeSVG reliably.

The repository-level `pnpm run dev` command should use Turborepo to run `apps/cli` and `apps/web` as separate dev processes.

Examples are treated as first-class projects.

```txt
examples/playground.vsvg.json
examples/vibesvg.vsvg.json
```

`examples/playground.vsvg.json` is the default development project.
`examples/vibesvg.vsvg.json` contains the official VibeSVG icon set.

When implementing editor features, verify functionality using both:

- `examples/playground.vsvg.json`
- `examples/vibesvg.vsvg.json`

Do not hardcode assumptions about a specific example project.

Development defaults:

```txt
Project: examples/playground.vsvg.json
UI:      http://localhost:6201
Host:    ws://localhost:6202/ws
MCP:     http://localhost:6202/mcp
```

`pnpm run dev` should open `examples/playground.vsvg.json`.
`pnpm run dev:icons` should open `examples/vibesvg.vsvg.json`.

Development scripts pass fixed ports. If `6201` or `6202` is unavailable, fail clearly instead of falling back to another port, because web and host are launched as separate processes.
In CLI behavior, explicit `--port` values are fixed ports.
In open mode, `--port` is the Web UI port and the Host/MCP port is `port + 1`.
In host mode, `--port` is the Host/MCP port.
When ports are omitted in normal CLI usage, the CLI may find the next available port.

In monorepo development, `apps/web` owns the Vite dev server and `apps/cli` should run only the CLI host through:

```bash
vibesvg host --example playground
```

Use `--example <name>` for development scripts instead of relative paths such as `../../examples/playground`.
The CLI resolves examples from the repository/package root.

MCP registration commands:

```bash
vibesvg mcp install codex --url http://127.0.0.1:6202/mcp
vibesvg mcp install claude --url http://127.0.0.1:6202/mcp
```

When Claude Code CLI registration is unavailable, pass `--project <project-dir>` to write a project-local `.mcp.json`.

Skill installation commands:

```bash
vibesvg skills install codex
vibesvg skills install claude
```

Codex skills are installed into `$CODEX_HOME/skills` or `~/.codex/skills`.

Claude skills are installed into `$CLAUDE_HOME/skills` or `~/.claude/skills`.

For project-local Claude skills, pass `--project <project-dir>` to install into `<project-dir>/.claude/skills`.

Use `--force` to replace existing VibeSVG skills.

---

# packages/ast

Contains Geometry AST definitions.

Examples:

- Document
- Node
- Segment
- Patch

No UI logic.

---

# packages/svg

Responsible for:

```txt
SVG ↔ Geometry AST
```

Contains:

- SVG Parser
- SVG Exporter

---

# packages/kernel

Geometry engine.

Responsible for geometry operations such as:

- Offset
- Round Corner
- Smooth
- Mirror
- Deferred Boolean Operations

No UI code.

Boolean operations are a geometry-authoring convenience, not an SVG
import/export compatibility requirement. Defer them until a concrete editor
workflow needs them; imported SVG paths must remain editable without Boolean
support.

---

# packages/editor

Reusable editor components.

Examples:

- Canvas
- Selection
- Transform Handles
- Comments
- Viewport

Should remain framework-independent where practical.

---

# packages/mcp

MCP server implementation.

Exposed resources:

- vibesvg://project
- vibesvg://pages
- vibesvg://active-document
- vibesvg://document/{pageId}
- vibesvg://comments
- vibesvg://selection
- vibesvg://skill-guide

Exposed tools:

- project_get
- pages_list
- document_get
- selection_get
- comments_get
- patch_apply
- patches_apply
- node_insert
- node_update
- node_delete
- node_move
- document_update
- gradient_upsert
- gradient_delete
- path_create
- path_segment_append
- path_segment_update
- path_segment_delete
- path_set_closed
- page_add
- page_duplicate
- page_delete
- page_set_active
- svg_export
- project_save

Mutation tools should accept `revision` when possible and should support `dryRun` for edits that can be previewed.
MCP mutations must write through the CLI ProjectStore so WebSocket clients receive project snapshot updates.
Default agent behavior is to avoid direct `.vsvg.json` edits.
When an active CLI host or MCP server is running, agents must not edit `.vsvg.json` directly. Use MCP tools so the editor, revision, autosave, and WebSocket sync stay consistent.
Direct project file edits are fallback-only for offline workflows where no active editor/MCP host is available, such as examples, fixtures, or migrations.

AI agents should interact through these APIs.

---

# skills

Contains reusable AI skills and project knowledge.

Structure:

```txt
skills/
├ svg/
├ ast/
├ patch/
├ editor/
└ mcp/
```

Skills are markdown-based references used by AI agents.

Examples:

- SVG import rules
- Geometry AST rules
- Patch operation patterns
- MCP usage patterns
- UI conventions

Keep skills focused and small.

---

# Geometry AST

Geometry AST is the internal representation.

## Project Files

VibeSVG project files use the `.vsvg.json` extension.

Project files may contain multiple pages.

```txt
VibeSVGProject
└ Page[]
  └ GeometryDocument
    └ SVG-equivalent Geometry AST
```

Treat one page as one SVG.

The active editor canvas renders one active page at a time.

The bottom page strip should show page thumbnails rendered from each page's GeometryDocument, not static placeholder boxes.

Supported nodes:

- GroupNode
- PathNode
- RectNode
- CircleNode
- EllipseNode
- PolygonNode
- PolylineNode
- LineNode
- TextNode

---

## PathNode

Do not store only raw SVG path strings.

Normalize paths into segments.

Example:

```ts
type PathNode = {
  id: string;
  type: "path";

  closed: boolean;

  segments: Segment[];
};
```

---

## Segment Types

Supported:

- LineSegment
- CubicBezierSegment
- QuadraticBezierSegment
- ArcSegment

The Geometry AST should be geometry-oriented rather than SVG-string-oriented.

## TextNode

Text is represented as Geometry AST, not raw SVG text markup.

v0.1 supports a plain text `TextNode`.
The `text` value may include `\n` line breaks.

```ts
type TextNode = {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;

  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  textAnchor?: "start" | "middle" | "end";
  dominantBaseline?: string;
};
```

Future `tspan` and rich text support should extend `TextNode` with optional `runs`.
Do not remove or replace `text`; keep it as the backward-compatible plain text value.

```ts
type TextRun = {
  text: string;
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
  style?: Partial<TextStyle>;
};
```

Import/export rules:

- `<text>Text</text>` maps to `TextNode.text`.
- Line breaks in `TextNode.text` are rendered as multiple canvas text lines.
- Line breaks in `TextNode.text` are exported as `<tspan>` lines so SVG output preserves multiline text.
- `<text><tspan>...</tspan></text>` may later map to `TextNode.runs`; v0.1 may flatten simple `<tspan>` lines into `TextNode.text` with `\n`.
- When `runs` is absent and `text` has no line breaks, export a single `<text>` element.
- When `runs` is present, export `<text>` with `<tspan>` children.

## SVG Feature Scope

VibeSVG should support practical SVG authoring through structured Geometry AST
data. Do not add raw SVG XML, raw `transform` strings, or raw filter primitive
arrays to the AST just to mirror SVG syntax. GUI, agents, and Macro JS must
edit the same high-level fields and resources.

Currently supported SVG-oriented capabilities:

- Geometry nodes, normalized path segments, groups, and plain multiline text
- Solid fill and stroke, including standard stroke width, cap, join, and dash settings
- Linear and radial gradients with gradient stops, usable for fill and stroke
- Translate, rotate, and scale transforms with a stable optional transform origin
- Geometry-node-referenced clip paths and alpha masks
- High-level blur and drop-shadow effects

Prioritize the following remaining SVG capabilities as structured AST features:

1. Inner shadow and blend mode/isolation
2. Additional high-level filter effects, mapped to SVG filter primitives only at export
3. Pattern paint, markers, and other commonly authored paint/stroke settings
4. Reusable symbols and instances (`<symbol>` / `<use>`)
5. Rich text runs / `<tspan>` editing
6. Broader SVG import/export compatibility for common transform, filter, mask, and unit forms
7. Image nodes and other SVG elements when they have a clear Geometry AST representation

Boolean Union / Subtract is intentionally outside this SVG-capability roadmap
for now. SVG stores the result as ordinary paths, so it is not required to
import, render, export, or edit existing SVG artwork.

---

# Comments

Comments are first-class objects.

Example:

```json
{
  "targetNodeIds": ["node-12"],
  "text": "Make this corner rounder"
}
```

Comments provide instructions for AI agents.

---

# AI Workflow

User

```txt
Select Shape
↓
Add Comment
```

Agent

```txt
Read AST
↓
Generate Patch
```

Editor

```txt
Apply Patch
↓
Update AST
↓
Render SVG
```

---

# Development Guidelines

Always prefer:

```txt
Geometry AST > SVG Text
Patch Operations > Regeneration
Geometry Kernel > AI Geometry Calculations
Simplicity > Overengineering
```

When uncertain:

Choose the simpler architecture.

---

# Future Work

Keep these as follow-up tasks unless the user explicitly asks to implement them:

## SVG Capability Roadmap

- Add high-level Inner Shadow and Blend Mode / isolation controls.
- Add advanced, composable effects without exposing raw filter primitives in the AST.
- Add Pattern paints, markers, reusable symbols/instances, and rich text runs as their AST designs are defined.
- Strengthen import/export compatibility for external SVG transform, filter, mask, and unit syntax.
- Consider Boolean operations only as a future Geometry Kernel authoring tool; they are not an SVG compatibility blocker.

## Product and Infrastructure Follow-ups

- Optimize page thumbnail rendering so only changed pages redraw.
- Add page rename and drag-to-reorder in the bottom page strip.
- Add project-level dirty-state handling for `.vsvg.json`.
- Add a UI affordance to copy the current MCP URL and install commands.
- Add authenticated MCP mode for non-default deployment contexts.
- Preserve project/page metadata when importing or exporting multiple SVG files.
