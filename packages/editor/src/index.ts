import { getDocumentViewBox } from "@glyphsmith/ast";
import type {
  Bounds,
  DocumentBackground,
  GeometryDocument,
  GeometryNode,
  GroupNode,
  InsertPatch,
  LineNode,
  NodeId,
  NodeStyle,
  PathNode,
  PathSpline,
  Point,
  PolygonNode,
  RectNode,
  Segment,
  TextNode,
  UpdatePatch,
} from "@glyphsmith/ast";

export type Tool = "select" | "rect" | "ellipse" | "triangle" | "path" | "text";
export type PathSegmentMode =
  | "line"
  | "quadratic"
  | "cubic"
  | "arc"
  | "catmullRom"
  | "basis";

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export const viewportZoomLimits = {
  min: 0.1,
  max: 64,
} as const;

export type ViewportSize = {
  width: number;
  height: number;
};

export type RenderOptions = {
  selectedNodeIds?: NodeId[];
  background?: string;
  pixelRatio?: number;
  showEditHandles?: boolean;
};

export type HitTestOptions = {
  tolerance?: number;
};

export type EditHandleKind =
  | "bbox-top-left"
  | "bbox-top"
  | "bbox-top-right"
  | "bbox-right"
  | "bbox-bottom-right"
  | "bbox-bottom"
  | "bbox-bottom-left"
  | "bbox-left"
  | "rect-top-left"
  | "rect-top-right"
  | "rect-bottom-right"
  | "rect-bottom-left"
  | "line-start"
  | "line-end"
  | "path-start"
  | "path-segment-end"
  | "path-spline-point"
  | "path-quadratic-control"
  | "path-cubic-control-1"
  | "path-cubic-control-2"
  | "path-arc-control"
  | "ellipse-left"
  | "ellipse-top"
  | "ellipse-right"
  | "ellipse-bottom"
  | "polygon-point";

export type EditHandle = {
  nodeId: NodeId;
  kind: EditHandleKind;
  point: Point;
  segmentIndex?: number;
  pointIndex?: number;
};

export type SnapPoint = {
  nodeId: NodeId;
  point: Point;
};

export const defaultStyle: NodeStyle = {
  fill: "none",
  stroke: "#111827",
  strokeWidth: 2,
};

/** Persist interactive geometry with a stable, human-readable precision. */
export const coordinateDecimalPlaces = 3;

export function roundGeometryDocument(
  document: GeometryDocument,
  nodeIds: readonly NodeId[],
  decimalPlaces = coordinateDecimalPlaces,
): GeometryDocument {
  const roundedNodeIds = new Set(nodeIds);

  return {
    ...document,
    root: roundGeometryNode(document.root, roundedNodeIds, decimalPlaces),
  };
}

function roundGeometryNode(
  node: GroupNode,
  nodeIds: ReadonlySet<NodeId>,
  decimalPlaces: number,
  roundDescendants?: boolean,
): GroupNode;
function roundGeometryNode(
  node: GeometryNode,
  nodeIds: ReadonlySet<NodeId>,
  decimalPlaces: number,
  roundDescendants?: boolean,
): GeometryNode;
function roundGeometryNode(
  node: GeometryNode,
  nodeIds: ReadonlySet<NodeId>,
  decimalPlaces: number,
  roundDescendants = false,
): GeometryNode {
  const shouldRound = roundDescendants || nodeIds.has(node.id);

  if (node.type === "group") {
    return {
      ...node,
      children: node.children.map((child) =>
        roundGeometryNode(child, nodeIds, decimalPlaces, shouldRound),
      ),
    } satisfies GroupNode;
  }

  if (!shouldRound) {
    return node;
  }

  switch (node.type) {
    case "rect":
      return {
        ...node,
        x: roundCoordinate(node.x, decimalPlaces),
        y: roundCoordinate(node.y, decimalPlaces),
        width: roundCoordinate(node.width, decimalPlaces),
        height: roundCoordinate(node.height, decimalPlaces),
        ...(node.rx === undefined
          ? {}
          : { rx: roundCoordinate(node.rx, decimalPlaces) }),
        ...(node.ry === undefined
          ? {}
          : { ry: roundCoordinate(node.ry, decimalPlaces) }),
      };
    case "circle":
      return {
        ...node,
        cx: roundCoordinate(node.cx, decimalPlaces),
        cy: roundCoordinate(node.cy, decimalPlaces),
        r: roundCoordinate(node.r, decimalPlaces),
      };
    case "ellipse":
      return {
        ...node,
        cx: roundCoordinate(node.cx, decimalPlaces),
        cy: roundCoordinate(node.cy, decimalPlaces),
        rx: roundCoordinate(node.rx, decimalPlaces),
        ry: roundCoordinate(node.ry, decimalPlaces),
      };
    case "line":
      return {
        ...node,
        x1: roundCoordinate(node.x1, decimalPlaces),
        y1: roundCoordinate(node.y1, decimalPlaces),
        x2: roundCoordinate(node.x2, decimalPlaces),
        y2: roundCoordinate(node.y2, decimalPlaces),
      };
    case "polygon":
    case "polyline":
      return {
        ...node,
        points: node.points.map((point) => roundPoint(point, decimalPlaces)),
      };
    case "path":
      return {
        ...node,
        start: roundPoint(node.start, decimalPlaces),
        segments: node.segments.map((segment) =>
          roundSegment(segment, decimalPlaces),
        ),
        ...(node.spline
          ? {
              spline: {
                ...node.spline,
                points: node.spline.points.map((point) =>
                  roundPoint(point, decimalPlaces),
                ),
              },
            }
          : {}),
      };
    case "text":
      return {
        ...node,
        x: roundCoordinate(node.x, decimalPlaces),
        y: roundCoordinate(node.y, decimalPlaces),
        ...(node.runs
          ? {
              runs: node.runs.map((run) => ({
                ...run,
                ...(run.dx === undefined
                  ? {}
                  : { dx: roundCoordinate(run.dx, decimalPlaces) }),
                ...(run.dy === undefined
                  ? {}
                  : { dy: roundCoordinate(run.dy, decimalPlaces) }),
                ...(run.x === undefined
                  ? {}
                  : { x: roundCoordinate(run.x, decimalPlaces) }),
                ...(run.y === undefined
                  ? {}
                  : { y: roundCoordinate(run.y, decimalPlaces) }),
              })),
            }
          : {}),
      };
  }
}

function roundSegment(segment: Segment, decimalPlaces: number): Segment {
  switch (segment.type) {
    case "line":
      return { ...segment, to: roundPoint(segment.to, decimalPlaces) };
    case "quadratic":
      return {
        ...segment,
        control: roundPoint(segment.control, decimalPlaces),
        to: roundPoint(segment.to, decimalPlaces),
      };
    case "cubic":
      return {
        ...segment,
        control1: roundPoint(segment.control1, decimalPlaces),
        control2: roundPoint(segment.control2, decimalPlaces),
        to: roundPoint(segment.to, decimalPlaces),
      };
    case "arc":
      return {
        ...segment,
        rx: roundCoordinate(segment.rx, decimalPlaces),
        ry: roundCoordinate(segment.ry, decimalPlaces),
        xAxisRotation: roundCoordinate(segment.xAxisRotation, decimalPlaces),
        to: roundPoint(segment.to, decimalPlaces),
      };
  }
}

function roundPoint(point: Point, decimalPlaces: number): Point {
  return {
    x: roundCoordinate(point.x, decimalPlaces),
    y: roundCoordinate(point.y, decimalPlaces),
  };
}

