import {
  createDocument,
  getDocumentGradients,
  getDocumentViewBox,
  type Effect,
  type Gradient,
  type GeometryDocument,
  type GeometryNode,
  type NodeStyle,
  type NodeTransform,
  type Point,
  type Segment,
  type ViewBox,
} from "@vibesvg/ast";

export function exportToSvg(document: GeometryDocument): string {
  const children = document.root.children
    .map((node) => renderNode(node, document))
    .join("");
  const viewBox = getDocumentViewBox(document);
  const defs = renderDefs(document);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(document.width)}" height="${formatNumber(document.height)}" viewBox="${formatNumber(viewBox.x)} ${formatNumber(viewBox.y)} ${formatNumber(viewBox.width)} ${formatNumber(viewBox.height)}">`,
    defs,
    children,
    "</svg>",
  ].join("");
}

export function importFromSvg(svgText: string): GeometryDocument {
  if (typeof DOMParser === "undefined") {
    throw new Error("SVG import requires a DOMParser environment.");
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgText, "image/svg+xml");
  const parseError = parsed.querySelector("parsererror");

  if (parseError) {
    throw new Error("Invalid SVG.");
  }

  const svg =
    parsed.documentElement.localName.toLowerCase() === "svg"
      ? parsed.documentElement
      : parsed.querySelector("svg");

  if (!svg) {
    throw new Error("SVG root element was not found.");
  }

  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  const width =
    parseLength(svg.getAttribute("width")) ?? viewBox?.width ?? 1024;
  const height =
    parseLength(svg.getAttribute("height")) ?? viewBox?.height ?? 768;
  const ids = new Set<string>();
  const context: SvgImportContext = {
    ids,
    nextId(type) {
      let index = ids.size + 1;
      let id = `${type}-${index}`;

      while (ids.has(id)) {
        index += 1;
        id = `${type}-${index}`;
      }

      ids.add(id);
      return id;
    },
    reserveId(rawId, type) {
      const base = rawId?.trim() || this.nextId(type);
      let id = base;
      let suffix = 2;

      while (ids.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }

      ids.add(id);
      return id;
    },
  };
  const gradients = parseGradients(svg);
  const gradientIds = new Set(gradients.map((gradient) => gradient.id));
  const effectsByFilterId = parseEffects(svg);
  const clipPathsById = parseClipPaths(svg);
  const masksById = parseMasks(svg);
  const children = parseSvgChildren(
    svg,
    context,
    parseNodeStyle(svg, {}, gradientIds, effectsByFilterId),
    gradientIds,
    effectsByFilterId,
    clipPathsById,
    masksById,
  );
  const document = createDocument({
    id: context.nextId("document"),
    name:
      svg.getAttribute("data-name") ?? svg.getAttribute("id") ?? "Imported SVG",
    width,
    height,
    viewBox,
    resources: { gradients },
  });

  return {
    ...document,
    root: {
      ...document.root,
      children,
    },
  };
}

type SvgImportContext = {
  ids: Set<string>;
  nextId: (type: string) => string;
  reserveId: (rawId: string | null, type: string) => string;
};

type PathSubpath = {
  closed: boolean;
  segments: Segment[];
  start: Point;
};

const svgDefaultStyle: NodeStyle = {
  fill: "#000000",
  stroke: "none",
  strokeWidth: 1,
};

function parseSvgChildren(
  parent: Element,
  context: SvgImportContext,
  inheritedStyle: NodeStyle,
  gradientIds: Set<string>,
  effectsByFilterId: Map<string, Effect[]>,
  clipPathsById: Map<string, string>,
  masksById: Map<string, string>,
): GeometryNode[] {
  const nodes: GeometryNode[] = [];

  for (const child of parent.children) {
    nodes.push(
      ...parseSvgElement(
        child,
        context,
        inheritedStyle,
        gradientIds,
        effectsByFilterId,
        clipPathsById,
        masksById,
      ),
    );
  }

  return nodes;
}

