export type NodeId = string;

export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Paint = string | "none";

export type StrokeLineCap = "butt" | "round" | "square";

export type StrokeLineJoin =
  | "arcs"
  | "bevel"
  | "miter"
  | "miter-clip"
  | "round";

export type NodeStyle = {
  fill?: Paint;
  stroke?: Paint;
  strokeWidth?: number;
  strokeLinecap?: StrokeLineCap;
  strokeLinejoin?: StrokeLineJoin;
  strokeMiterlimit?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  opacity?: number;
};

export type TextStyle = Pick<
  NodeStyle,
  "fill" | "opacity" | "stroke" | "strokeWidth"
> & {
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: "normal" | "italic";
  fontWeight?: number | string;
  textAnchor?: "start" | "middle" | "end";
  dominantBaseline?: string;
};

export type DocumentBackground =
  | {
      type: "solid";
      color: string;
    }
  | {
      type: "checkerboard";
      light?: string;
      dark?: string;
      size?: number;
    };

export type BaseNode = {
  id: NodeId;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  style?: NodeStyle;
};

export type GroupNode = BaseNode & {
  type: "group";
  children: GeometryNode[];
};

export type RectNode = BaseNode & {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
};

export type CircleNode = BaseNode & {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
};

export type EllipseNode = BaseNode & {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

export type LineNode = BaseNode & {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type PolygonNode = BaseNode & {
  type: "polygon";
  points: Point[];
};

export type PolylineNode = BaseNode & {
  type: "polyline";
  points: Point[];
};

export type LineSegment = {
  type: "line";
  to: Point;
};

export type CubicBezierSegment = {
  type: "cubic";
  control1: Point;
  control2: Point;
  to: Point;
};

export type QuadraticBezierSegment = {
  type: "quadratic";
  control: Point;
  to: Point;
};

export type ArcSegment = {
  type: "arc";
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: boolean;
  sweep: boolean;
  to: Point;
};

export type Segment =
  | LineSegment
  | CubicBezierSegment
  | QuadraticBezierSegment
  | ArcSegment;

export type PathSpline = {
  type: "basis";
  points: Point[];
};

export type PathNode = BaseNode & {
  type: "path";
  start: Point;
  closed: boolean;
  segments: Segment[];
  spline?: PathSpline;
};

export type TextRun = {
  text: string;
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
  style?: Partial<TextStyle>;
};

export type TextNode = BaseNode &
  TextStyle & {
    type: "text";
    x: number;
    y: number;
    text: string;
    runs?: TextRun[];
  };

export type GeometryNode =
  | GroupNode
  | RectNode
  | CircleNode
  | EllipseNode
  | LineNode
  | PolygonNode
  | PolylineNode
  | PathNode
  | TextNode;

export type Comment = {
  id: string;
  targetNodeIds: NodeId[];
  text: string;
  resolved?: boolean;
};

export type GeometryDocument = {
  id: string;
  name: string;
  /** SVG output viewport dimensions. */
  width: number;
  height: number;
  /** SVG user-coordinate range. When omitted, it is 0 0 width height. */
  viewBox?: ViewBox;
  background?: DocumentBackground;
  root: GroupNode;
  comments: Comment[];
};

export type GlyphSmithPage = {
  id: string;
  name: string;
  document: GeometryDocument;
};

export type ProjectSettings = {
  defaultCanvas?: {
    width: number;
    height: number;
  };
};

export type GlyphSmithProject = {
  schemaVersion: 1;
  id: string;
  name: string;
  activePageId: string;
  projectPrompt?: string;
  settings?: ProjectSettings;
  pages: GlyphSmithPage[];
  createdAt?: string;
  updatedAt?: string;
};

export type InsertPatch = {
  op: "insert";
  parentId: NodeId;
  node: GeometryNode;
  index?: number;
};

export type UpdatePatch = {
  op: "update";
  target: NodeId;
  changes: Partial<GeometryNode>;
};

export type DeletePatch = {
  op: "delete";
  target: NodeId;
};

export type MovePatch = {
  op: "move";
  target: NodeId;
  dx: number;
  dy: number;
};

export type UpdateDocumentPatch = {
  op: "updateDocument";
  changes: Partial<
    Pick<
      GeometryDocument,
      "background" | "name" | "width" | "height" | "viewBox"
    >
  >;
};

export type PatchOperation =
  | InsertPatch
  | UpdatePatch
  | DeletePatch
  | MovePatch
  | UpdateDocumentPatch;

export type Selection = {
  nodeIds: NodeId[];
};

export type CreateDocumentOptions = {
  background?: DocumentBackground;
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  viewBox?: ViewBox;
};

export type CreatePageOptions = CreateDocumentOptions & {
  pageId?: string;
};

export type CreateProjectOptions = {
  id?: string;
  name?: string;
  pageId?: string;
  documentId?: string;
  projectPrompt?: string;
  width?: number;
  height?: number;
  viewBox?: ViewBox;
};

export function createDocument(
  options: CreateDocumentOptions = {},
): GeometryDocument {
  return {
    id: options.id ?? "document-1",
    name: options.name ?? "Untitled",
    width: options.width ?? 1024,
    height: options.height ?? 768,
    ...(options.viewBox ? { viewBox: { ...options.viewBox } } : {}),
    background: options.background,
    root: {
      id: "root",
      type: "group",
      name: "Root",
      children: [],
    },
    comments: [],
  };
}

export function getDocumentViewBox(document: GeometryDocument): ViewBox {
  return (
    document.viewBox ?? {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    }
  );
}

export function createPage(options: CreatePageOptions = {}): GlyphSmithPage {
  const pageId = options.pageId ?? "page-1";
  const name = options.name ?? "Page 1";

  return {
    id: pageId,
    name,
    document: createDocument({
      id: options.id ?? `${pageId}-document`,
      name,
      width: options.width,
      height: options.height,
      viewBox: options.viewBox,
    }),
  };
}

export function createProject(
  options: CreateProjectOptions = {},
): GlyphSmithProject {
  const firstPage = createPage({
    pageId: options.pageId,
    id: options.documentId,
    name: "Page 1",
    width: options.width,
    height: options.height,
    viewBox: options.viewBox,
  });
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    id: options.id ?? "project-1",
    name: options.name ?? "Untitled Project",
    activePageId: firstPage.id,
    projectPrompt: options.projectPrompt,
    settings: {
      defaultCanvas: {
        width: options.width ?? 1024,
        height: options.height ?? 768,
      },
    },
    pages: [firstPage],
    createdAt: now,
    updatedAt: now,
  };
}

export function isGlyphSmithProject(
  value: unknown,
): value is GlyphSmithProject {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string"
  ) {
    return false;
  }

  if (
    typeof value.activePageId !== "string" ||
    !Array.isArray(value.pages) ||
    value.pages.length === 0
  ) {
    return false;
  }

  if (
    "projectPrompt" in value &&
    value.projectPrompt !== undefined &&
    typeof value.projectPrompt !== "string"
  ) {
    return false;
  }

  if (
    "settings" in value &&
    value.settings !== undefined &&
    !isProjectSettings(value.settings)
  ) {
    return false;
  }

  return (
    value.pages.every(isGlyphSmithPage) &&
    value.pages.some((page) => page.id === value.activePageId)
  );
}

function isProjectSettings(value: unknown): value is ProjectSettings {
  if (!isRecord(value)) {
    return false;
  }

  if ("defaultCanvas" in value && value.defaultCanvas !== undefined) {
    const defaultCanvas = value.defaultCanvas;

    return (
      isRecord(defaultCanvas) &&
      typeof defaultCanvas.width === "number" &&
      Number.isFinite(defaultCanvas.width) &&
      defaultCanvas.width >= 1 &&
      typeof defaultCanvas.height === "number" &&
      Number.isFinite(defaultCanvas.height) &&
      defaultCanvas.height >= 1
    );
  }

  return true;
}

function isGlyphSmithPage(value: unknown): value is GlyphSmithPage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isGeometryDocument(value.document)
  );
}

function isGeometryDocument(value: unknown): value is GeometryDocument {
  if (!isRecord(value) || !isRecord(value.root)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    (!("viewBox" in value) ||
      value.viewBox === undefined ||
      isViewBox(value.viewBox)) &&
    value.root.type === "group" &&
    typeof value.root.id === "string" &&
    Array.isArray(value.root.children) &&
    Array.isArray(value.comments)
  );
}

function isViewBox(value: unknown): value is ViewBox {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