function roundCoordinate(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = 10 ** Math.max(0, decimalPlaces);
  const rounded = Math.round(value * factor) / factor;

  return Object.is(rounded, -0) ? 0 : rounded;
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function panViewport(viewport: Viewport, delta: Point): Viewport {
  return {
    ...viewport,
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
  };
}

export function zoomViewportAtPoint(
  viewport: Viewport,
  screenPoint: Point,
  nextZoom: number,
): Viewport {
  const zoom = clamp(nextZoom, viewportZoomLimits.min, viewportZoomLimits.max);
  const worldPoint = screenToWorld(screenPoint, viewport);

  return {
    x: screenPoint.x - worldPoint.x * zoom,
    y: screenPoint.y - worldPoint.y * zoom,
    zoom,
  };
}

export function fitViewportToDocument(
  document: GeometryDocument,
  viewportSize: ViewportSize,
  padding = 48,
): Viewport {
  const viewBox = getDocumentViewBox(document);
  const availableWidth = Math.max(1, viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, viewportSize.height - padding * 2);
  const zoom = clamp(
    Math.min(availableWidth / viewBox.width, availableHeight / viewBox.height),
    viewportZoomLimits.min,
    viewportZoomLimits.max,
  );

  return {
    x: (viewportSize.width - viewBox.width * zoom) / 2 - viewBox.x * zoom,
    y: (viewportSize.height - viewBox.height * zoom) / 2 - viewBox.y * zoom,
    zoom,
  };
}

export function renderDocument(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
  viewport: Viewport,
  options: RenderOptions = {},
): void {
  const canvas = context.canvas;
  const pixelRatio = options.pixelRatio ?? 1;
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = options.background ?? "#f8fafc";
  context.fillRect(0, 0, width, height);
  context.restore();

  context.save();
  context.setTransform(
    viewport.zoom * pixelRatio,
    0,
    0,
    viewport.zoom * pixelRatio,
    viewport.x * pixelRatio,
    viewport.y * pixelRatio,
  );
  context.setLineDash([]);
  drawDocumentBackground(context, document);

  for (const child of document.root.children) {
    drawNode(context, child);
  }

  context.restore();

  drawPageBorder(context, document, viewport, pixelRatio);

  for (const nodeId of options.selectedNodeIds ?? []) {
    const bounds = getNodeBounds(document, nodeId);

    if (bounds) {
      drawSelection(context, bounds, viewport, pixelRatio);
    }
  }

  if (options.showEditHandles) {
    drawPathControlGuides(
      context,
      document,
      options.selectedNodeIds ?? [],
      viewport,
      pixelRatio,
    );
    drawTextAnchorGuides(
      context,
      document,
      options.selectedNodeIds ?? [],
      viewport,
      pixelRatio,
    );
    drawEditHandles(
      context,
      getEditHandles(document, options.selectedNodeIds ?? []),
      viewport,
      pixelRatio,
    );
  }
}

export function hitTest(
  document: GeometryDocument,
  point: Point,
  options: HitTestOptions = {},
): NodeId | undefined {
  const tolerance = options.tolerance ?? 6;

  // Canvas draws later siblings on top, so hit testing must walk siblings
  // in the opposite order to match the visual layer stack.
  for (let index = document.root.children.length - 1; index >= 0; index -= 1) {
    const hit = hitTestNode(document.root.children[index], point, tolerance);

    if (hit) {
      return hit;
    }
  }

  return undefined;
}

export function createRectInsertPatch(input: {
  id: NodeId;
  parentId?: NodeId;
  start: Point;
  end: Point;
  style?: NodeStyle;
}): InsertPatch {
  const bounds = normalizeBounds(input.start, input.end);

  return {
    op: "insert",
    parentId: input.parentId ?? "root",
    node: {
      id: input.id,
      type: "rect",
      name: "Rectangle",
      ...bounds,
      style: input.style ?? defaultStyle,
    },
  };
}

export function createEllipseInsertPatch(input: {
  id: NodeId;
  parentId?: NodeId;
  start: Point;
  end: Point;
  style?: NodeStyle;
}): InsertPatch {
  const bounds = normalizeBounds(input.start, input.end);

  return {
    op: "insert",
    parentId: input.parentId ?? "root",
    node: {
      id: input.id,
      type: "ellipse",
      name: "Ellipse",
      cx: bounds.x + bounds.width / 2,
      cy: bounds.y + bounds.height / 2,
      rx: bounds.width / 2,
      ry: bounds.height / 2,
      style: input.style ?? defaultStyle,
    },
  };
}

export function createTriangleInsertPatch(input: {
  id: NodeId;
  parentId?: NodeId;
  start: Point;
  end: Point;
  style?: NodeStyle;
}): InsertPatch {
  return {
    op: "insert",
    parentId: input.parentId ?? "root",
    node: {
      id: input.id,
      type: "polygon",
      name: "Triangle",
      points: trianglePointsFromBounds(input.start, input.end),
      style: input.style ?? defaultStyle,
    },
  };
}

export function trianglePointsFromBounds(start: Point, end: Point): Point[] {
  const bounds = normalizeBounds(start, end);

  return [
    { x: bounds.x + bounds.width / 2, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

export function createLineInsertPatch(input: {
  id: NodeId;
  parentId?: NodeId;
  start: Point;
  end: Point;
  style?: NodeStyle;
}): InsertPatch {
  return {
    op: "insert",
    parentId: input.parentId ?? "root",
    node: {
      id: input.id,
      type: "line",
      name: "Line",
      x1: input.start.x,
      y1: input.start.y,
      x2: input.end.x,
      y2: input.end.y,
      style: input.style ?? defaultStyle,
    },
  };
}

export function createLinePathInsertPatch(input: {
  id: NodeId;
  parentId?: NodeId;
  start: Point;
  end: Point;
  segmentMode?: PathSegmentMode;
  style?: NodeStyle;
}): InsertPatch {
  const segmentMode = input.segmentMode ?? "line";
  const basisGeometry =
    segmentMode === "basis"
      ? createBasisSplinePathGeometry([input.start, input.end])
      : undefined;

  return {
    op: "insert",
    parentId: input.parentId ?? "root",
    node: {
      id: input.id,
      type: "path",
      name: "Path",
      start: basisGeometry?.start ?? input.start,
      closed: false,
      segments: basisGeometry?.segments ?? [
        createSegment(input.start, input.end, segmentMode),
      ],
      spline: basisGeometry?.spline,
      style: input.style ?? defaultStyle,
    },
  };
}

export function createAppendPathSegmentPatch(
  document: GeometryDocument,
  nodeId: NodeId,
  end: Point,
  segmentMode: PathSegmentMode,
): UpdatePatch | undefined {
  const node = findNodeInTree(document.root, nodeId);

  if (!node || node.type !== "path") {
    return undefined;
  }

  if (segmentMode === "basis") {
    const basisGeometry = createBasisSplinePathGeometry([
      ...getBasisControlPoints(node),
      end,
    ]);

    return {
      op: "update",
      target: nodeId,
      changes: basisGeometry,
    };
  }

  const start = getPathEndPoint(node);
  const previous = getPathPointBeforeEnd(node);
  const tangent = getPathEndTangent(node);
  const segments =
    segmentMode === "catmullRom"
      ? appendCatmullRomSegment(node, end)
      : [
          ...node.segments,
          createSegment(start, end, segmentMode, previous, tangent),
        ];

  return {
    op: "update",
    target: nodeId,
    changes: {
      segments,
    },
  };
}

export function createAppendLineSegmentPatch(
  document: GeometryDocument,
  nodeId: NodeId,
  end: Point,
): UpdatePatch | undefined {
  return createAppendPathSegmentPatch(document, nodeId, end, "line");
}

export function createPathClosedUpdatePatch(
  document: GeometryDocument,
  nodeId: NodeId,
  closed: boolean,
): UpdatePatch | undefined {
  const node = findNodeInTree(document.root, nodeId);

  if (!node || node.type !== "path") {
    return undefined;
  }

  return {
    op: "update",
    target: nodeId,
    changes: {
      closed,
    },
  };
}

export function getNodeBounds(
  document: GeometryDocument,
  nodeId: NodeId,
): Bounds | undefined {
  return getNodeBoundsInTree(document.root, nodeId);
}

export function getEditHandles(
  document: GeometryDocument,
  nodeIds: NodeId[],
): EditHandle[] {
  return nodeIds.flatMap((nodeId) => {
    const node = findNodeInTree(document.root, nodeId);

    if (!node) {
      return [];
    }

    return handlesForNode(node);
  });
}

export function hitTestEditHandle(
  document: GeometryDocument,
  nodeIds: NodeId[],
  point: Point,
  tolerance: number,
): EditHandle | undefined {
  const handles = getEditHandles(document, nodeIds);

  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index];

    if (handle && distance(handle.point, point) <= tolerance) {
      return handle;
    }
  }

  return undefined;
}

export function getSnapPoints(document: GeometryDocument): SnapPoint[] {
  return snapPointsForNode(document.root);
}

export function snapPointToExistingVertex(
  document: GeometryDocument,
  point: Point,
  tolerance: number,
): SnapPoint | undefined {
  let nearest: SnapPoint | undefined;
  let nearestDistance = tolerance;

  for (const snapPoint of getSnapPoints(document)) {
    const candidateDistance = distance(point, snapPoint.point);

    if (candidateDistance <= nearestDistance) {
      nearest = snapPoint;
      nearestDistance = candidateDistance;
    }
  }

  return nearest;
}

export function createEditHandleUpdatePatch(
  document: GeometryDocument,
  handle: EditHandle,
  point: Point,
): UpdatePatch | undefined {
  const node = findNodeInTree(document.root, handle.nodeId);

  if (!node) {
    return undefined;
  }

  if (isBBoxHandleKind(handle.kind)) {
    return createBBoxResizeUpdatePatch(node, handle.kind, point);
  }

  if (node.type === "rect") {
    return createRectHandleUpdatePatch(node, handle.kind, point);
  }

  if (node.type === "line") {
    return createLineHandleUpdatePatch(node, handle.kind, point);
  }

  if (node.type === "path") {
    return createPathHandleUpdatePatch(node, handle, point);
  }

  if (node.type === "ellipse") {
    return createEllipseHandleUpdatePatch(node, handle.kind, point);
  }

  if (node.type === "polygon" || node.type === "polyline") {
    return createPolygonHandleUpdatePatch(node, handle, point);
  }

  return undefined;
}

export function normalizeBounds(start: Point, end: Point): Bounds {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function drawPageBorder(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
  viewport: Viewport,
  pixelRatio: number,
): void {
  const viewBox = getDocumentViewBox(document);

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.strokeStyle = "#d1d5db";
  context.lineWidth = 1;
  context.strokeRect(
    viewport.x + viewBox.x * viewport.zoom,
    viewport.y + viewBox.y * viewport.zoom,
    viewBox.width * viewport.zoom,
    viewBox.height * viewport.zoom,
  );
  context.restore();
}

function drawDocumentBackground(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
): void {
  const viewBox = getDocumentViewBox(document);
  const background = document.background ?? { type: "solid", color: "#ffffff" };

  if (background.type === "checkerboard") {
    drawCheckerboardBackground(context, document, background);
    return;
  }

  context.fillStyle = background.color;
  context.fillRect(viewBox.x, viewBox.y, viewBox.width, viewBox.height);
}

function drawCheckerboardBackground(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
  background: Extract<DocumentBackground, { type: "checkerboard" }>,
): void {
  const viewBox = getDocumentViewBox(document);
  const size = Math.max(1, background.size ?? 32);
  const light = background.light ?? "#f8fafc";
  const dark = background.dark ?? "#cfd8df";

  context.fillStyle = light;
  context.fillRect(viewBox.x, viewBox.y, viewBox.width, viewBox.height);

  context.fillStyle = dark;

  for (let y = viewBox.y; y < viewBox.y + viewBox.height; y += size) {
    for (let x = viewBox.x; x < viewBox.x + viewBox.width; x += size) {
      if (
        (Math.floor((x - viewBox.x) / size) +
          Math.floor((y - viewBox.y) / size)) %
          2 ===
        0
      ) {
        continue;
      }

      context.fillRect(
        x,
        y,
        Math.min(size, viewBox.x + viewBox.width - x),
        Math.min(size, viewBox.y + viewBox.height - y),
      );
    }
  }
}

function drawNode(context: CanvasRenderingContext2D, node: GeometryNode): void {
  if (node.visible === false) {
    return;
  }

  context.save();
  applyStyle(context, node.style);

  switch (node.type) {
    case "group":
      for (const child of node.children) {
        drawNode(context, child);
      }
      break;
    case "rect":
      drawRect(context, node);
      break;
    case "circle":
      context.beginPath();
      context.arc(node.cx, node.cy, node.r, 0, Math.PI * 2);
      paintCurrentPath(context, node.style);
      break;
    case "ellipse":
      context.beginPath();
      context.ellipse(node.cx, node.cy, node.rx, node.ry, 0, 0, Math.PI * 2);
      paintCurrentPath(context, node.style);
      break;
    case "line":
      context.beginPath();
      context.moveTo(node.x1, node.y1);
      context.lineTo(node.x2, node.y2);
      context.stroke();
      break;
    case "polygon":
    case "polyline":
      drawPoints(context, node.points, node.type === "polygon", node.style);
      break;
    case "path":
      drawPath(context, node);
      paintCurrentPath(context, node.style);
      break;
    case "text":
      drawText(context, node);
      break;
  }

  context.restore();
}

function drawText(context: CanvasRenderingContext2D, node: TextNode): void {
  const fontSize = node.fontSize ?? 16;
  const fontFamily = node.fontFamily ?? "Inter, system-ui, sans-serif";
  const fontStyle = node.fontStyle ?? "normal";
  const fontWeight = node.fontWeight ?? "400";
  const lines = textLines(node.text);
  const lineHeight = textLineHeight(fontSize);
  const startY = textStartY(node, fontSize, lineHeight, lines.length);

  context.globalAlpha = node.style?.opacity ?? node.opacity ?? 1;
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  context.textAlign = canvasTextAlign(node.textAnchor);
  context.textBaseline = canvasTextBaseline(node.dominantBaseline);

  if ((node.style?.fill ?? node.fill ?? "#111827") !== "none") {
    context.fillStyle = node.style?.fill ?? node.fill ?? "#111827";

    for (const [index, line] of lines.entries()) {
      context.fillText(line, node.x, startY + lineHeight * index);
    }
  }

  if ((node.style?.stroke ?? node.stroke ?? "none") !== "none") {
    context.strokeStyle = node.style?.stroke ?? node.stroke ?? "none";
    context.lineWidth = node.style?.strokeWidth ?? node.strokeWidth ?? 1;

    for (const [index, line] of lines.entries()) {
      context.strokeText(line, node.x, startY + lineHeight * index);
    }
  }
}

function textLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function textLineHeight(fontSize: number): number {
  return fontSize * 1.2;
}

function textStartY(
  node: TextNode,
  fontSize: number,
  lineHeight: number,
  lineCount: number,
): number {
  if (
    node.dominantBaseline === "middle" ||
    node.dominantBaseline === "central"
  ) {
    return node.y - ((lineCount - 1) * lineHeight) / 2;
  }

  if (
    node.dominantBaseline === "bottom" ||
    node.dominantBaseline === "ideographic"
  ) {
    return node.y - (lineCount - 1) * lineHeight;
  }

  return node.y;
}

function canvasTextAlign(
  value: TextNode["textAnchor"] | undefined,
): CanvasTextAlign {
  if (value === "middle") {
    return "center";
  }

  if (value === "end") {
    return "end";
  }

  return "start";
}

function canvasTextBaseline(value: string | undefined): CanvasTextBaseline {
  switch (value) {
    case "hanging":
    case "middle":
    case "ideographic":
    case "top":
    case "bottom":
      return value;
    case "central":
      return "middle";
    default:
      return "alphabetic";
  }
}

function drawRect(context: CanvasRenderingContext2D, node: RectNode): void {
  context.beginPath();

  const rx = node.rx ?? node.ry ?? 0;
  const ry = node.ry ?? node.rx ?? 0;

  if (rx > 0 || ry > 0) {
    context.roundRect(node.x, node.y, node.width, node.height, [rx, ry]);
  } else {
    context.rect(node.x, node.y, node.width, node.height);
  }

  paintCurrentPath(context, node.style);
}

function drawPoints(
  context: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  style: NodeStyle | undefined,
): void {
  if (points.length === 0 || !points[0]) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }

  if (closed) {
    context.closePath();
  }

  paintCurrentPath(context, style);
}

function drawPath(context: CanvasRenderingContext2D, node: PathNode): void {
  context.beginPath();
  context.moveTo(node.start.x, node.start.y);

  let current = node.start;

  for (const segment of node.segments) {
    switch (segment.type) {
      case "line":
        context.lineTo(segment.to.x, segment.to.y);
        break;
      case "quadratic":
        context.quadraticCurveTo(
          segment.control.x,
          segment.control.y,
          segment.to.x,
          segment.to.y,
        );
        break;
      case "cubic":
        context.bezierCurveTo(
          segment.control1.x,
          segment.control1.y,
          segment.control2.x,
          segment.control2.y,
          segment.to.x,
          segment.to.y,
        );
        break;
      case "arc":
        drawArcSegment(context, current, segment);
        break;
    }

    current = segment.to;
  }

  if (node.closed) {
    context.closePath();
  }
}

export function drawArcSegment(
  context: CanvasRenderingContext2D,
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
): void {
  const parameters = arcCenterParameters(start, segment);

  if (!parameters) {
    context.lineTo(segment.to.x, segment.to.y);
    return;
  }

  context.ellipse(
    parameters.cx,
    parameters.cy,
    parameters.rx,
    parameters.ry,
    parameters.phi,
    parameters.startAngle,
    parameters.startAngle + parameters.deltaAngle,
    !segment.sweep,
  );
}

function arcCenterParameters(
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
):
  | {
      cx: number;
      cy: number;
      deltaAngle: number;
      phi: number;
      rx: number;
      ry: number;
      startAngle: number;
    }
  | undefined {
  const rx = Math.max(Math.abs(segment.rx), 0.001);
  const ry = Math.max(Math.abs(segment.ry), 0.001);
  const phi = (segment.xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (start.x - segment.to.x) / 2;
  const dy = (start.y - segment.to.y) / 2;
  let x1p = cosPhi * dx + sinPhi * dy;
  let y1p = -sinPhi * dx + cosPhi * dy;
  let adjustedRx = rx;
  let adjustedRy = ry;
  const lambda =
    (x1p * x1p) / (adjustedRx * adjustedRx) +
    (y1p * y1p) / (adjustedRy * adjustedRy);

  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    adjustedRx *= scale;
    adjustedRy *= scale;
  }

  const sign = segment.largeArc === segment.sweep ? -1 : 1;
  const numerator =
    adjustedRx * adjustedRx * adjustedRy * adjustedRy -
    adjustedRx * adjustedRx * y1p * y1p -
    adjustedRy * adjustedRy * x1p * x1p;
  const denominator =
    adjustedRx * adjustedRx * y1p * y1p + adjustedRy * adjustedRy * x1p * x1p;

  if (denominator === 0) {
    return undefined;
  }

  const coef = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coef * adjustedRx * y1p) / adjustedRy;
  const cyp = (-coef * adjustedRy * x1p) / adjustedRx;
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + segment.to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + segment.to.y) / 2;
  const startAngle = vectorAngle(
    1,
    0,
    (x1p - cxp) / adjustedRx,
    (y1p - cyp) / adjustedRy,
  );
  let deltaAngle = vectorAngle(
    (x1p - cxp) / adjustedRx,
    (y1p - cyp) / adjustedRy,
    (-x1p - cxp) / adjustedRx,
    (-y1p - cyp) / adjustedRy,
  );

  if (!segment.sweep && deltaAngle > 0) {
    deltaAngle -= Math.PI * 2;
  }

  if (segment.sweep && deltaAngle < 0) {
    deltaAngle += Math.PI * 2;
  }

  return {
    cx,
    cy,
    deltaAngle,
    phi,
    rx: adjustedRx,
    ry: adjustedRy,
    startAngle,
  };
}

