import type {
  GeometryDocument,
  GeometryNode,
  GroupNode,
  MovePatch,
  PatchOperation,
  Point,
  ViewBox,
} from "@vibesvg/ast";

export function applyPatch(
  document: GeometryDocument,
  patch: PatchOperation,
): GeometryDocument {
  switch (patch.op) {
    case "updateDocument":
      const viewBox =
        patch.changes.viewBox === undefined
          ? document.viewBox
          : normalizeViewBox(patch.changes.viewBox);

      return {
        ...document,
        ...patch.changes,
        width:
          patch.changes.width === undefined
            ? document.width
            : clampDimension(patch.changes.width),
        height:
          patch.changes.height === undefined
            ? document.height
            : clampDimension(patch.changes.height),
        ...(viewBox ? { viewBox } : {}),
      };
    case "insert":
      return {
        ...document,
        root: insertNode(
          document.root,
          patch.parentId,
          patch.node,
          patch.index,
        ) as GroupNode,
      };
    case "update":
      return {
        ...document,
        root: updateNode(
          document.root,
          patch.target,
          (node) =>
            ({
              ...node,
              ...patch.changes,
              id: node.id,
              type: node.type,
            }) as GeometryNode,
        ) as GroupNode,
      };
    case "delete":
      if (patch.target === document.root.id) {
        return document;
      }

      return {
        ...document,
        root: deleteNode(document.root, patch.target) as GroupNode,
      };
    case "move":
      return {
        ...document,
        root: updateNode(document.root, patch.target, (node) =>
          moveNode(node, patch),
        ) as GroupNode,
      };
  }
}

function normalizeViewBox(viewBox: ViewBox): ViewBox {
  return {
    x: Number.isFinite(viewBox.x) ? viewBox.x : 0,
    y: Number.isFinite(viewBox.y) ? viewBox.y : 0,
    width: clampDimension(viewBox.width),
    height: clampDimension(viewBox.height),
  };
}

export function applyPatches(
  document: GeometryDocument,
  patches: PatchOperation[],
): GeometryDocument {
  return patches.reduce(
    (current, patch) => applyPatch(current, patch),
    document,
  );
}

export function findNode(
  document: GeometryDocument,
  nodeId: string,
): GeometryNode | undefined {
  return findNodeInTree(document.root, nodeId);
}

export function findParentNode(
  document: GeometryDocument,
  nodeId: string,
): GroupNode | undefined {
  return findParentNodeInTree(document.root, nodeId);
}

export function reorderChildren(
  document: GeometryDocument,
  parentId: string,
  sourceIndex: number,
  targetIndex: number,
): GeometryDocument {
  return {
    ...document,
    root: updateNode(document.root, parentId, (node) => {
      if (node.type !== "group") {
        return node;
      }

      const children = [...node.children];
      const from = clamp(sourceIndex, 0, children.length - 1);
      const to = clamp(targetIndex, 0, children.length - 1);

      if (from === to) {
        return node;
      }

      const [child] = children.splice(from, 1);

      if (!child) {
        return node;
      }

      children.splice(to, 0, child);

      return {
        ...node,
        children,
      };
    }) as GroupNode,
  };
}

export function moveNodeToParent(
  document: GeometryDocument,
  nodeId: string,
  targetParentId: string,
  targetIndex?: number,
): GeometryDocument {
  if (nodeId === document.root.id || nodeId === targetParentId) {
    return document;
  }

  const node = findNode(document, nodeId);
  const sourceParent = findParentNode(document, nodeId);
  const targetParent = findNode(document, targetParentId);

  if (
    !node ||
    !sourceParent ||
    !targetParent ||
    targetParent.type !== "group"
  ) {
    return document;
  }

  if (node.type === "group" && findNodeInTree(node, targetParentId)) {
    return document;
  }

  const sourceIndex = sourceParent.children.findIndex(
    (child) => child.id === nodeId,
  );

  if (sourceIndex < 0) {
    return document;
  }

  if (sourceParent.id === targetParentId) {
    return reorderChildren(
      document,
      sourceParent.id,
      sourceIndex,
      targetIndex ?? targetParent.children.length - 1,
    );
  }

  const withoutSource = removeDirectChild(
    document.root,
    sourceParent.id,
    nodeId,
  ) as GroupNode;
  const nextTargetParent = findNodeInTree(withoutSource, targetParentId);

  if (!nextTargetParent || nextTargetParent.type !== "group") {
    return document;
  }

  const insertAt =
    targetIndex === undefined
      ? nextTargetParent.children.length
      : clamp(targetIndex, 0, nextTargetParent.children.length);

  return {
    ...document,
    root: insertNode(
      withoutSource,
      targetParentId,
      node,
      insertAt,
    ) as GroupNode,
  };
}