function parseSvgElement(
  element: Element,
  context: SvgImportContext,
  inheritedStyle: NodeStyle,
  gradientIds: Set<string>,
  effectsByFilterId: Map<string, Effect[]>,
  clipPathsById: Map<string, string>,
  masksById: Map<string, string>,
): GeometryNode[] {
  const tagName = element.localName.toLowerCase();

  if (
    tagName === "defs" ||
    tagName === "metadata" ||
    tagName === "title" ||
    tagName === "desc"
  ) {
    return [];
  }

  const style = parseNodeStyle(
    element,
    inheritedStyle,
    gradientIds,
    effectsByFilterId,
  );
  const name =
    element.getAttribute("data-name") ??
    element.getAttribute("aria-label") ??
    undefined;
  const transform = parseTransform(element.getAttribute("transform"));
  const clipNodeId = clipPathsById.get(
    parseClipPathReference(element.getAttribute("clip-path")),
  );
  const maskNodeId = masksById.get(
    parseMaskReference(element.getAttribute("mask")),
  );
  const common = {
    id: context.reserveId(element.getAttribute("id"), tagName),
    name,
    style,
    ...(transform ? { transform } : {}),
    ...(clipNodeId ? { clipPath: { nodeId: clipNodeId } } : {}),
    ...(maskNodeId ? { mask: { nodeId: maskNodeId } } : {}),
  };

  switch (tagName) {
    case "g":
    case "svg": {
      return [
        {
          ...common,
          type: "group",
          children: parseSvgChildren(
            element,
            context,
            style,
            gradientIds,
            effectsByFilterId,
            clipPathsById,
            masksById,
          ),
        },
      ];
    }
    case "rect": {
      const x = parseLength(element.getAttribute("x")) ?? 0;
      const y = parseLength(element.getAttribute("y")) ?? 0;
      const width = parseLength(element.getAttribute("width")) ?? 0;
      const height = parseLength(element.getAttribute("height")) ?? 0;

      if (width <= 0 || height <= 0) {
        return [];
      }

      return [
        {
          ...common,
          type: "rect",
          x,
          y,
          width,
          height,
          rx: parseLength(element.getAttribute("rx")) ?? undefined,
          ry: parseLength(element.getAttribute("ry")) ?? undefined,
        },
      ];
    }
    case "circle": {
      const r = parseLength(element.getAttribute("r")) ?? 0;

      if (r <= 0) {
        return [];
      }

      return [
        {
          ...common,
          type: "circle",
          cx: parseLength(element.getAttribute("cx")) ?? 0,
          cy: parseLength(element.getAttribute("cy")) ?? 0,
          r,
        },
      ];
    }
    case "ellipse": {
      const rx = parseLength(element.getAttribute("rx")) ?? 0;
      const ry = parseLength(element.getAttribute("ry")) ?? 0;

      if (rx <= 0 || ry <= 0) {
        return [];
      }

      return [
        {
          ...common,
          type: "ellipse",
          cx: parseLength(element.getAttribute("cx")) ?? 0,
          cy: parseLength(element.getAttribute("cy")) ?? 0,
          rx,
          ry,
        },
      ];
    }
    case "line":
      return [
        {
          ...common,
          type: "line",
          x1: parseLength(element.getAttribute("x1")) ?? 0,
          y1: parseLength(element.getAttribute("y1")) ?? 0,
          x2: parseLength(element.getAttribute("x2")) ?? 0,
          y2: parseLength(element.getAttribute("y2")) ?? 0,
        },
      ];
    case "polygon": {
      const points = parsePoints(element.getAttribute("points"));

      return points.length < 3
        ? []
        : [
            {
              ...common,
              type: "polygon",
              points,
            },
          ];
    }
    case "polyline": {
      const points = parsePoints(element.getAttribute("points"));

      return points.length < 2
        ? []
        : [
            {
              ...common,
              type: "polyline",
              points,
            },
          ];
    }
    case "path": {
      const subpaths = parsePathData(element.getAttribute("d") ?? "");

      return subpaths.map((subpath, index) => ({
        ...common,
        id: index === 0 ? common.id : context.nextId("path"),
        type: "path",
        start: subpath.start,
        closed: subpath.closed,
        segments: subpath.segments,
      }));
    }
    case "text": {
      const text = parseTextElementContent(element);

      if (!text.trim()) {
        return [];
      }

      return [
        {
          ...common,
          type: "text",
          x: parseLength(element.getAttribute("x")) ?? 0,
          y: parseLength(element.getAttribute("y")) ?? 0,
          text,
          fill: style.fill,
          opacity: style.opacity,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          fontFamily: styleValue(element, "font-family"),
          fontSize: parseLength(styleValue(element, "font-size") ?? null),
          fontStyle: textFontStyle(styleValue(element, "font-style")),
          fontWeight: styleValue(element, "font-weight"),
          textAnchor: textAnchorValue(styleValue(element, "text-anchor")),
          dominantBaseline: styleValue(element, "dominant-baseline"),
        },
      ];
    }
    default:
      return [];
  }
}

