---
name: vibesvg-patch
description: VibeSVG patch operation guidance for targeted Geometry AST edits, node insert/update/delete/move patterns, path segment edits, groups, text, and patch-based SVG-equivalent drawing. Use when generating patches instead of rewriting documents.
---

# VibeSVG Patch

Use this skill when creating patch operations for VibeSVG Geometry AST.

## Patch Principles

Prefer targeted patches.

During an active VibeSVG editor/MCP session, apply patches through MCP tools instead of directly editing `.vsvg.json`. Direct project-file edits are an offline fallback only.

```json
{
  "op": "update",
  "target": "node-12",
  "changes": {
    "strokeWidth": 3
  }
}
```

Avoid replacing a whole document for a local edit.

## Core Operations

Create a node with `insert`.

```json
{
  "op": "insert",
  "parentId": "root",
  "node": {
    "id": "rect-1",
    "type": "rect",
    "x": 120,
    "y": 96,
    "width": 240,
    "height": 160,
    "rx": 12,
    "style": {
      "fill": "#2563eb",
      "stroke": "#dbeafe",
      "strokeWidth": 4
    }
  }
}
```

Update geometry or style with `update`.

```json
{
  "op": "update",
  "target": "rect-1",
  "changes": {
    "width": 280,
    "style": {
      "fill": "#0f172a",
      "stroke": "#38bdf8",
      "strokeWidth": 3
    }
  }
}
```

Delete a node with `delete`.

```json
{
  "op": "delete",
  "target": "rect-1"
}
```

Move a node with `move`.

```json
{
  "op": "move",
  "target": "rect-1",
  "dx": 32,
  "dy": -16
}
```

Resize or rename a document with `updateDocument`.

```json
{
  "op": "updateDocument",
  "changes": {
    "width": 1024,
    "height": 1024,
    "name": "Icon"
  }
}
```

## Layer Order

Within a group, `children[0]` is the back-most layer and the final child is the
front-most layer. New nodes without an `index` are appended to the front.

Reorder an existing node within its current group with `reorder`:

```json
{
  "op": "reorder",
  "target": "highlight",
  "index": 3
}
```

Move an existing node to another group with `reparent`. Omit `index` to append
it at the front of that group:

```json
{
  "op": "reparent",
  "target": "highlight",
  "parentId": "badge-group",
  "index": 0
}
```

Read the current document and use its child order when choosing an index. Do
not update a group's full `children` array merely to change its layer order.

## Drawing Nodes

Use stable, unique ids. Prefer descriptive ids such as `sun-body`, `badge-shadow`, or `logo-mark-path`.

Rectangle:

```json
{
  "id": "card-bg",
  "type": "rect",
  "x": 64,
  "y": 64,
  "width": 384,
  "height": 240,
  "rx": 24,
  "ry": 24,
  "style": {
    "fill": "#111827",
    "stroke": "#38bdf8",
    "strokeWidth": 3
  }
}
```

Ellipse:

```json
{
  "id": "orbit",
  "type": "ellipse",
  "cx": 256,
  "cy": 256,
  "rx": 180,
  "ry": 72,
  "style": {
    "fill": "none",
    "stroke": "#a78bfa",
    "strokeWidth": 6
  }
}
```

Line:

```json
{
  "id": "divider",
  "type": "line",
  "x1": 96,
  "y1": 256,
  "x2": 416,
  "y2": 256,
  "style": {
    "stroke": "#f97316",
    "strokeWidth": 8
  }
}
```

Text:

```json
{
  "id": "label",
  "type": "text",
  "x": 256,
  "y": 448,
  "text": "VibeSVG\nIcon",
  "fill": "#111827",
  "fontFamily": "Inter, system-ui, sans-serif",
  "fontSize": 32,
  "fontWeight": "700",
  "textAnchor": "middle"
}
```

Group:

```json
{
  "id": "mark-group",
  "type": "group",
  "name": "Mark",
  "children": []
}
```

Cubic Bezier path:

```json
{
  "id": "wave",
  "type": "path",
  "start": { "x": 96, "y": 320 },
  "closed": false,
  "segments": [
    {
      "type": "cubic",
      "control1": { "x": 160, "y": 160 },
      "control2": { "x": 320, "y": 480 },
      "to": { "x": 416, "y": 280 }
    }
  ],
  "style": {
    "fill": "none",
    "stroke": "#22c55e",
    "strokeWidth": 10,
    "strokeLinecap": "round",
    "strokeLinejoin": "round"
  }
}
```

Closed triangle path:

```json
{
  "id": "triangle",
  "type": "path",
  "start": { "x": 256, "y": 96 },
  "closed": true,
  "segments": [
    { "type": "line", "to": { "x": 416, "y": 384 } },
    { "type": "line", "to": { "x": 96, "y": 384 } }
  ],
  "style": {
    "fill": "#facc15",
    "stroke": "#78350f",
    "strokeWidth": 6
  }
}
```

## Responsibilities

Agents describe intent and patch targets.
The Geometry Kernel should perform geometry-heavy operations such as moving, scaling, smoothing, mirroring, offsetting, or rounding.