function pointOnArc(
  parameters: NonNullable<ReturnType<typeof arcCenterParameters>>,
  amount: number,
): Point {
  const angle = parameters.startAngle + parameters.deltaAngle * amount;
  const cosPhi = Math.cos(parameters.phi);
  const sinPhi = Math.sin(parameters.phi);
  const x = parameters.rx * Math.cos(angle);
  const y = parameters.ry * Math.sin(angle);

  return {
    x: parameters.cx + x * cosPhi - y * sinPhi,
    y: parameters.cy + x * sinPhi + y * cosPhi,
  };
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  const dot = ux * vx + uy * vy;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);

  return sign * Math.acos(clamp(dot / length, -1, 1));
}

function applyStyle(
  context: CanvasRenderingContext2D,
  style: NodeStyle | undefined,
): void {
  context.fillStyle =
    style?.fill && style.fill !== "none" ? style.fill : "transparent";
  context.strokeStyle =
    style?.stroke && style.stroke !== "none" ? style.stroke : "transparent";
  context.lineWidth = style?.strokeWidth ?? 2;
  context.lineCap = canvasLineCap(style?.strokeLinecap);
  context.lineJoin = canvasLineJoin(style?.strokeLinejoin);
  context.miterLimit = style?.strokeMiterlimit ?? 4;
  context.setLineDash(parseStrokeDasharray(style?.strokeDasharray));
  context.lineDashOffset = style?.strokeDashoffset ?? 0;
  context.globalAlpha = style?.opacity ?? 1;
}