function parseNodeStyle(
  element: Element,
  inheritedStyle: NodeStyle,
  gradientIds: Set<string>,
  effectsByFilterId: Map<string, Effect[]>,
): NodeStyle {
  const inlineStyle = parseInlineStyle(element.getAttribute("style"));
  const style: NodeStyle = {
    ...svgDefaultStyle,
    ...inheritedStyle,
  };
  const read = (name: string) =>
    inlineStyle.get(name) ?? element.getAttribute(name);
  const fill = read("fill");
  const stroke = read("stroke");
  const strokeWidth = read("stroke-width");
  const strokeLinecap = read("stroke-linecap");
  const strokeLinejoin = read("stroke-linejoin");
  const strokeMiterlimit = read("stroke-miterlimit");
  const strokeDasharray = read("stroke-dasharray");
  const strokeDashoffset = read("stroke-dashoffset");
  const opacity = read("opacity");
  const filter = read("filter");

  if (fill) {
    style.fill = parsePaint(fill, gradientIds);
  }

  if (stroke) {
    style.stroke = parsePaint(stroke, gradientIds);
  }

  if (strokeWidth) {
    style.strokeWidth = parseLength(strokeWidth) ?? style.strokeWidth;
  }

  if (
    strokeLinecap === "butt" ||
    strokeLinecap === "round" ||
    strokeLinecap === "square"
  ) {
    style.strokeLinecap = strokeLinecap;
  }

  if (
    strokeLinejoin === "arcs" ||
    strokeLinejoin === "bevel" ||
    strokeLinejoin === "miter" ||
    strokeLinejoin === "miter-clip" ||
    strokeLinejoin === "round"
  ) {
    style.strokeLinejoin = strokeLinejoin;
  }

  if (strokeMiterlimit) {
    style.strokeMiterlimit =
      parseLength(strokeMiterlimit) ?? style.strokeMiterlimit;
  }

  if (strokeDasharray) {
    style.strokeDasharray = strokeDasharray;
  }

  if (strokeDashoffset) {
    style.strokeDashoffset =
      parseLength(strokeDashoffset) ?? style.strokeDashoffset;
  }

  if (opacity) {
    style.opacity = parseLength(opacity) ?? style.opacity;
  }

  const effects = filter
    ? effectsByFilterId.get(parseFilterReference(filter))
    : undefined;

  if (effects) {
    style.effects = effects.map((effect) => ({ ...effect }));
  }

  return style;
}

