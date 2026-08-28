---
name: vibesvg-mcp
description: VibeSVG MCP workflow guidance for active editor sessions, local host endpoints, resources, tools, page/document reads, patch application, selection-aware edits, SVG export, and project save behavior. Use when a running VibeSVG CLI host or MCP endpoint is available.
---

# VibeSVG MCP

Use this skill when an active VibeSVG editor session exposes a local MCP endpoint.

## Workflow

1. Read the active project or page through MCP resources/tools.
2. Generate small patch operations against Geometry AST.
3. Apply patches through MCP.
4. Re-read the affected document to confirm the result.

## Rules

- Do not regenerate a whole SVG when a patch is enough.
- Do not edit raw SVG strings for active editor changes.
- Treat `.vsvg.json` as an implementation detail while the VibeSVG CLI host is active.
- Do not directly edit `.vsvg.json` during active sessions. Use MCP tools so project revisions, autosave, and WebSocket clients stay synchronized.
- Prefer page-scoped operations.
- Keep comments as first-class instructions for agents.
- Before drawing or editing generated artwork, read `vibesvg://project` or call `project_get` and follow `project.projectPrompt` when present.

## Expected Local Host

The CLI starts the editor UI and host server locally.

```txt
Editor: http://127.0.0.1:6201
Host:   ws://127.0.0.1:6202/ws
MCP:    http://127.0.0.1:6202/mcp
```

If the default port is unavailable, use the actual MCP URL printed by the CLI.

For monorepo development with `pnpm run dev`, the same default ports are used:

```txt
Editor: http://localhost:6201
Host:   ws://localhost:6202/ws
MCP:    http://localhost:6202/mcp
```

`pnpm run dev` opens `examples/playground.vsvg.json`.
`pnpm run dev:icons` opens `examples/vibesvg.vsvg.json`.

Register the endpoint with local agents when needed.

```bash
vibesvg mcp install codex --url http://127.0.0.1:6202/mcp
vibesvg mcp install claude --url http://127.0.0.1:6202/mcp
```

## Resources

```txt
vibesvg://project
vibesvg://pages
vibesvg://active-document
vibesvg://document/{pageId}
vibesvg://comments
vibesvg://selection
vibesvg://skill-guide
```

## Tools

```txt
project_get
pages_list
document_get
selection_get
comments_get
patch_apply
patches_apply
node_insert
node_update
node_delete
node_move
document_update
gradient_upsert
gradient_delete
path_create
path_segment_append
path_segment_update
path_segment_delete
path_set_closed
page_add
page_duplicate
page_delete
page_set_active
svg_export
project_save
```

Use `patch_apply` with `dryRun: true` before risky geometry changes.
Use `patches_apply` when drawing multiple shapes in one update.
Use `node_insert`, `node_update`, `node_delete`, and `node_move` for simple create/edit/delete/move operations.
Use `gradient_upsert` to create or replace a document gradient, then set a node's
`style.fill` or `style.stroke` to `{ "type": "gradient", "gradientId": "<id>" }`.
Use `gradient_delete` only after no node refers to that gradient.
Use `node_update` or `patch_apply` to set `style.effects`. Effects are ordered
high-level objects such as `{ "type": "blur", "radius": 6 }` and
`{ "type": "dropShadow", "dx": 0, "dy": 8, "blur": 12, "color": "#000000" }`.
Use `path_create` and `path_segment_*` for path drawing or segment-level curve edits.
Use `node_insert` / `node_update` for `text` and `group` nodes as normal Geometry AST nodes.
Pass `revision` when mutating if the current revision is known.
`vibesvg://selection` reflects the current editor selection when the web editor is connected to the CLI host.

## Drawing Workflow

When asked to draw SVG content:

1. Call `project_get` or read `vibesvg://project` to check `projectPrompt` and revision.
2. Call `document_get` to read the active document when needed.
3. Use `document_update` if the requested canvas size differs.
4. Use `patches_apply` or `node_insert` to add Geometry AST nodes.
5. Re-read with `document_get`.
6. Use `svg_export` when the user asks for SVG output.

Example `patches_apply` arguments:

```json
{
  "revision": "<current-revision>",
  "patches": [
    {
      "op": "updateDocument",
      "changes": {
        "width": 512,
        "height": 512,
        "name": "Simple Icon"
      }
    },
    {
      "op": "insert",
      "parentId": "root",
      "node": {
        "id": "icon-bg",
        "type": "rect",
        "x": 48,
        "y": 48,
        "width": 416,
        "height": 416,
        "rx": 48,
        "ry": 48,
        "style": {
          "fill": "#0f172a",
          "stroke": "#38bdf8",
          "strokeWidth": 8
        }
      }
    },
    {
      "op": "insert",
      "parentId": "root",
      "node": {
        "id": "icon-circle",
        "type": "ellipse",
        "cx": 256,
        "cy": 256,
        "rx": 120,
        "ry": 120,
        "style": {
          "fill": "#22c55e",
          "stroke": "none"
        }
      }
    }
  ]
}
```

Example edit arguments:

```json
{
  "target": "icon-circle",
  "changes": {
    "rx": 96,
    "ry": 96,
    "style": {
      "fill": "#f97316",
      "stroke": "#fff7ed",
      "strokeWidth": 6
    }
  }
}
```

Example gradient resource:

```json
{
  "gradient": {
    "id": "icon-blue",
    "type": "linear",
    "x1": 32,
    "y1": 32,
    "x2": 224,
    "y2": 224,
    "stops": [
      { "offset": 0, "color": "#3DBBFF" },
      { "offset": 1, "color": "#2563FF" }
    ]
  }
}
```

Example delete arguments:

```json
{
  "target": "icon-circle"
}
```

## Path Drawing

Create paths with normalized segments, not raw SVG `d` strings.

Example `path_create` arguments:

```json
{
  "id": "logo-curve",
  "start": { "x": 96, "y": 320 },
  "closed": false,
  "style": {
    "fill": "none",
    "stroke": "#38bdf8",
    "strokeWidth": 10
  },
  "segments": [
    {
      "type": "cubic",
      "control1": { "x": 160, "y": 160 },
      "control2": { "x": 320, "y": 480 },
      "to": { "x": 416, "y": 280 }
    }
  ]
}
```

Append a line segment:

```json
{
  "target": "logo-curve",
  "segment": {
    "type": "line",
    "to": { "x": 448, "y": 360 }
  }
}
```

Append a quadratic segment:

```json
{
  "target": "logo-curve",
  "segment": {
    "type": "quadratic",
    "control": { "x": 360, "y": 120 },
    "to": { "x": 448, "y": 240 }
  }
}
```

Append an arc segment:

```json
{
  "target": "logo-curve",
  "segment": {
    "type": "arc",
    "rx": 96,
    "ry": 96,
    "xAxisRotation": 0,
    "largeArc": false,
    "sweep": true,
    "to": { "x": 320, "y": 384 }
  }
}
```

Replace the first segment:

```json
{
  "target": "logo-curve",
  "index": 0,
  "segment": {
    "type": "cubic",
    "control1": { "x": 128, "y": 180 },
    "control2": { "x": 300, "y": 420 },
    "to": { "x": 400, "y": 300 }
  }
}
```

Delete a segment:

```json
{
  "target": "logo-curve",
  "index": 1
}
```

Close a path:

```json
{
  "target": "logo-curve",
  "closed": true
}
```
