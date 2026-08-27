import {
  createPage,
  getDocumentViewBox,
  type GeometryDocument,
  type GeometryNode,
  type VibeSVGPage,
  type VibeSVGProject,
  type PathNode,
  type PatchOperation,
  type Point,
  type Segment,
  type Selection,
} from "@vibesvg/ast";
import { applyPatch, applyPatches } from "@vibesvg/kernel";
import { exportToSvg } from "@vibesvg/svg";

export type VibeSVGMcpStore = {
  readProject(): VibeSVGProject;
  writeProject(
    project: VibeSVGProject,
    source?: unknown,
  ): { project: VibeSVGProject; revision: string };
  revision(): string;
  selection(): Selection;
};

export type ToolContext = {
  store: VibeSVGMcpStore;
};

export function mcpTools() {
  return [
    {
      name: "project_get",
      description:
        "Read the active VibeSVG project, including projectPrompt when present.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "pages_list",
      description: "List pages in the active VibeSVG project.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "document_get",
      description:
        "Read a GeometryDocument by pageId, or the active document when pageId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
        },
      },
    },
    {
      name: "selection_get",
      description: "Read the current editor selection.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "comments_get",
      description:
        "Read comments from a page, or the active page when pageId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
        },
      },
    },
    {
      name: "patch_apply",
      description: "Apply one Geometry AST patch to a page document.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          patch: { type: "object" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["patch"],
      },
    },
    {
      name: "patches_apply",
      description:
        "Apply multiple Geometry AST patches to a page document in one revision update.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          patches: { type: "array", items: { type: "object" } },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["patches"],
      },
    },
    {
      name: "node_insert",
      description:
        "Insert a Geometry AST node into a document. Defaults parentId to root.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          parentId: { type: "string" },
          node: { type: "object" },
          index: { type: "number" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["node"],
      },
    },
    {
      name: "node_update",
      description: "Update one Geometry AST node by id.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          changes: { type: "object" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "changes"],
      },
    },
    {
      name: "node_delete",
      description: "Delete one Geometry AST node by id.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target"],
      },
    },
    {
      name: "node_move",
      description: "Move one Geometry AST node by delta.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          dx: { type: "number" },
          dy: { type: "number" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "dx", "dy"],
      },
    },
    {
      name: "document_update",
      description:
        "Update active document metadata such as name, SVG output width/height, or viewBox.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          changes: {
            type: "object",
            properties: {
              name: { type: "string" },
              width: { type: "number" },
              height: { type: "number" },
              viewBox: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
                required: ["x", "y", "width", "height"],
              },
            },
          },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["changes"],
      },
    },
    {
      name: "path_create",
      description: "Create a PathNode with normalized Geometry AST segments.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          parentId: { type: "string" },
          id: { type: "string" },
          start: { type: "object" },
          segments: { type: "array", items: { type: "object" } },
          closed: { type: "boolean" },
          style: { type: "object" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["id", "start"],
      },
    },
    {
      name: "path_segment_append",
      description: "Append one normalized segment to a PathNode.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          segment: { type: "object" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "segment"],
      },
    },
    {
      name: "path_segment_update",
      description: "Replace one segment in a PathNode by zero-based index.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          index: { type: "number" },
          segment: { type: "object" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "index", "segment"],
      },
    },
    {
      name: "path_segment_delete",
      description: "Delete one segment from a PathNode by zero-based index.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          index: { type: "number" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "index"],
      },
    },
    {
      name: "path_set_closed",
      description: "Set whether a PathNode is closed.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          target: { type: "string" },
          closed: { type: "boolean" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["target", "closed"],
      },
    },
    {
      name: "page_add",
      description: "Add a new page to the project.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          width: { type: "number" },
          height: { type: "number" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
      },
    },
    {
      name: "page_duplicate",
      description: "Duplicate a page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
      },
    },
    {
      name: "page_delete",
      description: "Delete a page. At least one page must remain.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["pageId"],
      },
    },
    {
      name: "page_set_active",
      description: "Set the active page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          revision: { type: "string" },
          dryRun: { type: "boolean" },
        },
        required: ["pageId"],
      },
    },
    {
      name: "svg_export",
      description: "Export a page document to SVG.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
        },
      },
    },
    {
      name: "project_save",
      description: "Persist the current project snapshot to disk.",
      inputSchema: {
        type: "object",
        properties: {
          revision: { type: "string" },
        },
      },
    },
  ];
}