function parseFilterReference(value: string): string {
  return value.trim().match(/^url\(#([^)]+)\)$/)?.[1] ?? "";
}

function parseClipPathReference(value: string | null): string {
  return value?.trim().match(/^url\(#([^)]+)\)$/)?.[1] ?? "";
}

function parseMaskReference(value: string | null): string {
  return value?.trim().match(/^url\(#([^)]+)\)$/)?.[1] ?? "";
}

function parseClipPaths(svg: Element): Map<string, string> {
  const clipPaths = new Map<string, string>();

  for (const clipPath of Array.from(svg.querySelectorAll("defs clipPath"))) {
    const id = clipPath.getAttribute("id")?.trim();
    const use = clipPath.querySelector(":scope > use");
    const nodeId = use
      ?.getAttribute("href")
      ?.trim()
      .match(/^#(.+)$/)?.[1];

    if (id && nodeId) {
      clipPaths.set(id, nodeId);
    }
  }

  return clipPaths;
}

function parseMasks(svg: Element): Map<string, string> {
  const masks = new Map<string, string>();

  for (const mask of Array.from(svg.querySelectorAll("defs mask"))) {
    const id = mask.getAttribute("id")?.trim();
    const use = mask.querySelector(":scope > use");
    const nodeId = use
      ?.getAttribute("href")
      ?.trim()
      .match(/^#(.+)$/)?.[1];

    if (id && nodeId) {
      masks.set(id, nodeId);
    }
  }

  return masks;
}

function parseEffects(svg: Element): Map<string, Effect[]> {
  const filters = new Map<string, Effect[]>();

  for (const filter of Array.from(svg.querySelectorAll("defs filter"))) {
    const id = filter.getAttribute("id")?.trim();

    if (!id) {
      continue;
    }

    const effects: Effect[] = [];
    for (const primitive of Array.from(filter.children)) {
      if (primitive.localName === "feGaussianBlur") {
        const radius = parseLength(primitive.getAttribute("stdDeviation"));

        if (radius !== undefined && radius >= 0) {
          effects.push({ type: "blur", radius });
        }
      }

      if (primitive.localName === "feDropShadow") {
        const blur = parseLength(primitive.getAttribute("stdDeviation"));
        const dx = parseLength(primitive.getAttribute("dx"));
        const dy = parseLength(primitive.getAttribute("dy"));
        const color = styleValue(primitive, "flood-color") ?? "#000000";
        const opacity = parseLength(
          styleValue(primitive, "flood-opacity") ?? null,
        );

        if (
          blur !== undefined &&
          dx !== undefined &&
          dy !== undefined &&
          blur >= 0
        ) {
          effects.push({
            type: "dropShadow",
            dx,
            dy,
            blur,
            color,
            ...(opacity === undefined ? {} : { opacity: clamp(opacity, 0, 1) }),
          });
        }
      }
    }

    if (effects.length) {
      filters.set(id, effects);
    }
  }

  return filters;
}

function parsePaint(value: string, gradientIds: Set<string>) {
  const match = value.trim().match(/^url\(#([^)]+)\)$/);

  return match && gradientIds.has(match[1]!)
    ? { type: "gradient" as const, gradientId: match[1]! }
    : value;
}

function parseGradients(svg: Element): Gradient[] {
  const gradients: Gradient[] = [];

  for (const element of Array.from(
    svg.querySelectorAll("defs linearGradient, defs radialGradient"),
  )) {
    const id = element.getAttribute("id")?.trim();
    const stops = Array.from(element.querySelectorAll(":scope > stop"))
      .map((stop) => {
        const offset = parseGradientOffset(stop.getAttribute("offset"));
        const color = styleValue(stop, "stop-color") ?? "#000000";
        const opacity = parseLength(styleValue(stop, "stop-opacity") ?? null);

        return offset === undefined
          ? undefined
          : {
              offset,
              color,
              ...(opacity === undefined
                ? {}
                : { opacity: clamp(opacity, 0, 1) }),
            };
      })
      .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));

    if (!id || stops.length === 0) {
      continue;
    }

    if (element.localName === "linearGradient") {
      gradients.push({
        id,
        type: "linear",
        x1: parseLength(element.getAttribute("x1")) ?? 0,
        y1: parseLength(element.getAttribute("y1")) ?? 0,
        x2: parseLength(element.getAttribute("x2")) ?? 1,
        y2: parseLength(element.getAttribute("y2")) ?? 0,
        stops,
      });
      continue;
    }

    gradients.push({
      id,
      type: "radial",
      cx: parseLength(element.getAttribute("cx")) ?? 0.5,
      cy: parseLength(element.getAttribute("cy")) ?? 0.5,
      r: parseLength(element.getAttribute("r")) ?? 0.5,
      ...(parseLength(element.getAttribute("fx")) === undefined
        ? {}
        : { fx: parseLength(element.getAttribute("fx"))! }),
      ...(parseLength(element.getAttribute("fy")) === undefined
        ? {}
        : { fy: parseLength(element.getAttribute("fy"))! }),
      stops,
    });
  }

  return gradients;
}

function parseGradientOffset(value: string | null): number | undefined {
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();
  const percentage = trimmed.endsWith("%")
    ? Number(trimmed.slice(0, -1)) / 100
    : Number(trimmed);

  return Number.isFinite(percentage) ? clamp(percentage, 0, 1) : undefined;
}

function parseInlineStyle(style: string | null): Map<string, string> {
  const entries = new Map<string, string>();

  if (!style) {
    return entries;
  }

  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    entries.set(
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim(),
    );
  }

  return entries;
}

function styleValue(element: Element, name: string): string | undefined {
  return (
    parseInlineStyle(element.getAttribute("style")).get(name) ??
    element.getAttribute(name) ??
    undefined
  );
}

function textFontStyle(
  value: string | undefined,
): "normal" | "italic" | undefined {
  return value === "italic"
    ? "italic"
    : value === "normal"
      ? "normal"
      : undefined;
}

function textAnchorValue(
  value: string | undefined,
): "start" | "middle" | "end" | undefined {
  return value === "start" || value === "middle" || value === "end"
    ? value
    : undefined;
}

function parsePathData(data: string): PathSubpath[] {
  const tokens =
    data.match(
      /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:(?:\d*\.\d+)|(?:\d+\.?))(?:[eE][-+]?\d+)?/g,
    ) ?? [];
  const subpaths: PathSubpath[] = [];
  let index = 0;
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let start: Point | undefined;
  let segments: Segment[] = [];
  let closed = false;
  let previousCubicControl: Point | undefined;
  let previousQuadraticControl: Point | undefined;

  const isCommand = (token: string | undefined) =>
    Boolean(token && /^[A-Za-z]$/.test(token));
  const hasNumber = () => index < tokens.length && !isCommand(tokens[index]);
  const readNumber = () => Number(tokens[index++]);
  const readPoint = (relative: boolean): Point | undefined => {
    if (!hasNumber() || index + 1 > tokens.length) {
      return undefined;
    }

    const x = readNumber();
    const y = readNumber();

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return undefined;
    }

    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const finishSubpath = () => {
    if (!start) {
      return;
    }

    subpaths.push({
      start,
      closed,
      segments,
    });
    start = undefined;
    segments = [];
    closed = false;
  };
  const resetControls = () => {
    previousCubicControl = undefined;
    previousQuadraticControl = undefined;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++]!;
    } else if (!command) {
      break;
    }

    const relative = command === command.toLowerCase();

    switch (command.toUpperCase()) {
      case "M": {
        const point = readPoint(relative);

        if (!point) {
          break;
        }

        finishSubpath();
        current = point;
        start = point;
        command = relative ? "l" : "L";
        resetControls();

        while (hasNumber()) {
          const linePoint = readPoint(relative);

          if (!linePoint) {
            break;
          }

          segments.push({ type: "line", to: linePoint });
          current = linePoint;
        }
        break;
      }
      case "L":
        while (hasNumber()) {
          const point = readPoint(relative);

          if (!point) {
            break;
          }

          segments.push({ type: "line", to: point });
          current = point;
        }
        resetControls();
        break;
      case "H":
        while (hasNumber()) {
          const x = readNumber();
          const point = { x: relative ? current.x + x : x, y: current.y };

          segments.push({ type: "line", to: point });
          current = point;
        }
        resetControls();
        break;
      case "V":
        while (hasNumber()) {
          const y = readNumber();
          const point = { x: current.x, y: relative ? current.y + y : y };

          segments.push({ type: "line", to: point });
          current = point;
        }
        resetControls();
        break;
      case "C":
        while (hasNumber()) {
          const control1 = readPoint(relative);
          const control2 = readPoint(relative);
          const to = readPoint(relative);

          if (!control1 || !control2 || !to) {
            break;
          }

          segments.push({ type: "cubic", control1, control2, to });
          previousCubicControl = control2;
          previousQuadraticControl = undefined;
          current = to;
        }
        break;
      case "S":
        while (hasNumber()) {
          const control1 = previousCubicControl
            ? reflectPoint(previousCubicControl, current)
            : current;
          const control2 = readPoint(relative);
          const to = readPoint(relative);

          if (!control2 || !to) {
            break;
          }

          segments.push({ type: "cubic", control1, control2, to });
          previousCubicControl = control2;
          previousQuadraticControl = undefined;
          current = to;
        }
        break;
      case "Q":
        while (hasNumber()) {
          const control = readPoint(relative);
          const to = readPoint(relative);

          if (!control || !to) {
            break;
          }

          segments.push({ type: "quadratic", control, to });
          previousQuadraticControl = control;
          previousCubicControl = undefined;
          current = to;
        }
        break;
      case "T":
        while (hasNumber()) {
          const control = previousQuadraticControl
            ? reflectPoint(previousQuadraticControl, current)
            : current;
          const to = readPoint(relative);

          if (!to) {
            break;
          }

          segments.push({ type: "quadratic", control, to });
          previousQuadraticControl = control;
          previousCubicControl = undefined;
          current = to;
        }
        break;
      case "A":
        while (hasNumber()) {
          const rx = readNumber();
          const ry = readNumber();
          const xAxisRotation = readNumber();
          const largeArcFlag = readNumber();
          const sweepFlag = readNumber();
          const to = readPoint(relative);

          if (
            ![rx, ry, xAxisRotation, largeArcFlag, sweepFlag].every(
              Number.isFinite,
            ) ||
            !to
          ) {
            break;
          }

          segments.push({
            type: "arc",
            rx,
            ry,
            xAxisRotation,
            largeArc: largeArcFlag !== 0,
            sweep: sweepFlag !== 0,
            to,
          });
          current = to;
        }
        resetControls();
        break;
      case "Z":
        closed = true;
        current = start ?? current;
        finishSubpath();
        resetControls();
        break;
      default:
        break;
    }
  }

  finishSubpath();

  return subpaths.filter(
    (subpath) => subpath.segments.length > 0 || subpath.closed,
  );
}

function reflectPoint(point: Point, origin: Point): Point {
  return {
    x: origin.x * 2 - point.x,
    y: origin.y * 2 - point.y,
  };
}

function parseTextElementContent(element: Element): string {
  const tspans = Array.from(element.children).filter(
    (child) => child.localName.toLowerCase() === "tspan",
  );

  if (tspans.length > 0) {
    return tspans.map((tspan) => tspan.textContent ?? "").join("\n");
  }

  return element.textContent ?? "";
}

function parsePoints(value: string | null): Point[] {
  if (!value) {
    return [];
  }

  const numbers =
    value
      .match(/[-+]?(?:(?:\d*\.\d+)|(?:\d+\.?))(?:[eE][-+]?\d+)?/g)
      ?.map(Number) ?? [];
  const points: Point[] = [];

  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];

    if (
      x !== undefined &&
      y !== undefined &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      points.push({ x, y });
    }
  }

  return points;
}

function parseViewBox(value: string | null): ViewBox | undefined {
  const numbers = parseNumberList(value);

  if (numbers.length < 4) {
    return undefined;
  }

  const x = numbers[0];
  const y = numbers[1];
  const width = numbers[2];
  const height = numbers[3];

  return x !== undefined &&
    y !== undefined &&
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { x, y, width, height }
    : undefined;
}

function parseLength(value: string | null): number | undefined {
  if (!value || value.endsWith("%")) {
    return undefined;
  }

  const match = value
    .trim()
    .match(/^[-+]?(?:(?:\d*\.\d+)|(?:\d+\.?))(?:[eE][-+]?\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumberList(value: string | null): number[] {
  return (
    value
      ?.match(/[-+]?(?:(?:\d*\.\d+)|(?:\d+\.?))(?:[eE][-+]?\d+)?/g)
      ?.map(Number) ?? []
  );
}

function renderNode(node: GeometryNode, document: GeometryDocument): string {
  if (node.visible === false) {
    return "";
  }

  const common = `${renderId(node.id)}${renderName(node.name)}${renderStyle(node.style)}${renderTransform(node.transform)}${renderClipPathAttribute(node)}${renderMaskAttribute(node)}${renderEffectAttribute(node.id, node.style?.effects)}`;

  switch (node.type) {
    case "group":
      return `<g${common}>${node.children.map((child) => renderNode(child, document)).join("")}</g>`;
    case "rect":
      return `<rect${common} x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" width="${formatNumber(node.width)}" height="${formatNumber(node.height)}"${optionalNumber("rx", node.rx)}${optionalNumber("ry", node.ry)} />`;
    case "circle":
      return `<circle${common} cx="${formatNumber(node.cx)}" cy="${formatNumber(node.cy)}" r="${formatNumber(node.r)}" />`;
    case "ellipse":
      return `<ellipse${common} cx="${formatNumber(node.cx)}" cy="${formatNumber(node.cy)}" rx="${formatNumber(node.rx)}" ry="${formatNumber(node.ry)}" />`;
    case "line":
      return `<line${common} x1="${formatNumber(node.x1)}" y1="${formatNumber(node.y1)}" x2="${formatNumber(node.x2)}" y2="${formatNumber(node.y2)}" />`;
    case "polygon":
      return `<polygon${common} points="${renderPoints(node.points)}" />`;
    case "polyline":
      return `<polyline${common} points="${renderPoints(node.points)}" />`;
    case "path":
      return `<path${common} d="${renderPathData(node.start, node.segments, node.closed)}" />`;
    case "text":
      return renderTextNode(node);
  }
}

function renderDefs(document: GeometryDocument): string {
  const gradients = getDocumentGradients(document);
  const effectNodes = collectEffectNodes(document.root);
  const clipPathNodes = collectClipPathNodes(document.root);
  const maskNodes = collectMaskNodes(document.root);

  if (
    !gradients.length &&
    !effectNodes.length &&
    !clipPathNodes.length &&
    !maskNodes.length
  ) {
    return "";
  }

  const viewBox = getDocumentViewBox(document);
  return `<defs>${gradients.map(renderGradient).join("")}${clipPathNodes.map(renderClipPath).join("")}${maskNodes.map(renderMask).join("")}${effectNodes.map((node) => renderFilter(node.id, node.effects, viewBox)).join("")}</defs>`;
}

function collectClipPathNodes(node: GeometryNode): GeometryNode[] {
  const result =
    node.clipPath?.nodeId && node.clipPath.nodeId !== node.id ? [node] : [];

  if (node.type === "group") {
    return [...result, ...node.children.flatMap(collectClipPathNodes)];
  }

  return result;
}

function renderClipPath(node: GeometryNode): string {
  return `<clipPath id="${escapeAttribute(clipPathId(node.id))}"><use href="#${escapeAttribute(node.clipPath!.nodeId)}" /></clipPath>`;
}

function renderClipPathAttribute(node: GeometryNode): string {
  return node.clipPath?.nodeId && node.clipPath.nodeId !== node.id
    ? ` clip-path="url(#${escapeAttribute(clipPathId(node.id))})"`
    : "";
}

function clipPathId(nodeId: string): string {
  return `vibesvg-clip-${nodeId}`;
}

function collectMaskNodes(node: GeometryNode): GeometryNode[] {
  const result =
    node.mask?.nodeId && node.mask.nodeId !== node.id ? [node] : [];

  if (node.type === "group") {
    return [...result, ...node.children.flatMap(collectMaskNodes)];
  }

  return result;
}

function renderMask(node: GeometryNode): string {
  return `<mask id="${escapeAttribute(maskId(node.id))}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha"><use href="#${escapeAttribute(node.mask!.nodeId)}" /></mask>`;
}

function renderMaskAttribute(node: GeometryNode): string {
  return node.mask?.nodeId && node.mask.nodeId !== node.id
    ? ` mask="url(#${escapeAttribute(maskId(node.id))})"`
    : "";
}

function maskId(nodeId: string): string {
  return `vibesvg-mask-${nodeId}`;
}

function collectEffectNodes(
  node: GeometryNode,
): Array<{ id: string; effects: Effect[] }> {
  const result = node.style?.effects?.length
    ? [{ id: node.id, effects: node.style.effects }]
    : [];

  if (node.type === "group") {
    return [...result, ...node.children.flatMap(collectEffectNodes)];
  }

  return result;
}

function renderEffectAttribute(
  id: string,
  effects: Effect[] | undefined,
): string {
  return effects?.length
    ? ` filter="url(#${escapeAttribute(effectFilterId(id))})"`
    : "";
}

function renderFilter(id: string, effects: Effect[], viewBox: ViewBox): string {
  const padding = effects.reduce((maximum, effect) => {
    const extent =
      effect.type === "blur"
        ? effect.radius * 3
        : Math.max(Math.abs(effect.dx), Math.abs(effect.dy)) + effect.blur * 3;
    return Math.max(maximum, extent);
  }, 0);
  let input = "SourceGraphic";
  const primitives = effects
    .map((effect, index) => {
      const result = `effect-${index}`;
      const primitive =
        effect.type === "blur"
          ? `<feGaussianBlur in="${input}" stdDeviation="${formatNumber(Math.max(0, effect.radius))}" result="${result}" />`
          : `<feDropShadow in="${input}" dx="${formatNumber(effect.dx)}" dy="${formatNumber(effect.dy)}" stdDeviation="${formatNumber(Math.max(0, effect.blur))}" flood-color="${escapeAttribute(effect.color)}"${effect.opacity === undefined ? "" : ` flood-opacity="${formatNumber(effect.opacity)}"`} result="${result}" />`;
      input = result;
      return primitive;
    })
    .join("");

  return `<filter id="${escapeAttribute(effectFilterId(id))}" filterUnits="userSpaceOnUse" x="${formatNumber(viewBox.x - padding)}" y="${formatNumber(viewBox.y - padding)}" width="${formatNumber(viewBox.width + padding * 2)}" height="${formatNumber(viewBox.height + padding * 2)}">${primitives}</filter>`;
}

function effectFilterId(nodeId: string): string {
  return `vibesvg-effect-${nodeId}`;
}

function renderGradient(gradient: Gradient): string {
  const stops = gradient.stops
    .map(
      (stop) =>
        `<stop offset="${formatNumber(stop.offset * 100)}%" stop-color="${escapeAttribute(stop.color)}"${stop.opacity === undefined ? "" : ` stop-opacity="${formatNumber(stop.opacity)}"`} />`,
    )
    .join("");

  if (gradient.type === "linear") {
    return `<linearGradient id="${escapeAttribute(gradient.id)}" gradientUnits="userSpaceOnUse" x1="${formatNumber(gradient.x1)}" y1="${formatNumber(gradient.y1)}" x2="${formatNumber(gradient.x2)}" y2="${formatNumber(gradient.y2)}">${stops}</linearGradient>`;
  }

  return `<radialGradient id="${escapeAttribute(gradient.id)}" gradientUnits="userSpaceOnUse" cx="${formatNumber(gradient.cx)}" cy="${formatNumber(gradient.cy)}" r="${formatNumber(gradient.r)}"${optionalNumber("fx", gradient.fx)}${optionalNumber("fy", gradient.fy)}>${stops}</radialGradient>`;
}

function renderTextNode(node: Extract<GeometryNode, { type: "text" }>): string {
  const lines = textLines(node.text);
  const common = `${renderId(node.id)}${renderName(node.name)}${renderTextStyle(node)}${renderTransform(node.transform)}${renderClipPathAttribute(node)}${renderMaskAttribute(node)} x="${formatNumber(node.x)}" y="${formatNumber(node.y)}"`;

  if (lines.length === 1) {
    return `<text${common}>${escapeText(node.text)}</text>`;
  }

  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? "" : ` dy="1.2em"`;

    return `<tspan x="${formatNumber(node.x)}"${dy}>${escapeText(line)}</tspan>`;
  });

  return `<text${common}>${tspans.join("")}</text>`;
}

function renderTextStyle(
  node: Extract<GeometryNode, { type: "text" }>,
): string {
  const fill = node.style?.fill ?? node.fill ?? "#111827";
  const stroke = node.style?.stroke ?? node.stroke;
  const strokeWidth = node.style?.strokeWidth ?? node.strokeWidth;
  const opacity = node.style?.opacity ?? node.opacity;

  return [
    ` fill="${escapeAttribute(renderPaint(fill))}"`,
    stroke === undefined
      ? ""
      : ` stroke="${escapeAttribute(renderPaint(stroke))}"`,
    strokeWidth === undefined
      ? ""
      : ` stroke-width="${formatNumber(strokeWidth)}"`,
    node.fontFamily === undefined
      ? ""
      : ` font-family="${escapeAttribute(node.fontFamily)}"`,
    node.fontSize === undefined
      ? ""
      : ` font-size="${formatNumber(node.fontSize)}"`,
    node.fontWeight === undefined
      ? ""
      : ` font-weight="${escapeAttribute(String(node.fontWeight))}"`,
    node.fontStyle === undefined
      ? ""
      : ` font-style="${escapeAttribute(node.fontStyle)}"`,
    node.textAnchor === undefined
      ? ""
      : ` text-anchor="${escapeAttribute(node.textAnchor)}"`,
    node.dominantBaseline === undefined
      ? ""
      : ` dominant-baseline="${escapeAttribute(node.dominantBaseline)}"`,
    opacity === undefined ? "" : ` opacity="${formatNumber(opacity)}"`,
  ].join("");
}

function renderTransform(transform: NodeTransform | undefined): string {
  if (!transform) {
    return "";
  }

  const matrix = transformMatrix(transform);

  return ` transform="matrix(${formatNumber(matrix.a)} ${formatNumber(matrix.b)} ${formatNumber(matrix.c)} ${formatNumber(matrix.d)} ${formatNumber(matrix.e)} ${formatNumber(matrix.f)})"`;
}

function transformMatrix(transform: NodeTransform): SvgMatrix {
  const translateX = transform.translateX ?? 0;
  const translateY = transform.translateY ?? 0;
  const rotation = ((transform.rotation ?? 0) * Math.PI) / 180;
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  const originX = transform.originX ?? 0;
  const originY = transform.originY ?? 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const a = cosine * scaleX;
  const b = sine * scaleX;
  const c = -sine * scaleY;
  const d = cosine * scaleY;

  return {
    a,
    b,
    c,
    d,
    e: translateX + originX - a * originX - c * originY,
    f: translateY + originY - b * originX - d * originY,
  };
}

type SvgMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

function parseTransform(value: string | null): NodeTransform | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  if (value.replace(/[a-zA-Z]+\s*\([^)]*\)/g, "").trim()) {
    return undefined;
  }

  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = expression.exec(value))) {
    const command = match[1]?.toLowerCase();
    const numbers = parseNumberList(match[2] ?? "");
    let next: SvgMatrix | undefined;

    switch (command) {
      case "matrix":
        if (numbers.length === 6 && numbers.every(Number.isFinite)) {
          const [a, b, c, d, e, f] = numbers;
          next = { a: a!, b: b!, c: c!, d: d!, e: e!, f: f! };
        }
        break;
      case "translate":
        if (numbers.length >= 1 && Number.isFinite(numbers[0])) {
          next = { a: 1, b: 0, c: 0, d: 1, e: numbers[0]!, f: numbers[1] ?? 0 };
        }
        break;
      case "scale":
        if (numbers.length >= 1 && Number.isFinite(numbers[0])) {
          next = {
            a: numbers[0]!,
            b: 0,
            c: 0,
            d: numbers[1] ?? numbers[0]!,
            e: 0,
            f: 0,
          };
        }
        break;
      case "rotate":
        if (numbers.length >= 1 && Number.isFinite(numbers[0])) {
          const radians = (numbers[0]! * Math.PI) / 180;
          const cosine = Math.cos(radians);
          const sine = Math.sin(radians);
          const originX = numbers[1] ?? 0;
          const originY = numbers[2] ?? 0;
          next = {
            a: cosine,
            b: sine,
            c: -sine,
            d: cosine,
            e: originX - cosine * originX + sine * originY,
            f: originY - sine * originX - cosine * originY,
          };
        }
        break;
    }

    if (!next) {
      return undefined;
    }

    matrix = multiplyMatrices(matrix, next);
    found = true;
  }

  if (!found) {
    return undefined;
  }

  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;

  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(determinant) ||
    scaleX === 0
  ) {
    return undefined;
  }

  return {
    translateX: matrix.e,
    translateY: matrix.f,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    scaleX,
    scaleY: determinant / scaleX,
  };
}