export function groupNodes(
  document: GeometryDocument,
  nodeIds: string[],
  groupId: string,
  name = "Group",
): GeometryDocument {
  const uniqueNodeIds = [...new Set(nodeIds)];

  if (uniqueNodeIds.length < 2) {
    return document;
  }

  const parents = uniqueNodeIds.map((nodeId) =>
    findParentNode(document, nodeId),
  );
  const parent = parents[0];

  if (!parent || parents.some((candidate) => candidate?.id !== parent.id)) {
    return document;
  }

  const selected = new Set(uniqueNodeIds);
  const selectedChildren = parent.children.filter((child) =>
    selected.has(child.id),
  );

  if (selectedChildren.length < 2) {
    return document;
  }

  const insertionIndex = Math.max(
    ...selectedChildren.map((child) =>
      parent.children.findIndex((candidate) => candidate.id === child.id),
    ),
  );
  const nextChildren = parent.children.filter(
    (child) => !selected.has(child.id),
  );
  const group: GroupNode = {
    id: groupId,
    name,
    type: "group",
    children: selectedChildren,
  };

  nextChildren.splice(insertionIndex - (selectedChildren.length - 1), 0, group);

  return {
    ...document,
    root: updateNode(document.root, parent.id, (node) =>
      node.type === "group"
        ? {
            ...node,
            children: nextChildren,
          }
        : node,
    ) as GroupNode,
  };
}

export function ungroupNode(
  document: GeometryDocument,
  groupId: string,
): GeometryDocument {
  const group = findNode(document, groupId);
  const parent = findParentNode(document, groupId);

  if (!parent || !group || group.type !== "group") {
    return document;
  }

  const groupIndex = parent.children.findIndex((child) => child.id === groupId);

  if (groupIndex < 0) {
    return document;
  }

  const children = [...parent.children];
  children.splice(groupIndex, 1, ...group.children);

  return {
    ...document,
    root: updateNode(document.root, parent.id, (node) =>
      node.type === "group"
        ? {
            ...node,
            children,
          }
        : node,
    ) as GroupNode,
  };
}

function insertNode(
  current: GeometryNode,
  parentId: string,
  node: GeometryNode,
  index?: number,
): GeometryNode {
  if (current.id === parentId && current.type === "group") {
    const children = [...current.children];
    const insertAt =
      index === undefined ? children.length : clamp(index, 0, children.length);

    children.splice(insertAt, 0, node);

    return {
      ...current,
      children,
    };
  }

  if (current.type !== "group") {
    return current;
  }

  return {
    ...current,
    children: current.children.map((child) =>
      insertNode(child, parentId, node, index),
    ),
  };
}

function removeDirectChild(
  current: GeometryNode,
  parentId: string,
  childId: string,
): GeometryNode {
  if (current.type !== "group") {
    return current;
  }

  if (current.id === parentId) {
    return {
      ...current,
      children: current.children.filter((child) => child.id !== childId),
    };
  }

  return {
    ...current,
    children: current.children.map((child) =>
      removeDirectChild(child, parentId, childId),
    ),
  };
}

function updateNode(
  current: GeometryNode,
  targetId: string,
  updater: (node: GeometryNode) => GeometryNode,
): GeometryNode {
  if (current.id === targetId) {
    return updater(current);
  }

  if (current.type !== "group") {
    return current;
  }

  return {
    ...current,
    children: current.children.map((child) =>
      updateNode(child, targetId, updater),
    ),
  };
}

function deleteNode(current: GeometryNode, targetId: string): GeometryNode {
  if (current.type !== "group") {
    return current;
  }

  return {
    ...current,
    children: current.children
      .filter((child) => child.id !== targetId)
      .map((child) => deleteNode(child, targetId)),
  };
}

function findNodeInTree(
  current: GeometryNode,
  nodeId: string,
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

function findParentNodeInTree(
  current: GeometryNode,
  nodeId: string,
): GroupNode | undefined {
  if (current.type !== "group") {
    return undefined;
  }

  if (current.children.some((child) => child.id === nodeId)) {
    return current;
  }

  for (const child of current.children) {
    const match = findParentNodeInTree(child, nodeId);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function moveNode(node: GeometryNode, patch: MovePatch): GeometryNode {
  const delta: Point = { x: patch.dx, y: patch.dy };

  switch (node.type) {
    case "group":
      return {
        ...node,
        children: node.children.map((child) => moveNode(child, patch)),
      };
    case "rect":
      return { ...node, x: node.x + delta.x, y: node.y + delta.y };
    case "circle":
    case "ellipse":
      return { ...node, cx: node.cx + delta.x, cy: node.cy + delta.y };
    case "line":
      return {
        ...node,
        x1: node.x1 + delta.x,
        y1: node.y1 + delta.y,
        x2: node.x2 + delta.x,
        y2: node.y2 + delta.y,
      };
    case "polygon":
    case "polyline":
      return {
        ...node,
        points: node.points.map((point) => translatePoint(point, delta)),
      };
    case "path":
      return {
        ...node,
        start: translatePoint(node.start, delta),
        spline: node.spline
          ? {
              ...node.spline,
              points: node.spline.points.map((point) =>
                translatePoint(point, delta),
              ),
            }
          : undefined,
        segments: node.segments.map((segment) => {
          switch (segment.type) {
            case "line":
              return { ...segment, to: translatePoint(segment.to, delta) };
            case "quadratic":
              return {
                ...segment,
                control: translatePoint(segment.control, delta),
                to: translatePoint(segment.to, delta),
              };
            case "cubic":
              return {
                ...segment,
                control1: translatePoint(segment.control1, delta),
                control2: translatePoint(segment.control2, delta),
                to: translatePoint(segment.to, delta),
              };
            case "arc":
              return { ...segment, to: translatePoint(segment.to, delta) };
          }
        }),
      };
    case "text":
      return { ...node, x: node.x + delta.x, y: node.y + delta.y };
  }
}

function translatePoint(point: Point, delta: Point): Point {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value));
}
