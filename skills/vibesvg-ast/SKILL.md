---
name: vibesvg-ast
description: VibeSVG Geometry AST schema guidance for project files, pages, documents, groups, paths, segments, shapes, text nodes, styling fields, and SVG-compatible geometry. Use when inspecting or constructing Geometry AST data for VibeSVG.
---

# VibeSVG AST

Use this skill when inspecting or changing VibeSVG Geometry AST data.

## Geometry AST

The project file is a `VibeSVGProject`.

Do not directly edit `.vsvg.json` during an active VibeSVG editor/MCP session. Use MCP tools for active sessions, and treat direct project-file edits as an offline fallback for examples, fixtures, or migrations.

```txt
VibeSVGProject
└ Page[]
  └ GeometryDocument
    └ GeometryNode tree
```

Supported node concepts include groups, paths, rectangles, circles, ellipses, polygons, polylines, lines, and text.

Path geometry must be normalized into segments. Do not store only raw SVG path strings.

Groups are normal Geometry AST nodes:

```json
{
  "id": "group-1",
  "type": "group",
  "name": "Group",
  "children": []
}
```

Text is stored as plain text in `TextNode.text`, not as raw SVG markup.
Line breaks are represented with `\n`.

```json
{
  "id": "text-1",
  "type": "text",
  "x": 128,
  "y": 160,
  "text": "VibeSVG\nIcon",
  "fill": "#111827",
  "fontFamily": "Inter, system-ui, sans-serif",
  "fontSize": 24,
  "fontWeight": "700",
  "textAnchor": "middle"
}
```

## Segment Rules

Supported path segment concepts:

* Line
* Cubic Bezier
* Quadratic Bezier
* Arc

Spline-like editor tools may generate cubic Bezier geometry internally.

Segment shapes:

```json
{ "type": "line", "to": { "x": 240, "y": 160 } }
```

```json
{
  "type": "quadratic",
  "control": { "x": 180, "y": 80 },
  "to": { "x": 320, "y": 160 }
}
```

Stroke style supports SVG-style cap and join values:

```json
{
  "fill": "none",
  "stroke": "#111827",
  "strokeWidth": 32,
  "strokeLinecap": "round",
  "strokeLinejoin": "round"
}
```

```json
{
  "type": "cubic",
  "control1": { "x": 160, "y": 80 },
  "control2": { "x": 320, "y": 280 },
  "to": { "x": 400, "y": 160 }
}
```

```json
{
  "type": "arc",
  "rx": 96,
  "ry": 96,
  "xAxisRotation": 0,
  "largeArc": false,
  "sweep": true,
  "to": { "x": 320, "y": 240 }
}
```