export function callMcpTool(
  context: ToolContext,
  name: string,
  args: Record<string, unknown>,
) {
  switch (name) {
    case "project_get":
      return mcpText({
        ok: true,
        project: context.store.readProject(),
        revision: context.store.revision(),
      });
    case "pages_list":
      return mcpText({
        ok: true,
        activePageId: context.store.readProject().activePageId,
        pages: context.store.readProject().pages.map(pageSummary),
        revision: context.store.revision(),
      });
    case "document_get": {
      const project = context.store.readProject();
      const page = pageByOptionalId(project, optionalString(args.pageId));
      return mcpText({
        ok: true,
        pageId: page.id,
        document: page.document,
        revision: context.store.revision(),
      });
    }
    case "selection_get":
      return mcpText({
        ok: true,
        selection: context.store.selection(),
        revision: context.store.revision(),
      });
    case "comments_get": {
      const project = context.store.readProject();
      const page = pageByOptionalId(project, optionalString(args.pageId));
      return mcpText({
        ok: true,
        pageId: page.id,
        comments: page.document.comments,
        revision: context.store.revision(),
      });
    }
    case "patch_apply":
      return mcpText(applyPatchTool(context, args));
    case "patches_apply":
      return mcpText(applyPatchesTool(context, args));
    case "node_insert":
      return mcpText(nodeInsertTool(context, args));
    case "node_update":
      return mcpText(nodeUpdateTool(context, args));
    case "node_delete":
      return mcpText(nodeDeleteTool(context, args));
    case "node_move":
      return mcpText(nodeMoveTool(context, args));
    case "document_update":
      return mcpText(documentUpdateTool(context, args));
    case "path_create":
      return mcpText(pathCreateTool(context, args));
    case "path_segment_append":
      return mcpText(pathSegmentAppendTool(context, args));
    case "path_segment_update":
      return mcpText(pathSegmentUpdateTool(context, args));
    case "path_segment_delete":
      return mcpText(pathSegmentDeleteTool(context, args));
    case "path_set_closed":
      return mcpText(pathSetClosedTool(context, args));
    case "page_add":
      return mcpText(pageAddTool(context, args));
    case "page_duplicate":
      return mcpText(pageDuplicateTool(context, args));
    case "page_delete":
      return mcpText(pageDeleteTool(context, args));
    case "page_set_active":
      return mcpText(pageSetActiveTool(context, args));
    case "svg_export": {
      const project = context.store.readProject();
      const page = pageByOptionalId(project, optionalString(args.pageId));
      return mcpText({
        ok: true,
        pageId: page.id,
        svg: exportToSvg(page.document),
        revision: context.store.revision(),
      });
    }
    case "project_save": {
      assertRevision(context, optionalString(args.revision));
      const change = context.store.writeProject(context.store.readProject());
      return mcpText({ ok: true, revision: change.revision });
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

function applyPatchTool(context: ToolContext, args: Record<string, unknown>) {
  assertRevision(context, optionalString(args.revision));

  const patch = args.patch;

  if (!isPatchOperation(patch)) {
    throw new Error("patch_apply requires a valid patch.");
  }

  return applyPatchOperations(context, args, [patch]);
}

function applyPatchesTool(context: ToolContext, args: Record<string, unknown>) {
  const patches = args.patches;

  if (!Array.isArray(patches) || !patches.every(isPatchOperation)) {
    throw new Error("patches_apply requires an array of valid patches.");
  }

  return applyPatchOperations(context, args, patches);
}

function nodeInsertTool(context: ToolContext, args: Record<string, unknown>) {
  const node = args.node;

  if (!isGeometryNode(node)) {
    throw new Error("node_insert requires a valid Geometry AST node.");
  }

  return applyPatchOperations(context, args, [
    {
      op: "insert",
      parentId: optionalString(args.parentId) ?? "root",
      node,
      index: optionalNumber(args.index),
    },
  ]);
}

function nodeUpdateTool(context: ToolContext, args: Record<string, unknown>) {
  return applyPatchOperations(context, args, [
    {
      op: "update",
      target: requiredString(args.target, "target"),
      changes: requiredRecord(args.changes, "changes") as Partial<GeometryNode>,
    },
  ]);
}

function nodeDeleteTool(context: ToolContext, args: Record<string, unknown>) {
  return applyPatchOperations(context, args, [
    {
      op: "delete",
      target: requiredString(args.target, "target"),
    },
  ]);
}

function nodeMoveTool(context: ToolContext, args: Record<string, unknown>) {
  return applyPatchOperations(context, args, [
    {
      op: "move",
      target: requiredString(args.target, "target"),
      dx: requiredNumber(args.dx, "dx"),
      dy: requiredNumber(args.dy, "dy"),
    },
  ]);
}

function documentUpdateTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  return applyPatchOperations(context, args, [
    {
      op: "updateDocument",
      changes: requiredRecord(args.changes, "changes") as Partial<
        Pick<
          GeometryDocument,
          "background" | "name" | "width" | "height" | "viewBox"
        >
      >,
    },
  ]);
}

function pathCreateTool(context: ToolContext, args: Record<string, unknown>) {
  const segments = optionalSegments(args.segments);
  const style = optionalRecord(args.style);
  const node: PathNode = {
    id: requiredString(args.id, "id"),
    type: "path",
    start: requiredPoint(args.start, "start"),
    closed: args.closed === true,
    segments,
    ...(style ? { style } : {}),
  };

  return applyPatchOperations(context, args, [
    {
      op: "insert",
      parentId: optionalString(args.parentId) ?? "root",
      node,
    },
  ]);
}

function pathSegmentAppendTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  const path = readPathNode(context, args);
  const segment = requiredSegment(args.segment, "segment");

  return applyPatchOperations(context, args, [
    {
      op: "update",
      target: path.id,
      changes: {
        segments: [...path.segments, segment],
        spline: undefined,
      } as Partial<PathNode>,
    },
  ]);
}

function pathSegmentUpdateTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  const path = readPathNode(context, args);
  const index = requiredIndex(args.index, path.segments.length, "index");
  const segment = requiredSegment(args.segment, "segment");
  const segments = path.segments.map((current, currentIndex) =>
    currentIndex === index ? segment : current,
  );

  return applyPatchOperations(context, args, [
    {
      op: "update",
      target: path.id,
      changes: {
        segments,
        spline: undefined,
      } as Partial<PathNode>,
    },
  ]);
}

function pathSegmentDeleteTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  const path = readPathNode(context, args);
  const index = requiredIndex(args.index, path.segments.length, "index");
  const segments = path.segments.filter(
    (_, currentIndex) => currentIndex !== index,
  );

  return applyPatchOperations(context, args, [
    {
      op: "update",
      target: path.id,
      changes: {
        segments,
        spline: undefined,
      } as Partial<PathNode>,
    },
  ]);
}

function pathSetClosedTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  if (typeof args.closed !== "boolean") {
    throw new Error("closed must be a boolean.");
  }

  const path = readPathNode(context, args);

  return applyPatchOperations(context, args, [
    {
      op: "update",
      target: path.id,
      changes: {
        closed: args.closed,
      } as Partial<PathNode>,
    },
  ]);
}

function applyPatchOperations(
  context: ToolContext,
  args: Record<string, unknown>,
  patches: PatchOperation[],
) {
  assertRevision(context, optionalString(args.revision));

  const dryRun = args.dryRun === true;
  const project = context.store.readProject();
  const page = pageByOptionalId(project, optionalString(args.pageId));
  const nextDocument =
    patches.length === 1
      ? applyPatch(page.document, patches[0]!)
      : applyPatches(page.document, patches);
  const nextProject = updatePageDocument(project, page.id, nextDocument);

  if (dryRun) {
    return {
      ok: true,
      dryRun,
      pageId: page.id,
      patches,
      document: nextDocument,
      revision: context.store.revision(),
    };
  }

  const change = context.store.writeProject(nextProject);

  return {
    ok: true,
    dryRun,
    pageId: page.id,
    patches,
    document: nextDocument,
    revision: change.revision,
  };
}