function multiplyMatrices(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function renderPathData(
  start: Point,
  segments: Segment[],
  closed: boolean,
): string {
  const commands = [`M ${formatNumber(start.x)} ${formatNumber(start.y)}`];

  for (const segment of segments) {
    switch (segment.type) {
      case "line":
        commands.push(
          `L ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`,
        );
        break;
      case "quadratic":
        commands.push(
          `Q ${formatNumber(segment.control.x)} ${formatNumber(segment.control.y)} ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`,
        );
        break;
      case "cubic":
        commands.push(
          `C ${formatNumber(segment.control1.x)} ${formatNumber(segment.control1.y)} ${formatNumber(segment.control2.x)} ${formatNumber(segment.control2.y)} ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`,
        );
        break;
      case "arc":
        commands.push(
          `A ${formatNumber(segment.rx)} ${formatNumber(segment.ry)} ${formatNumber(segment.xAxisRotation)} ${segment.largeArc ? 1 : 0} ${segment.sweep ? 1 : 0} ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`,
        );
        break;
    }
  }

  if (closed) {
    commands.push("Z");
  }

  return commands.join(" ");
}

function renderStyle(style: NodeStyle | undefined): string {
  const fill = style?.fill ?? "none";
  const stroke = style?.stroke ?? "#111827";
  const strokeWidth = style?.strokeWidth ?? 2;
  const strokeLinecap = style?.strokeLinecap;
  const strokeLinejoin = style?.strokeLinejoin;
  const strokeMiterlimit = style?.strokeMiterlimit;
  const strokeDasharray = style?.strokeDasharray;
  const strokeDashoffset = style?.strokeDashoffset;
  const opacity = style?.opacity;

  return [
    ` fill="${escapeAttribute(renderPaint(fill))}"`,
    ` stroke="${escapeAttribute(renderPaint(stroke))}"`,
    ` stroke-width="${formatNumber(strokeWidth)}"`,
    strokeLinecap === undefined
      ? ""
      : ` stroke-linecap="${escapeAttribute(strokeLinecap)}"`,
    strokeLinejoin === undefined
      ? ""
      : ` stroke-linejoin="${escapeAttribute(strokeLinejoin)}"`,
    strokeMiterlimit === undefined
      ? ""
      : ` stroke-miterlimit="${formatNumber(strokeMiterlimit)}"`,
    strokeDasharray === undefined
      ? ""
      : ` stroke-dasharray="${escapeAttribute(strokeDasharray)}"`,
    strokeDashoffset === undefined
      ? ""
      : ` stroke-dashoffset="${formatNumber(strokeDashoffset)}"`,
    opacity === undefined ? "" : ` opacity="${formatNumber(opacity)}"`,
  ].join("");
}

function renderPaint(paint: NodeStyle["fill"] | undefined): string {
  if (paint && typeof paint !== "string") {
    return `url(#${paint.gradientId})`;
  }

  return paint ?? "none";
}

function renderPoints(points: Point[]): string {
  return points
    .map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
    .join(" ");
}

function renderId(id: string): string {
  return ` id="${escapeAttribute(id)}"`;
}

function renderName(name: string | undefined): string {
  return name ? ` data-name="${escapeAttribute(name)}"` : "";
}

function optionalNumber(name: string, value: number | undefined): string {
  return value === undefined ? "" : ` ${name}="${formatNumber(value)}"`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/\.?0+$/, "");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function textLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}
