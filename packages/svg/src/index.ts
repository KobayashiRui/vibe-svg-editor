import {
  createDocument,
  getDocumentViewBox,
  type GeometryDocument,
  type GeometryNode,
  type NodeStyle,
  type Point,
  type Segment,
  type ViewBox,
} from "@glyphsmith/ast";

export function exportToSvg(document: GeometryDocument): string {
  const children = document.root.children.map(renderNode).join("");
  const viewBox = getDocumentViewBox(document);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(document.width)}" height="${formatNumber(document.height)}" viewBox="${formatNumber(viewBox.x)} ${formatNumber(viewBox.y)} ${formatNumber(viewBox.width)} ${formatNumber(viewBox.height)}">`,
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
  const children = parseSvgChildren(svg, context, parseNodeStyle(svg, {}));
  const document = createDocument({
    id: context.nextId("document"),
    name:
      svg.getAttribute("data-name") ?? svg.getAttribute("id") ?? "Imported SVG",
    width,
    height,
    viewBox,
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
): GeometryNode[] {
  const nodes: GeometryNode[] = [];

  for (const child of parent.children) {
    nodes.push(...parseSvgElement(child, context, inheritedStyle));
  }

  return nodes;
}

function parseSvgElement(
  element: Element,
  context: SvgImportContext,
  inheritedStyle: NodeStyle,
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

  const style = parseNodeStyle(element, inheritedStyle);
  const name =
    element.getAttribute("data-name") ??
    element.getAttribute("aria-label") ??
    undefined;
  const common = {
    id: context.reserveId(element.getAttribute("id"), tagName),
    name,
    style,
  };

  switch (tagName) {
    case "g":
    case "svg": {
      return [
        {
          ...common,
          type: "group",
          children: parseSvgChildren(element, context, style),
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

  if (fill) {
    style.fill = fill;
  }

  if (stroke) {
    style.stroke = stroke;
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

  return style;
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

function renderNode(node: GeometryNode): string {
  if (node.visible === false) {
    return "";
  }

  const common = `${renderId(node.id)}${renderName(node.name)}${renderStyle(node.style)}`;

  switch (node.type) {
    case "group":
      return `<g${common}>${node.children.map(renderNode).join("")}</g>`;
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

function renderTextNode(node: Extract<GeometryNode, { type: "text" }>): string {
  const lines = textLines(node.text);
  const common = `${renderId(node.id)}${renderName(node.name)}${renderTextStyle(node)} x="${formatNumber(node.x)}" y="${formatNumber(node.y)}"`;

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
    ` fill="${escapeAttribute(fill)}"`,
    stroke === undefined ? "" : ` stroke="${escapeAttribute(stroke)}"`,
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
    ` fill="${escapeAttribute(fill)}"`,
    ` stroke="${escapeAttribute(stroke)}"`,
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