function canvasLineCap(
  value: NodeStyle["strokeLinecap"] | undefined,
): CanvasLineCap {
  if (value === "round" || value === "square") {
    return value;
  }

  return "butt";
}

function canvasLineJoin(
  value: NodeStyle["strokeLinejoin"] | undefined,
): CanvasLineJoin {
  if (value === "bevel" || value === "round") {
    return value;
  }

  return "miter";
}

function parseStrokeDasharray(value: string | undefined): number[] {
  const trimmedValue = value?.trim();

  if (!trimmedValue || trimmedValue === "none") {
    return [];
  }

  const dash = trimmedValue
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part >= 0);

  return dash.some((part) => part > 0) ? dash : [];
}

function paintCurrentPath(
  context: CanvasRenderingContext2D,
  style: NodeStyle | undefined,
): void {
  if (style?.fill && style.fill !== "none") {
    context.fill();
  }

  if (style?.stroke !== "none") {
    context.stroke();
  }
}

function drawSelection(
  context: CanvasRenderingContext2D,
  bounds: Bounds,
  viewport: Viewport,
  pixelRatio: number,
): void {
  const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, viewport);
  const bottomRight = worldToScreen(
    {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    },
    viewport,
  );

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.strokeStyle = "#2563eb";
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );

  context.restore();
}