function readPathNode(
  context: ToolContext,
  args: Record<string, unknown>,
): PathNode {
  const project = context.store.readProject();
  const page = pageByOptionalId(project, optionalString(args.pageId));
  const target = requiredString(args.target, "target");
  const node = findNode(page.document.root, target);

  if (!node) {
    throw new Error(`Unknown path node: ${target}`);
  }

  if (node.type !== "path") {
    throw new Error(`Node is not a path: ${target}`);
  }

  return node;
}

function pageAddTool(context: ToolContext, args: Record<string, unknown>) {
  assertRevision(context, optionalString(args.revision));

  const project = context.store.readProject();
  const pageId = nextPageId(project);
  const activePage = pageByOptionalId(project);
  const page = createPage({
    pageId,
    name: optionalString(args.name) ?? `Page ${project.pages.length + 1}`,
    width: optionalNumber(args.width) ?? activePage.document.width,
    height: optionalNumber(args.height) ?? activePage.document.height,
  });
  const nextProject = touchProject({
    ...project,
    activePageId: page.id,
    pages: [...project.pages, page],
  });

  if (args.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      page,
      project: nextProject,
      revision: context.store.revision(),
    };
  }

  const change = context.store.writeProject(nextProject);
  return { ok: true, dryRun: false, page, revision: change.revision };
}

function pageDuplicateTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  assertRevision(context, optionalString(args.revision));

  const project = context.store.readProject();
  const sourcePage = pageByOptionalId(project, optionalString(args.pageId));
  const pageId = nextPageId(project);
  const document = structuredClone(sourcePage.document) as GeometryDocument;

  document.id = `${pageId}-document`;
  document.name = `${sourcePage.name} Copy`;

  const page = {
    id: pageId,
    name: document.name,
    document,
  };
  const nextProject = touchProject({
    ...project,
    activePageId: pageId,
    pages: [...project.pages, page],
  });

  if (args.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      page,
      project: nextProject,
      revision: context.store.revision(),
    };
  }

  const change = context.store.writeProject(nextProject);
  return { ok: true, dryRun: false, page, revision: change.revision };
}

function pageDeleteTool(context: ToolContext, args: Record<string, unknown>) {
  assertRevision(context, optionalString(args.revision));

  const pageId = requiredString(args.pageId, "pageId");
  const project = context.store.readProject();

  if (project.pages.length <= 1) {
    throw new Error("Cannot delete the last page.");
  }

  if (!project.pages.some((page) => page.id === pageId)) {
    throw new Error(`Unknown pageId: ${pageId}`);
  }

  const pages = project.pages.filter((page) => page.id !== pageId);
  const activePageId =
    project.activePageId === pageId ? pages[0]!.id : project.activePageId;
  const nextProject = touchProject({ ...project, activePageId, pages });

  if (args.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      project: nextProject,
      revision: context.store.revision(),
    };
  }

  const change = context.store.writeProject(nextProject);
  return { ok: true, dryRun: false, revision: change.revision };
}

function pageSetActiveTool(
  context: ToolContext,
  args: Record<string, unknown>,
) {
  assertRevision(context, optionalString(args.revision));

  const pageId = requiredString(args.pageId, "pageId");
  const project = context.store.readProject();

  if (!project.pages.some((page) => page.id === pageId)) {
    throw new Error(`Unknown pageId: ${pageId}`);
  }

  const nextProject = touchProject({ ...project, activePageId: pageId });

  if (args.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      project: nextProject,
      revision: context.store.revision(),
    };
  }

  const change = context.store.writeProject(nextProject);
  return {
    ok: true,
    dryRun: false,
    activePageId: pageId,
    revision: change.revision,
  };
}

function assertRevision(context: ToolContext, revision: string | undefined) {
  if (revision && revision !== context.store.revision()) {
    throw new Error(
      `Revision mismatch. Current revision is ${context.store.revision()}.`,
    );
  }
}

function updatePageDocument(
  project: VibeSVGProject,
  pageId: string,
  document: GeometryDocument,
): VibeSVGProject {
  return touchProject({
    ...project,
    pages: project.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            name: document.name,
            document,
          }
        : page,
    ),
  });
}

