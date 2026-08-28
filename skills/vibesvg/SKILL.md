---
name: vibesvg
description: VibeSVG project authoring, editing, MCP coordination, Geometry AST, patch workflows, examples, and CLI development guidance. Use when working with VibeSVG projects, drawing or modifying SVG-equivalent geometry, configuring agent skills/MCP, or deciding whether to use MCP versus offline .vsvg.json edits.
---

# VibeSVG

Use this skill when working on a VibeSVG project, especially through an active VibeSVG MCP/editor session.

VibeSVG is a Geometry AST based SVG editor. Treat SVG text as import/export format only.

## Rules

- Read and write Geometry AST project data, not raw SVG strings.
- Prefer patch operations for small edits.
- Keep one page equivalent to one SVG document.
- Check `projectPrompt` before creating or editing generated artwork, and follow it as the project-wide art direction when present.
- Use MCP tools for an active editor session when they are available.
- Default rule: do not directly edit `.vsvg.json`.
- While the VibeSVG CLI host or MCP server is running, always use MCP tools so the editor, revision, autosave, and WebSocket sync stay consistent.
- Direct `.vsvg.json` edits are fallback-only for offline workflows, such as examples, fixtures, migrations, or cases where no active editor/MCP host is available.
- If offline direct edits are unavoidable, preserve project/page metadata, make minimal Geometry AST changes, and avoid rewriting the whole project.
- Preserve layer order: the first child in a group is back-most and the final child is front-most. The Layer UI shows the reverse order.
- For non-trivial artwork, use the active MCP server's `document_render` PNG preview to verify the result before making further targeted patches.

## Related Skills

Use these focused VibeSVG skills when the task needs their details:

- `vibesvg-mcp`: active editor sessions, MCP resources/tools, patch application, selection, page operations, and SVG export through the host.
- `vibesvg-ast`: Geometry AST schema, node fields, path segments, text, groups, and project/page structure.
- `vibesvg-patch`: patch operation shapes and small edit patterns for Geometry AST changes.

For active editor work, prefer `vibesvg-mcp` first, then load `vibesvg-ast` or `vibesvg-patch` only when schema or patch details are needed.

## Examples

Examples are first-class projects:

```txt
examples/playground.vsvg.json
examples/vibesvg.vsvg.json
```

Use `pnpm run dev` for the playground project.
Use `pnpm run dev:icons` for the official VibeSVG icon set.
Do not hardcode assumptions about a specific example project.

## Installation

Install VibeSVG skills into agent skill directories with:

```bash
vibesvg skills install codex
vibesvg skills install claude
```

Use `vibesvg skills install claude --project <project-dir>` for project-local Claude skills.

Register the default local MCP endpoint with:

```bash
vibesvg mcp install codex --url http://127.0.0.1:6202/mcp
vibesvg mcp install claude --url http://127.0.0.1:6202/mcp
```