function drawEditHandles(
  context: CanvasRenderingContext2D,
  handles: EditHandle[],
  viewport: Viewport,
  pixelRatio: number,
): void {
  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 1;

  for (const handle of handles) {
    const screenPoint = worldToScreen(handle.point, viewport);

    context.fillStyle = isPathControlHandleKind(handle.kind)
      ? "#fecdd3"
      : "#60a5fa";
    context.strokeStyle = isPathControlHandleKind(handle.kind)
      ? "#ef4444"
      : "#0f172a";
    context.beginPath();
    context.rect(screenPoint.x - 4, screenPoint.y - 4, 8, 8);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function isPathControlHandleKind(kind: EditHandleKind): boolean {
  return (
    kind === "path-quadratic-control" ||
    kind === "path-cubic-control-1" ||
    kind === "path-cubic-control-2" ||
    kind === "path-arc-control"
  );
}

function drawPathControlGuides(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
  nodeIds: NodeId[],
  viewport: Viewport,
  pixelRatio: number,
): void {
  context.save();
  context.setTransform(
    viewport.zoom * pixelRatio,
    0,
    0,
    viewport.zoom * pixelRatio,
    viewport.x * pixelRatio,
    viewport.y * pixelRatio,
  );
  context.strokeStyle = "#fb7185";
  context.lineWidth = 1 / viewport.zoom;

  for (const nodeId of nodeIds) {
    const node = findNodeInTree(document.root, nodeId);

    if (!node || node.type !== "path") {
      continue;
    }

    if (node.spline?.type === "basis") {
      drawBasisControlPolygon(context, node.spline.points);
      continue;
    }

    let current = node.start;

    for (const segment of node.segments) {
      if (segment.type === "quadratic") {
        drawGuideLine(context, current, segment.control);
        drawGuideLine(context, segment.to, segment.control);
      }

      if (segment.type === "cubic") {
        drawGuideLine(context, current, segment.control1);
        drawGuideLine(context, segment.to, segment.control2);
      }

      current = segment.to;
    }
  }

  context.restore();
}

function drawGuideLine(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
): void {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function drawBasisControlPolygon(
  context: CanvasRenderingContext2D,
  points: Point[],
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (start && end) {
      drawGuideLine(context, start, end);
    }
  }
}

function drawTextAnchorGuides(
  context: CanvasRenderingContext2D,
  document: GeometryDocument,
  nodeIds: NodeId[],
  viewport: Viewport,
  pixelRatio: number,
): void {
  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 1;

  for (const nodeId of nodeIds) {
    const node = findNodeInTree(document.root, nodeId);

    if (!node || node.type !== "text") {
      continue;
    }

    const bounds = boundsForTextNode(node);
    const anchor = worldToScreen({ x: node.x, y: node.y }, viewport);
    const guideStart = worldToScreen({ x: bounds.x, y: node.y }, viewport);
    const guideEnd = worldToScreen(
      { x: bounds.x + bounds.width, y: node.y },
      viewport,
    );

    context.strokeStyle = "#f59e0b";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(guideStart.x, guideStart.y);
    context.lineTo(guideEnd.x, guideEnd.y);
    context.stroke();

    context.setLineDash([]);
    context.fillStyle = "#fef3c7";
    context.strokeStyle = "#d97706";
    context.beginPath();
    context.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.beginPath();
    context.moveTo(anchor.x - 8, anchor.y);
    context.lineTo(anchor.x + 8, anchor.y);
    context.moveTo(anchor.x, anchor.y - 8);
    context.lineTo(anchor.x, anchor.y + 8);
    context.stroke();
  }

  context.restore();
}

function hitTestNode(
  node: GeometryNode | undefined,
  point: Point,
  tolerance: number,
): NodeId | undefined {
  if (!node || node.visible === false) {
    return undefined;
  }

  if (node.type === "group") {
    // Later children are visually in front of earlier children.
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const hit = hitTestNode(node.children[index], point, tolerance);

      if (hit) {
        return hit;
      }
    }

    return undefined;
  }

  if (isPointNearNode(node, point, tolerance)) {
    return node.id;
  }

  return undefined;
}

function isPointNearNode(
  node: GeometryNode,
  point: Point,
  tolerance: number,
): boolean {
  const outlineTolerance = strokeHitTolerance(node, tolerance);

  switch (node.type) {
    case "rect":
      return hasVisibleFill(node)
        ? isPointInsideBounds(point, node)
        : isPointNearBounds(point, node, outlineTolerance);
    case "circle":
      return hasVisibleFill(node)
        ? distance(point, { x: node.cx, y: node.cy }) <= node.r
        : Math.abs(distance(point, { x: node.cx, y: node.cy }) - node.r) <=
            outlineTolerance;
    case "ellipse":
      return hasVisibleFill(node)
        ? isPointInsideEllipse(point, node)
        : isPointNearEllipse(point, node, outlineTolerance);
    case "line":
      return (
        distanceToSegment(
          point,
          { x: node.x1, y: node.y1 },
          { x: node.x2, y: node.y2 },
        ) <= outlineTolerance
      );
    case "polygon":
      return hasVisibleFill(node)
        ? isPointInsidePolygon(point, node.points) ||
            isPointNearPolyline(point, node.points, true, outlineTolerance)
        : isPointNearPolyline(point, node.points, true, outlineTolerance);
    case "polyline":
      return isPointNearPolyline(point, node.points, false, outlineTolerance);
    case "path":
      return (
        (hasVisibleFill(node) &&
          node.closed &&
          isPointInsidePolygon(point, pathRenderPoints(node))) ||
        isPointNearPath(point, node, outlineTolerance)
      );
    case "text": {
      const bounds = boundsForNode(node);
      return bounds ? isPointInsideBounds(point, bounds) : false;
    }
    case "group":
      return false;
  }
}

function hasVisibleFill(node: GeometryNode): boolean {
  return Boolean(node.style?.fill && node.style.fill !== "none");
}

function hasVisibleStroke(node: GeometryNode): boolean {
  if (node.type === "text") {
    return (node.style?.stroke ?? node.stroke ?? "none") !== "none";
  }

  return node.style?.stroke !== "none";
}

function strokeHitTolerance(node: GeometryNode, tolerance: number): number {
  if (!hasVisibleStroke(node)) {
    return tolerance;
  }

  const strokeWidth =
    node.type === "text"
      ? (node.style?.strokeWidth ??
        node.strokeWidth ??
        defaultStyle.strokeWidth ??
        0)
      : (node.style?.strokeWidth ?? defaultStyle.strokeWidth ?? 0);

  return tolerance + Math.max(0, strokeWidth / 2);
}

function isPointInsideEllipse(
  point: Point,
  ellipse: Extract<GeometryNode, { type: "ellipse" }>,
): boolean {
  if (ellipse.rx <= 0 || ellipse.ry <= 0) {
    return false;
  }

  const normalizedX = (point.x - ellipse.cx) / ellipse.rx;
  const normalizedY = (point.y - ellipse.cy) / ellipse.ry;

  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function isPointNearEllipse(
  point: Point,
  ellipse: Extract<GeometryNode, { type: "ellipse" }>,
  tolerance: number,
): boolean {
  if (ellipse.rx <= 0 || ellipse.ry <= 0) {
    return false;
  }

  const angle = Math.atan2(
    (point.y - ellipse.cy) / ellipse.ry,
    (point.x - ellipse.cx) / ellipse.rx,
  );
  const edgePoint = {
    x: ellipse.cx + Math.cos(angle) * ellipse.rx,
    y: ellipse.cy + Math.sin(angle) * ellipse.ry,
  };

  return distance(point, edgePoint) <= tolerance;
}

function isPointInsidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function getNodeBoundsInTree(
  node: GeometryNode,
  nodeId: NodeId,
): Bounds | undefined {
  if (node.id === nodeId) {
    return boundsForNode(node);
  }

  if (node.type !== "group") {
    return undefined;
  }

  for (const child of node.children) {
    const bounds = getNodeBoundsInTree(child, nodeId);

    if (bounds) {
      return bounds;
    }
  }

  return undefined;
}

function findNodeInTree(
  current: GeometryNode,
  nodeId: NodeId,
): GeometryNode | undefined {
  if (current.id === nodeId) {
    return current;
  }

  if (current.type !== "group") {
    return undefined;
  }

  for (const child of current.children) {
    const match = findNodeInTree(child, nodeId);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function handlesForNode(node: GeometryNode): EditHandle[] {
  if (node.type === "rect") {
    return handlesForBounds(node.id, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
  }

  if (node.type === "line") {
    return [
      {
        nodeId: node.id,
        kind: "line-start",
        point: { x: node.x1, y: node.y1 },
      },
      { nodeId: node.id, kind: "line-end", point: { x: node.x2, y: node.y2 } },
    ];
  }

  if (node.type === "path") {
    if (node.spline?.type === "basis") {
      return node.spline.points.map((point, pointIndex) => ({
        nodeId: node.id,
        kind: "path-spline-point",
        point,
        pointIndex,
      }));
    }

    const handles: EditHandle[] = [
      { nodeId: node.id, kind: "path-start", point: node.start },
      ...node.segments.map((segment, segmentIndex) => ({
        nodeId: node.id,
        kind: "path-segment-end" as const,
        point: segment.to,
        segmentIndex,
      })),
    ];

    let current = node.start;

    node.segments.forEach((segment, segmentIndex) => {
      if (segment.type === "quadratic") {
        handles.push({
          nodeId: node.id,
          kind: "path-quadratic-control",
          point: segment.control,
          segmentIndex,
        });
      }

      if (segment.type === "cubic") {
        handles.push(
          {
            nodeId: node.id,
            kind: "path-cubic-control-1",
            point: segment.control1,
            segmentIndex,
          },
          {
            nodeId: node.id,
            kind: "path-cubic-control-2",
            point: segment.control2,
            segmentIndex,
          },
        );
      }

      if (segment.type === "arc") {
        handles.push({
          nodeId: node.id,
          kind: "path-arc-control",
          point: arcControlPoint(current, segment),
          segmentIndex,
        });
      }

      current = segment.to;
    });

    return handles;
  }

  if (node.type === "ellipse") {
    return handlesForBounds(node.id, {
      x: node.cx - node.rx,
      y: node.cy - node.ry,
      width: node.rx * 2,
      height: node.ry * 2,
    });
  }

  if (node.type === "polygon" || node.type === "polyline") {
    const pointHandles: EditHandle[] = node.points.map((point, pointIndex) => ({
      nodeId: node.id,
      kind: "polygon-point",
      point,
      pointIndex,
    }));
    const bounds = geometryBoundsForNode(node);

    return bounds
      ? [...pointHandles, ...handlesForBounds(node.id, bounds)]
      : pointHandles;
  }

  return [];
}

function handlesForBounds(nodeId: NodeId, bounds: Bounds): EditHandle[] {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  return [
    { nodeId, kind: "bbox-top-left", point: { x: bounds.x, y: bounds.y } },
    { nodeId, kind: "bbox-top", point: { x: centerX, y: bounds.y } },
    { nodeId, kind: "bbox-top-right", point: { x: right, y: bounds.y } },
    { nodeId, kind: "bbox-right", point: { x: right, y: centerY } },
    { nodeId, kind: "bbox-bottom-right", point: { x: right, y: bottom } },
    { nodeId, kind: "bbox-bottom", point: { x: centerX, y: bottom } },
    { nodeId, kind: "bbox-bottom-left", point: { x: bounds.x, y: bottom } },
    { nodeId, kind: "bbox-left", point: { x: bounds.x, y: centerY } },
  ];
}

function snapPointsForNode(node: GeometryNode): SnapPoint[] {
  if (node.visible === false) {
    return [];
  }

  if (node.type === "group") {
    return node.children.flatMap(snapPointsForNode);
  }

  return vertexPointsForNode(node).map((point) => ({
    nodeId: node.id,
    point,
  }));
}

function vertexPointsForNode(node: GeometryNode): Point[] {
  switch (node.type) {
    case "rect":
      return [
        { x: node.x, y: node.y },
        { x: node.x + node.width, y: node.y },
        { x: node.x + node.width, y: node.y + node.height },
        { x: node.x, y: node.y + node.height },
      ];
    case "circle":
      return [
        { x: node.cx - node.r, y: node.cy },
        { x: node.cx, y: node.cy - node.r },
        { x: node.cx + node.r, y: node.cy },
        { x: node.cx, y: node.cy + node.r },
      ];
    case "ellipse":
      return [
        { x: node.cx - node.rx, y: node.cy },
        { x: node.cx, y: node.cy - node.ry },
        { x: node.cx + node.rx, y: node.cy },
        { x: node.cx, y: node.cy + node.ry },
      ];
    case "line":
      return [
        { x: node.x1, y: node.y1 },
        { x: node.x2, y: node.y2 },
      ];
    case "polygon":
    case "polyline":
      return node.points;
    case "path":
      return [node.start, ...node.segments.map((segment) => segment.to)];
    case "text":
      return [{ x: node.x, y: node.y }];
    case "group":
      return [];
  }
}

function createRectHandleUpdatePatch(
  node: RectNode,
  kind: EditHandleKind,
  point: Point,
): UpdatePatch | undefined {
  const right = node.x + node.width;
  const bottom = node.y + node.height;

  switch (kind) {
    case "rect-top-left":
      return createRectBoundsUpdatePatch(node.id, point, {
        x: right,
        y: bottom,
      });
    case "rect-top-right":
      return createRectBoundsUpdatePatch(
        node.id,
        { x: node.x, y: bottom },
        point,
      );
    case "rect-bottom-right":
      return createRectBoundsUpdatePatch(
        node.id,
        { x: node.x, y: node.y },
        point,
      );
    case "rect-bottom-left":
      return createRectBoundsUpdatePatch(
        node.id,
        { x: right, y: node.y },
        point,
      );
    default:
      return undefined;
  }
}

function isBBoxHandleKind(kind: EditHandleKind): boolean {
  return (
    kind === "bbox-top-left" ||
    kind === "bbox-top" ||
    kind === "bbox-top-right" ||
    kind === "bbox-right" ||
    kind === "bbox-bottom-right" ||
    kind === "bbox-bottom" ||
    kind === "bbox-bottom-left" ||
    kind === "bbox-left"
  );
}

function createRectBoundsUpdatePatch(
  nodeId: NodeId,
  start: Point,
  end: Point,
): UpdatePatch {
  return {
    op: "update",
    target: nodeId,
    changes: normalizeBounds(start, end),
  };
}

function createBBoxResizeUpdatePatch(
  node: GeometryNode,
  kind: EditHandleKind,
  point: Point,
): UpdatePatch | undefined {
  const bounds = geometryBoundsForNode(node);

  if (!bounds) {
    return undefined;
  }

  const nextBounds = resizeBounds(bounds, kind, point);

  if (node.type === "rect") {
    return {
      op: "update",
      target: node.id,
      changes: nextBounds,
    };
  }

  if (node.type === "ellipse") {
    return {
      op: "update",
      target: node.id,
      changes: {
        cx: nextBounds.x + nextBounds.width / 2,
        cy: nextBounds.y + nextBounds.height / 2,
        rx: nextBounds.width / 2,
        ry: nextBounds.height / 2,
      },
    };
  }

  if (node.type === "polygon" || node.type === "polyline") {
    return {
      op: "update",
      target: node.id,
      changes: {
        points: scalePointsToBounds(node.points, bounds, nextBounds),
      },
    };
  }

  return undefined;
}

function resizeBounds(
  bounds: Bounds,
  kind: EditHandleKind,
  point: Point,
): Bounds {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  switch (kind) {
    case "bbox-top":
      return normalizeNonEmptyBounds(
        { x: left, y: point.y },
        { x: right, y: bottom },
      );
    case "bbox-right":
      return normalizeNonEmptyBounds(
        { x: left, y: top },
        { x: point.x, y: bottom },
      );
    case "bbox-bottom":
      return normalizeNonEmptyBounds(
        { x: left, y: top },
        { x: right, y: point.y },
      );
    case "bbox-left":
      return normalizeNonEmptyBounds(
        { x: point.x, y: top },
        { x: right, y: bottom },
      );
    case "bbox-top-left":
      return resizeBoundsFromCorner({ x: right, y: bottom }, point, bounds);
    case "bbox-top-right":
      return resizeBoundsFromCorner({ x: left, y: bottom }, point, bounds);
    case "bbox-bottom-right":
      return resizeBoundsFromCorner({ x: left, y: top }, point, bounds);
    case "bbox-bottom-left":
      return resizeBoundsFromCorner({ x: right, y: top }, point, bounds);
    default:
      return bounds;
  }
}

function resizeBoundsFromCorner(
  anchor: Point,
  point: Point,
  originalBounds: Bounds,
): Bounds {
  const ratio = originalBounds.width / Math.max(originalBounds.height, 0.001);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const widthFromX = Math.max(1, Math.abs(dx));
  const heightFromY = Math.max(1, Math.abs(dy));
  let width = widthFromX;
  let height = width / ratio;

  if (height < heightFromY) {
    height = heightFromY;
    width = height * ratio;
  }

  const nextPoint = {
    x: anchor.x + Math.sign(dx || 1) * width,
    y: anchor.y + Math.sign(dy || 1) * height,
  };

  return normalizeNonEmptyBounds(anchor, nextPoint);
}

function normalizeNonEmptyBounds(start: Point, end: Point): Bounds {
  const bounds = normalizeBounds(start, end);

  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function scalePointsToBounds(
  points: Point[],
  fromBounds: Bounds,
  toBounds: Bounds,
): Point[] {
  const width = Math.max(fromBounds.width, 0.001);
  const height = Math.max(fromBounds.height, 0.001);

  return points.map((point) => ({
    x: toBounds.x + ((point.x - fromBounds.x) / width) * toBounds.width,
    y: toBounds.y + ((point.y - fromBounds.y) / height) * toBounds.height,
  }));
}

function createLineHandleUpdatePatch(
  node: LineNode,
  kind: EditHandleKind,
  point: Point,
): UpdatePatch | undefined {
  if (kind === "line-start") {
    return {
      op: "update",
      target: node.id,
      changes: {
        x1: point.x,
        y1: point.y,
      },
    };
  }

  if (kind === "line-end") {
    return {
      op: "update",
      target: node.id,
      changes: {
        x2: point.x,
        y2: point.y,
      },
    };
  }

  return undefined;
}

function createPathHandleUpdatePatch(
  node: PathNode,
  handle: EditHandle,
  point: Point,
): UpdatePatch | undefined {
  if (
    handle.kind === "path-spline-point" &&
    node.spline?.type === "basis" &&
    handle.pointIndex !== undefined
  ) {
    const points = node.spline.points.map((currentPoint, pointIndex) =>
      pointIndex === handle.pointIndex ? point : currentPoint,
    );

    return {
      op: "update",
      target: node.id,
      changes: createBasisSplinePathGeometry(points),
    };
  }

  if (handle.kind === "path-start") {
    const delta = pointDelta(node.start, point);

    return {
      op: "update",
      target: node.id,
      changes: {
        start: point,
        segments: node.segments.map((segment, segmentIndex) =>
          segmentIndex === 0
            ? translateSegmentStartControl(segment, delta)
            : segment,
        ),
      },
    };
  }

  if (handle.kind === "path-segment-end" && handle.segmentIndex !== undefined) {
    const movedSegmentIndex = handle.segmentIndex;
    const currentSegment = node.segments[movedSegmentIndex];

    if (!currentSegment) {
      return undefined;
    }

    const delta = pointDelta(currentSegment.to, point);

    return {
      op: "update",
      target: node.id,
      changes: {
        segments: node.segments.map((segment, segmentIndex) => {
          if (segmentIndex === movedSegmentIndex) {
            return {
              ...translateSegmentEndControl(segment, delta),
              to: point,
            };
          }

          if (segmentIndex === movedSegmentIndex + 1) {
            return translateSegmentStartControl(segment, delta);
          }

          return segment;
        }),
      },
    };
  }

  if (handle.segmentIndex !== undefined) {
    return {
      op: "update",
      target: node.id,
      changes: {
        segments: node.segments.map((segment, segmentIndex) => {
          if (segmentIndex !== handle.segmentIndex) {
            return segment;
          }

          if (
            handle.kind === "path-quadratic-control" &&
            segment.type === "quadratic"
          ) {
            return { ...segment, control: point };
          }

          if (
            handle.kind === "path-cubic-control-1" &&
            segment.type === "cubic"
          ) {
            return { ...segment, control1: point };
          }

          if (
            handle.kind === "path-cubic-control-2" &&
            segment.type === "cubic"
          ) {
            return { ...segment, control2: point };
          }

          if (handle.kind === "path-arc-control" && segment.type === "arc") {
            const start =
              segmentIndex === 0
                ? node.start
                : (node.segments[segmentIndex - 1]?.to ?? node.start);

            return updateArcSegmentFromControl(start, segment, point);
          }

          return segment;
        }),
      },
    };
  }

  return undefined;
}

function pointDelta(from: Point, to: Point): Point {
  return {
    x: to.x - from.x,
    y: to.y - from.y,
  };
}

function translatePoint(point: Point, delta: Point): Point {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}

function translateSegmentStartControl(segment: Segment, delta: Point): Segment {
  if (segment.type === "cubic") {
    return {
      ...segment,
      control1: translatePoint(segment.control1, delta),
    };
  }

  return segment;
}

function translateSegmentEndControl(segment: Segment, delta: Point): Segment {
  if (segment.type === "cubic") {
    return {
      ...segment,
      control2: translatePoint(segment.control2, delta),
    };
  }

  return segment;
}

function createEllipseHandleUpdatePatch(
  node: Extract<GeometryNode, { type: "ellipse" }>,
  kind: EditHandleKind,
  point: Point,
): UpdatePatch | undefined {
  switch (kind) {
    case "ellipse-left":
    case "ellipse-right":
      return {
        op: "update",
        target: node.id,
        changes: {
          rx: Math.max(0.5, Math.abs(point.x - node.cx)),
        },
      };
    case "ellipse-top":
    case "ellipse-bottom":
      return {
        op: "update",
        target: node.id,
        changes: {
          ry: Math.max(0.5, Math.abs(point.y - node.cy)),
        },
      };
    default:
      return undefined;
  }
}

function createPolygonHandleUpdatePatch(
  node: PolygonNode | Extract<GeometryNode, { type: "polyline" }>,
  handle: EditHandle,
  point: Point,
): UpdatePatch | undefined {
  if (handle.kind !== "polygon-point" || handle.pointIndex === undefined) {
    return undefined;
  }

  return {
    op: "update",
    target: node.id,
    changes: {
      points: node.points.map((currentPoint, pointIndex) =>
        pointIndex === handle.pointIndex ? point : currentPoint,
      ),
    },
  };
}

function createSegment(
  start: Point,
  end: Point,
  mode: PathSegmentMode,
  previous?: Point,
  tangent?: Point,
): Segment {
  switch (mode) {
    case "quadratic":
      return {
        type: "quadratic",
        control: midpoint(start, end, -0.35),
        to: end,
      };
    case "cubic":
      return createCubicBezierSegment(previous ?? start, start, end);
    case "arc":
      return createArcSegmentFromTangent(
        start,
        end,
        tangent ?? startTangent(previous, start),
      );
    case "catmullRom":
      return createCatmullRomCubicSegment(previous ?? start, start, end);
    case "basis":
      return (
        createBasisSplinePathGeometry([start, end]).segments.at(-1) ?? {
          type: "line",
          to: end,
        }
      );
    case "line":
      return {
        type: "line",
        to: end,
      };
  }
}

function getPathEndPoint(node: PathNode): Point {
  return node.segments.at(-1)?.to ?? node.start;
}

export function createBasisSplinePathGeometry(points: Point[]): {
  start: Point;
  segments: Segment[];
  spline: PathSpline;
} {
  const fallbackPoint = { x: 0, y: 0 };
  const controlPoints =
    points.length > 0 ? points.map(copyPoint) : [fallbackPoint];

  if (controlPoints.length === 1) {
    return {
      start: copyPoint(controlPoints[0] ?? fallbackPoint),
      segments: [],
      spline: {
        type: "basis",
        points: controlPoints,
      },
    };
  }

  const first = controlPoints[0] ?? fallbackPoint;
  const last = controlPoints.at(-1) ?? first;
  const paddedPoints = [first, first, ...controlPoints, last, last];
  const segments: Segment[] = [];
  let start = copyPoint(first);

  for (let index = 0; index <= paddedPoints.length - 4; index += 1) {
    const p0 = paddedPoints[index];
    const p1 = paddedPoints[index + 1];
    const p2 = paddedPoints[index + 2];
    const p3 = paddedPoints[index + 3];

    if (!p0 || !p1 || !p2 || !p3) {
      continue;
    }

    segments.push({
      type: "cubic",
      control1: weightedPoint([
        [p1, 4],
        [p2, 2],
      ]),
      control2: weightedPoint([
        [p1, 2],
        [p2, 4],
      ]),
      to: basisBezierPoint(p1, p2, p3),
    });
  }

  if (segments.length === 0) {
    start = copyPoint(first);
  }

  return {
    start,
    segments,
    spline: {
      type: "basis",
      points: controlPoints,
    },
  };
}

function getBasisControlPoints(node: PathNode): Point[] {
  if (node.spline?.type === "basis") {
    return node.spline.points;
  }

  return [node.start, ...node.segments.map((segment) => segment.to)];
}

function basisBezierPoint(p0: Point, p1: Point, p2: Point): Point {
  return weightedPoint([
    [p0, 1],
    [p1, 4],
    [p2, 1],
  ]);
}

function weightedPoint(weightedPoints: Array<[Point, number]>): Point {
  const totalWeight = weightedPoints.reduce(
    (sum, [, weight]) => sum + weight,
    0,
  );

  return {
    x:
      weightedPoints.reduce(
        (sum, [point, weight]) => sum + point.x * weight,
        0,
      ) / totalWeight,
    y:
      weightedPoints.reduce(
        (sum, [point, weight]) => sum + point.y * weight,
        0,
      ) / totalWeight,
  };
}

function copyPoint(point: Point): Point {
  return {
    x: point.x,
    y: point.y,
  };
}

function getPathPointBeforeEnd(node: PathNode): Point {
  if (node.segments.length < 2) {
    return node.start;
  }

  return node.segments[node.segments.length - 2]?.to ?? node.start;
}

export function getPathEndTangent(node: PathNode): Point {
  const lastSegment = node.segments.at(-1);

  if (!lastSegment) {
    return { x: 1, y: 0 };
  }

  const start =
    node.segments.length < 2
      ? node.start
      : (node.segments[node.segments.length - 2]?.to ?? node.start);

  return segmentEndTangent(start, lastSegment);
}

function segmentEndTangent(start: Point, segment: Segment): Point {
  if (segment.type === "line") {
    return normalizeVector({
      x: segment.to.x - start.x,
      y: segment.to.y - start.y,
    });
  }

  if (segment.type === "quadratic") {
    return normalizeVector({
      x: segment.to.x - segment.control.x,
      y: segment.to.y - segment.control.y,
    });
  }

  if (segment.type === "cubic") {
    return normalizeVector({
      x: segment.to.x - segment.control2.x,
      y: segment.to.y - segment.control2.y,
    });
  }

  const parameters = arcCenterParameters(start, segment);

  if (!parameters) {
    return normalizeVector({
      x: segment.to.x - start.x,
      y: segment.to.y - start.y,
    });
  }

  const angle = parameters.startAngle + parameters.deltaAngle;
  const cosPhi = Math.cos(parameters.phi);
  const sinPhi = Math.sin(parameters.phi);
  const direction = parameters.deltaAngle >= 0 ? 1 : -1;
  const localDerivative = {
    x: -parameters.rx * Math.sin(angle),
    y: parameters.ry * Math.cos(angle),
  };

  return normalizeVector({
    x: (localDerivative.x * cosPhi - localDerivative.y * sinPhi) * direction,
    y: (localDerivative.x * sinPhi + localDerivative.y * cosPhi) * direction,
  });
}

function appendCatmullRomSegment(node: PathNode, end: Point): Segment[] {
  const points = [node.start, ...node.segments.map((segment) => segment.to)];
  const start = points.at(-1) ?? node.start;
  const previous = points.at(-2) ?? start;
  const nextSegments = [...node.segments];
  const lastSegment = nextSegments.at(-1);

  if (lastSegment?.type === "cubic") {
    nextSegments[nextSegments.length - 1] = {
      ...lastSegment,
      control2: catmullRomControl2(previous, lastSegment.to, end),
    };
  }

  nextSegments.push(createCatmullRomCubicSegment(previous, start, end));

  return nextSegments;
}

export function createCubicBezierSegment(
  previous: Point,
  start: Point,
  end: Point,
): Extract<Segment, { type: "cubic" }> {
  const incoming = {
    x: start.x - previous.x,
    y: start.y - previous.y,
  };
  const outgoing = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.max(Math.hypot(outgoing.x, outgoing.y), 0.001);

  if (incomingLength < 0.001) {
    return {
      type: "cubic",
      control1: lerpPoint(start, end, 1 / 3),
      control2: lerpPoint(start, end, 2 / 3),
      to: end,
    };
  }

  const tangentLength = Math.min(incomingLength, outgoingLength) * 0.45;

  return {
    type: "cubic",
    control1: {
      x: start.x + (incoming.x / incomingLength) * tangentLength,
      y: start.y + (incoming.y / incomingLength) * tangentLength,
    },
    control2: lerpPoint(start, end, 2 / 3),
    to: end,
  };
}

function createCatmullRomCubicSegment(
  previous: Point,
  start: Point,
  end: Point,
): Extract<Segment, { type: "cubic" }> {
  return {
    type: "cubic",
    control1: catmullRomControl1(previous, start, end),
    control2: catmullRomControl2(start, end, end),
    to: end,
  };
}

function catmullRomControl1(previous: Point, start: Point, end: Point): Point {
  return {
    x: start.x + (end.x - previous.x) / 6,
    y: start.y + (end.y - previous.y) / 6,
  };
}

function catmullRomControl2(start: Point, end: Point, next: Point): Point {
  return {
    x: end.x - (next.x - start.x) / 6,
    y: end.y - (next.y - start.y) / 6,
  };
}

function startTangent(previous: Point | undefined, start: Point): Point {
  if (!previous) {
    return { x: 1, y: 0 };
  }

  const dx = start.x - previous.x;
  const dy = start.y - previous.y;
  const length = Math.hypot(dx, dy);

  if (length < 0.001) {
    return { x: 1, y: 0 };
  }

  return {
    x: dx / length,
    y: dy / length,
  };
}

export function arcControlPoint(
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
): Point {
  const parameters = arcCenterParameters(start, segment);

  if (parameters) {
    return pointOnArc(parameters, 0.5);
  }

  const end = segment.to;
  const mid = lerpPoint(start, end, 0.5);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  const radius = Math.max(segment.rx, segment.ry, length / 2);
  const sagitta = Math.max(
    12,
    Math.min(
      radius,
      radius - Math.sqrt(Math.max(0, radius * radius - (length / 2) ** 2)),
    ),
  );
  const direction = segment.sweep ? 1 : -1;

  return {
    x: mid.x + (-dy / length) * sagitta * direction,
    y: mid.y + (dx / length) * sagitta * direction,
  };
}

export function createArcSegmentFromControl(
  start: Point,
  end: Point,
  control: Point,
): Extract<Segment, { type: "arc" }> {
  const circularArc = circularArcThroughPoints(start, control, end);

  if (circularArc) {
    return circularArc;
  }

  return updateArcSegmentFromControl(start, defaultArcSegment(end), control);
}

export function createArcSegmentFromTangent(
  start: Point,
  end: Point,
  tangent: Point,
): Extract<Segment, { type: "arc" }> {
  const normalizedTangent = normalizeVector(tangent);
  const normal = {
    x: -normalizedTangent.y,
    y: normalizedTangent.x,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = 2 * (dx * normal.x + dy * normal.y);

  if (Math.abs(denominator) < 0.001) {
    return createArcSegmentFromControl(start, end, midpoint(start, end, -0.35));
  }

  const signedRadius = (dx * dx + dy * dy) / denominator;
  const center = {
    x: start.x + normal.x * signedRadius,
    y: start.y + normal.y * signedRadius,
  };
  const radius = Math.max(1, Math.abs(signedRadius));
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const sweep = signedRadius >= 0;
  const delta = sweep
    ? positiveAngle(endAngle - startAngle)
    : positiveAngle(startAngle - endAngle);

  return {
    type: "arc",
    rx: radius,
    ry: radius,
    xAxisRotation: 0,
    largeArc: delta > Math.PI,
    sweep,
    to: end,
  };
}

function normalizeVector(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);

  if (length < 0.001) {
    return { x: 1, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function defaultArcSegment(end: Point): Extract<Segment, { type: "arc" }> {
  return {
    type: "arc",
    rx: 1,
    ry: 1,
    xAxisRotation: 0,
    largeArc: false,
    sweep: true,
    to: end,
  };
}

function circularArcThroughPoints(
  start: Point,
  control: Point,
  end: Point,
): Extract<Segment, { type: "arc" }> | undefined {
  const determinant =
    2 *
    (start.x * (control.y - end.y) +
      control.x * (end.y - start.y) +
      end.x * (start.y - control.y));

  if (Math.abs(determinant) < 0.001) {
    return undefined;
  }

  const startLength = start.x * start.x + start.y * start.y;
  const controlLength = control.x * control.x + control.y * control.y;
  const endLength = end.x * end.x + end.y * end.y;
  const center = {
    x:
      (startLength * (control.y - end.y) +
        controlLength * (end.y - start.y) +
        endLength * (start.y - control.y)) /
      determinant,
    y:
      (startLength * (end.x - control.x) +
        controlLength * (start.x - end.x) +
        endLength * (control.x - start.x)) /
      determinant,
  };
  const radius = Math.max(
    1,
    Math.hypot(start.x - center.x, start.y - center.y),
  );
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const controlAngle = Math.atan2(control.y - center.y, control.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const clockwiseDelta = positiveAngle(endAngle - startAngle);
  const clockwiseControlDelta = positiveAngle(controlAngle - startAngle);
  const sweep = clockwiseControlDelta <= clockwiseDelta;
  const delta = sweep ? clockwiseDelta : positiveAngle(startAngle - endAngle);

  return {
    type: "arc",
    rx: radius,
    ry: radius,
    xAxisRotation: 0,
    largeArc: delta > Math.PI,
    sweep,
    to: end,
  };
}

function positiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function updateArcSegmentFromControl(
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
  control: Point,
): Extract<Segment, { type: "arc" }> {
  const circularArc = circularArcThroughPoints(start, control, segment.to);

  if (circularArc) {
    return circularArc;
  }

  const end = segment.to;
  const mid = lerpPoint(start, end, 0.5);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.max(Math.hypot(dx, dy), 0.001);
  const normal = {
    x: -dy / chordLength,
    y: dx / chordLength,
  };
  const signedSagitta =
    (control.x - mid.x) * normal.x + (control.y - mid.y) * normal.y;
  const sagitta = Math.max(1, Math.abs(signedSagitta));
  const radius = (chordLength * chordLength) / (8 * sagitta) + sagitta / 2;

  return {
    ...segment,
    rx: Math.max(1, radius),
    ry: Math.max(1, radius),
    xAxisRotation: 0,
    largeArc: sagitta > radius,
    sweep: signedSagitta >= 0,
  };
}

function lerpPoint(start: Point, end: Point, amount: number): Point {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function midpoint(start: Point, end: Point, perpendicularScale: number): Point {
  const mid = lerpPoint(start, end, 0.5);

  return {
    x: mid.x - (end.y - start.y) * perpendicularScale,
    y: mid.y + (end.x - start.x) * perpendicularScale,
  };
}

function boundsForNode(node: GeometryNode): Bounds | undefined {
  if (node.type === "group") {
    return mergeBounds(node.children.map(boundsForNode).filter(isBounds));
  }

  return expandBoundsForStroke(node, geometryBoundsForNode(node));
}

function geometryBoundsForNode(node: GeometryNode): Bounds | undefined {
  let bounds: Bounds | undefined;

  switch (node.type) {
    case "group":
      return mergeBounds(node.children.map(geometryBoundsForNode).filter(isBounds));
    case "rect":
      bounds = {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      };
      break;
    case "circle":
      bounds = {
        x: node.cx - node.r,
        y: node.cy - node.r,
        width: node.r * 2,
        height: node.r * 2,
      };
      break;
    case "ellipse":
      bounds = {
        x: node.cx - node.rx,
        y: node.cy - node.ry,
        width: node.rx * 2,
        height: node.ry * 2,
      };
      break;
    case "line":
      bounds = normalizeBounds(
        { x: node.x1, y: node.y1 },
        { x: node.x2, y: node.y2 },
      );
      break;
    case "polygon":
    case "polyline":
      bounds = mergeBounds(
        node.points.map((point) => ({ ...point, width: 0, height: 0 })),
      );
      break;
    case "path":
      bounds = mergeBounds(
        pathRenderPoints(node).map((point) => ({
          ...point,
          width: 0,
          height: 0,
        })),
      );
      break;
    case "text":
      bounds = boundsForTextNode(node);
      break;
  }

  return bounds;
}

function boundsForTextNode(node: TextNode): Bounds {
  const fontSize = node.fontSize ?? 16;
  const lines = textLines(node.text);
  const lineHeight = textLineHeight(fontSize);
  const width = Math.max(
    fontSize * 0.6,
    ...lines.map((line) => line.length * fontSize * 0.6),
  );
  const height = Math.max(lineHeight, lineHeight * lines.length);
  const x =
    node.textAnchor === "middle"
      ? node.x - width / 2
      : node.textAnchor === "end"
        ? node.x - width
        : node.x;
  const startY = textStartY(node, fontSize, lineHeight, lines.length);
  const y =
    node.dominantBaseline === "middle" || node.dominantBaseline === "central"
      ? node.y - height / 2
      : node.dominantBaseline === "top" || node.dominantBaseline === "hanging"
        ? startY
        : startY - fontSize;

  return {
    x,
    y,
    width,
    height,
  };
}

function pathRenderPoints(node: PathNode): Point[] {
  const points: Point[] = [node.start];
  let current = node.start;

  for (const segment of node.segments) {
    points.push(...samplePathSegment(current, segment));
    current = segment.to;
  }

  return points;
}

function samplePathSegment(start: Point, segment: Segment): Point[] {
  if (segment.type === "line") {
    return [segment.to];
  }

  if (segment.type === "quadratic") {
    return sampleParametricCurve(
      (amount) => quadraticPoint(start, segment.control, segment.to, amount),
      24,
    );
  }

  if (segment.type === "cubic") {
    return sampleParametricCurve(
      (amount) =>
        cubicPoint(
          start,
          segment.control1,
          segment.control2,
          segment.to,
          amount,
        ),
      32,
    );
  }

  return sampleArcSegment(start, segment);
}

function sampleParametricCurve(
  pointAt: (amount: number) => Point,
  sampleCount: number,
): Point[] {
  const points: Point[] = [];

  for (let index = 1; index <= sampleCount; index += 1) {
    points.push(pointAt(index / sampleCount));
  }

  return points;
}

function quadraticPoint(
  start: Point,
  control: Point,
  end: Point,
  amount: number,
): Point {
  const inverse = 1 - amount;

  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * amount * control.x +
      amount * amount * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * amount * control.y +
      amount * amount * end.y,
  };
}

function cubicPoint(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  amount: number,
): Point {
  const inverse = 1 - amount;

  return {
    x:
      inverse * inverse * inverse * start.x +
      3 * inverse * inverse * amount * control1.x +
      3 * inverse * amount * amount * control2.x +
      amount * amount * amount * end.x,
    y:
      inverse * inverse * inverse * start.y +
      3 * inverse * inverse * amount * control1.y +
      3 * inverse * amount * amount * control2.y +
      amount * amount * amount * end.y,
  };
}

function sampleArcSegment(
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
): Point[] {
  const parameters = arcCenterParameters(start, segment);

  if (!parameters) {
    return [segment.to];
  }

  return sampleParametricCurve(
    (amount) => (amount === 1 ? segment.to : pointOnArc(parameters, amount)),
    arcSampleCount(parameters),
  );
}

function arcSampleCount(
  parameters: NonNullable<ReturnType<typeof arcCenterParameters>>,
): number {
  const radius = Math.max(parameters.rx, parameters.ry);

  return Math.max(
    16,
    Math.min(96, Math.ceil((Math.abs(parameters.deltaAngle) * radius) / 8)),
  );
}

function mergeBounds(boundsList: Bounds[]): Bounds | undefined {
  if (boundsList.length === 0) {
    return undefined;
  }

  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(
    ...boundsList.map((bounds) => bounds.y + bounds.height),
  );

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function expandBoundsForStroke(
  node: GeometryNode,
  bounds: Bounds | undefined,
): Bounds | undefined {
  if (!bounds || !hasVisibleStroke(node)) {
    return bounds;
  }

  const strokeWidth =
    node.type === "text"
      ? (node.style?.strokeWidth ??
        node.strokeWidth ??
        defaultStyle.strokeWidth ??
        0)
      : (node.style?.strokeWidth ?? defaultStyle.strokeWidth ?? 0);
  const padding = Math.max(0, strokeWidth / 2);

  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function isBounds(bounds: Bounds | undefined): bounds is Bounds {
  return Boolean(bounds);
}

function isPointInsideBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function isPointNearBounds(
  point: Point,
  bounds: Bounds,
  tolerance: number,
): boolean {
  const top = distanceToSegment(
    point,
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
  );
  const right = distanceToSegment(
    point,
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  );
  const bottom = distanceToSegment(
    point,
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  );
  const left = distanceToSegment(
    point,
    { x: bounds.x, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
  );

  return Math.min(top, right, bottom, left) <= tolerance;
}

function isPointNearPolyline(
  point: Point,
  points: Point[],
  closed: boolean,
  tolerance: number,
): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (
      current &&
      next &&
      distanceToSegment(point, current, next) <= tolerance
    ) {
      return true;
    }
  }

  const first = points[0];
  const last = points.at(-1);

  return Boolean(
    closed &&
    first &&
    last &&
    distanceToSegment(point, last, first) <= tolerance,
  );
}

function isPointNearPath(
  point: Point,
  node: PathNode,
  tolerance: number,
): boolean {
  let current = node.start;

  for (const segment of node.segments) {
    if (distanceToPathSegment(point, current, segment) <= tolerance) {
      return true;
    }

    current = segment.to;
  }

  return (
    node.closed && distanceToSegment(point, current, node.start) <= tolerance
  );
}

function distanceToPathSegment(
  point: Point,
  start: Point,
  segment: Segment,
): number {
  if (segment.type === "arc") {
    return distanceToArcSegment(point, start, segment);
  }

  if (segment.type === "line") {
    return distanceToSegment(point, start, segment.to);
  }

  let nearest = Infinity;
  let previous = start;

  for (const current of samplePathSegment(start, segment)) {
    nearest = Math.min(nearest, distanceToSegment(point, previous, current));
    previous = current;
  }

  return nearest;
}

function distanceToArcSegment(
  point: Point,
  start: Point,
  segment: Extract<Segment, { type: "arc" }>,
): number {
  const parameters = arcCenterParameters(start, segment);

  if (!parameters) {
    return distanceToSegment(point, start, segment.to);
  }

  const sampleCount = arcSampleCount(parameters);
  let nearest = Number.POSITIVE_INFINITY;
  let previous = start;

  for (let index = 1; index <= sampleCount; index += 1) {
    const current =
      index === sampleCount
        ? segment.to
        : pointOnArc(parameters, index / sampleCount);
    nearest = Math.min(nearest, distanceToSegment(point, previous, current));
    previous = current;
  }

  return nearest;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );

  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