function findNode(
  node: GeometryNode,
  target: string,
): GeometryNode | undefined {
  if (node.id === target) {
    return node;
  }

  if (node.type !== "group") {
    return undefined;
  }

  for (const child of node.children) {
    const match = findNode(child, target);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function touchProject(project: VibeSVGProject): VibeSVGProject {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
  };
}

function pageByOptionalId(
  project: VibeSVGProject,
  pageId?: string,
): VibeSVGPage {
  const page = pageId
    ? project.pages.find((item) => item.id === pageId)
    : (project.pages.find((item) => item.id === project.activePageId) ??
      project.pages[0]);

  if (!page) {
    throw new Error(
      pageId ? `Unknown pageId: ${pageId}` : "Project has no pages.",
    );
  }

  return page;
}

function pageSummary(page: VibeSVGPage) {
  return {
    id: page.id,
    name: page.name,
    width: page.document.width,
    height: page.document.height,
    viewBox: getDocumentViewBox(page.document),
    nodeCount: page.document.root.children.length,
    commentCount: page.document.comments.length,
  };
}

function nextPageId(project: VibeSVGProject): string {
  let index = project.pages.length + 1;

  while (project.pages.some((page) => page.id === `page-${index}`)) {
    index += 1;
  }

  return `page-${index}`;
}

function isPatchOperation(value: unknown): value is PatchOperation {
  return Boolean(
    value &&
    typeof value === "object" &&
    "op" in value &&
    typeof value.op === "string",
  );
}

function isGeometryNode(value: unknown): value is GeometryNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const node = value as Record<string, unknown>;

  return typeof node.id === "string" && isNodeType(node.type);
}

function isNodeType(value: unknown): value is GeometryNode["type"] {
  return (
    value === "group" ||
    value === "rect" ||
    value === "circle" ||
    value === "ellipse" ||
    value === "line" ||
    value === "polygon" ||
    value === "polyline" ||
    value === "path"
  );
}

function optionalSegments(value: unknown): Segment[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("segments must be an array.");
  }

  return value.map((segment, index) =>
    requiredSegment(segment, `segments[${index}]`),
  );
}

function requiredSegment(value: unknown, name: string): Segment {
  const segment = requiredRecord(value, name);
  const type = segment.type;

  if (type === "line") {
    return {
      type,
      to: requiredPoint(segment.to, `${name}.to`),
    };
  }

  if (type === "quadratic") {
    return {
      type,
      control: requiredPoint(segment.control, `${name}.control`),
      to: requiredPoint(segment.to, `${name}.to`),
    };
  }

  if (type === "cubic") {
    return {
      type,
      control1: requiredPoint(segment.control1, `${name}.control1`),
      control2: requiredPoint(segment.control2, `${name}.control2`),
      to: requiredPoint(segment.to, `${name}.to`),
    };
  }

  if (type === "arc") {
    return {
      type,
      rx: requiredNumber(segment.rx, `${name}.rx`),
      ry: requiredNumber(segment.ry, `${name}.ry`),
      xAxisRotation: optionalNumber(segment.xAxisRotation) ?? 0,
      largeArc: requiredBoolean(segment.largeArc, `${name}.largeArc`),
      sweep: requiredBoolean(segment.sweep, `${name}.sweep`),
      to: requiredPoint(segment.to, `${name}.to`),
    };
  }

  throw new Error(`${name}.type must be line, quadratic, cubic, or arc.`);
}

function requiredPoint(value: unknown, name: string): Point {
  const point = requiredRecord(value, name);

  return {
    x: requiredNumber(point.x, `${name}.x`),
    y: requiredNumber(point.y, `${name}.y`),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean.`);
  }

  return value;
}

function requiredIndex(value: unknown, length: number, name: string): number {
  const index = requiredNumber(value, name);

  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(
      `${name} must be an integer from 0 to ${Math.max(0, length - 1)}.`,
    );
  }

  return index;
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredRecord(value, "style");
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function mcpText(value: unknown, isError = false) {
  return {
    content: [
      {
        type: "text",
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    isError,
  };
}
