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

## Transform

Node transforms are structured AST data, never raw SVG `transform` strings.

```json
{
  "transform": {
    "translateX": 24,
    "translateY": -12,
    "rotation": 15,
    "scaleX": 1.25,
    "scaleY": 1.25,
    "originX": 256,
    "originY": 256
  }
}
```

`rotation` is clockwise degrees in SVG/Canvas coordinates. The optional origin is persisted when an editor transform is first applied, keeping the pivot stable when node geometry is later edited.

## Clip Path

Clip paths reference another closed geometry node instead of storing SVG markup.

```json
{
  "clipPath": {
    "nodeId": "avatar-outline"
  }
}
```

The initial editor supports rectangle, circle, ellipse, polygon, and closed path nodes as clip sources. SVG export writes a generated `<clipPath>` with a `<use>` reference.

## Mask

Masks also reference a Geometry AST node. The referenced node's rendered alpha defines the visible region.

```json
{
  "mask": {
    "nodeId": "logo-fade"
  }
}
```

SVG export writes a generated `<mask>` with a `<use>` reference. Unlike clip paths, mask sources may use any supported geometry node and may include paint opacity.

## Gradients

Gradients are document-level resources, not raw SVG `url(#...)` strings. Nodes refer to them structurally through paint values.

```json
{
  "resources": {
    "gradients": [
      {
        "id": "blue",
        "type": "linear",
        "x1": 0,
        "y1": 0,
        "x2": 256,
        "y2": 256,
        "stops": [
          { "offset": 0, "color": "#3DBBFF" },
          { "offset": 1, "color": "#2563FF" }
        ]
      }
    ]
  }
}
```

Use the paint reference below for a node fill or stroke:

```json
{ "type": "gradient", "gradientId": "blue" }
```

## Effects

Effects are ordered high-level style values, never raw SVG filter primitives. The current effect types are `blur` and `dropShadow`.

```json
{
  "effects": [
    {
      "type": "dropShadow",
      "dx": 0,
      "dy": 8,
      "blur": 12,
      "color": "#000000",
      "opacity": 0.32
    },
    { "type": "blur", "radius": 1 }
  ]
}
```

## SVG Capability Boundaries

Keep new SVG support structured and high-level. The current AST supports solid
paint, linear/radial gradients, transforms, clip paths, alpha masks, blur, and
drop shadows. Planned additions include inner shadows, blend modes/isolation,
additional high-level effects, pattern paints, markers, symbols/instances, and
rich text runs.

Do not add raw SVG filter primitive lists, raw `transform` strings, or raw
`url(#...)` paint strings as a shortcut. Boolean operations are separately
deferred Geometry Kernel authoring tools; they are not necessary to represent
or edit existing SVG path results.

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

- Line
- Cubic Bezier
- Quadratic Bezier
- Arc

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
