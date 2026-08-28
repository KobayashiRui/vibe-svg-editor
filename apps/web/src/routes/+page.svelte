<script lang="ts">
	import {
		createPage,
		createProject,
		getDocumentViewBox,
		type Gradient,
		type GradientStop,
		type Effect,
		type DocumentBackground,
		type GeometryDocument,
		type GeometryNode,
		type VibeSVGProject,
		type NodeId,
		type NodeStyle,
		type NodeTransform,
		type Paint,
		type PathNode,
		type Point,
		type Segment,
		type TextNode,
		type ViewBox
	} from '@vibesvg/ast';
	import {
		createAppendPathSegmentPatch,
		createBasisSplinePathGeometry,
		createArcSegmentFromTangent,
		createCubicBezierSegment,
		createEllipseInsertPatch,
		createLinePathInsertPatch,
		createPathClosedUpdatePatch,
		createRectInsertPatch,
		createTriangleInsertPatch,
		createEditHandleUpdatePatch,
		coordinateDecimalPlaces,
		drawArcSegment,
		fitViewportToDocument,
		getNodeBounds,
		getPathEndTangent,
		hitTest,
		hitTestEditHandle,
		panViewport,
		renderDocument,
		roundGeometryDocument,
		screenToWorld,
		snapPointToExistingVertex,
		trianglePointsFromBounds,
		zoomViewportAtPoint,
		type EditHandle,
		type PathSegmentMode,
		type SnapPoint,
		type Tool,
		type Viewport
	} from '@vibesvg/editor';
	import {
		applyPatch,
		applyPatches,
		findNode,
		findParentNode,
		groupNodes,
		moveNodeToParent,
		reorderChildren,
		ungroupNode
	} from '@vibesvg/kernel';
	import { exportToSvg, importFromSvg } from '@vibesvg/svg';
	import { DragDropProvider, type DragDropEventHandlers } from '@dnd-kit/svelte';
	import { isSortable } from '@dnd-kit/svelte/sortable';
	import { strToU8, zipSync } from 'fflate';
	import ExportSvgPopover from '$lib/ExportSvgPopover.svelte';
	import PageThumbnail from '$lib/PageThumbnail.svelte';
	import LayerRow, { type LayerItem } from './LayerRow.svelte';
	import { onMount, tick } from 'svelte';

	let canvas: HTMLCanvasElement;
	let svgImportInput = $state<HTMLInputElement | undefined>();
	let context = $state<CanvasRenderingContext2D | undefined>();
	let project = $state<VibeSVGProject>(initialProjectFromData());
	let selectedNodeIds = $state<NodeId[]>([]);
	let tool = $state<Tool>('select');
	let pathSegmentMode = $state<PathSegmentMode>('line');
	let activePathNodeId = $state<NodeId | undefined>();
	let isTransformScaleLocked = $state(true);
	let viewport = $state<Viewport>({ x: 80, y: 56, zoom: 1 });
	let draftStart = $state<Point | undefined>();
	let draftEnd = $state<Point | undefined>();
	let shapePreviewPoint = $state<Point | undefined>();
	let dragging = $state(false);
	let editingHandle = $state<EditHandle | undefined>();
	let panning = $state(false);
	let spacePressed = $state(false);
	let lastDragPoint = $state<Point | undefined>();
	let lastPanPoint = $state<Point | undefined>();
	let nextNodeIndex = $state(1);
	let canvasPixelRatio = $state(1);
	let snapTarget = $state<SnapPoint | undefined>();
	let undoStack = $state<VibeSVGProject[]>([]);
	let redoStack = $state<VibeSVGProject[]>([]);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>(initialSaveStatusFromData());
	let hostStatus = $state<'disabled' | 'connecting' | 'connected' | 'error'>('disabled');
	let liveEditStartProject: VibeSVGProject | undefined;
	let liveEditDidChange = false;
	let settingsEditStartProject: VibeSVGProject | undefined;
	let hostSocket: WebSocket | undefined;
	let hostSyncTimer: ReturnType<typeof setTimeout> | undefined;
	let hostReconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let closingHostSocket = false;
	let hasFitInitialViewport = false;
	let settingsOpen = $state(false);
	let svgImportOpen = $state(false);
	let svgImportText = $state('');
	let svgExportOpen = $state(false);
	let editingGroupId = $state<NodeId | undefined>();
	let expandedGroupIds = $state<NodeId[]>([]);
	let layerDragStartProject: VibeSVGProject | undefined;
	let layerDragNodeId = $state<NodeId | undefined>();
	let layerContextMenu = $state<{ nodeId?: NodeId; x: number; y: number } | undefined>();
	let pageContextMenu = $state<{ pageId: string; x: number; y: number } | undefined>();
	let pageTooltip = $state<{ text: string; x: number; y: number } | undefined>();
	let toolTooltip = $state<{ text: string; x: number; y: number } | undefined>();
	let renamingPageId = $state<string | undefined>();
	let renamingPageName = $state('');
	let pageRenameInput = $state<HTMLInputElement | undefined>();
	let renamingProjectName = $state(false);
	let projectNameDraft = $state('');
	let projectNameInput = $state<HTMLInputElement | undefined>();

	type DragStartEvent = Parameters<NonNullable<DragDropEventHandlers['onDragStart']>>[0];
	type DragOverEvent = Parameters<NonNullable<DragDropEventHandlers['onDragOver']>>[0];
	type DragEndEvent = Parameters<NonNullable<DragDropEventHandlers['onDragEnd']>>[0];
	type ShapeTool = 'rect' | 'ellipse' | 'triangle';

	const uiColors = {
		primary: '#4b7dff',
		primaryHover: '#6a95ff',
		primaryPreviewFill: 'rgba(75, 125, 255, 0.08)',
		warning: '#facc15'
	} as const;

	const pageBackgroundColorFallbacks = {
		white: '#ffffff',
		gray: '#a0a0a0',
		black: '#000000',
		alphaLight: '#f8fafc',
		alphaDark: '#cfd8df'
	} as const;

	const strokeLinecapOptions = ['butt', 'round', 'square'] as const;
	const strokeLinejoinOptions = ['miter', 'round', 'bevel'] as const;
	const iconPaths = {
		app: '/icons/App-Icon.svg',
		arc: '/icons/Arc.svg',
		basis: '/icons/Basis.svg',
		catmullRom: '/icons/Catmull.svg',
		cubic: '/icons/Cubic-Bezier.svg',
		edit: '/icons/Edit.svg',
		ellipse: '/icons/Ellipse.svg',
		line: '/icons/Line.svg',
		rect: '/icons/Rect.svg',
		redo: '/icons/Redo.svg',
		select: '/icons/Select.svg',
		text: '/icons/Text.svg',
		triangle: '/icons/Triangle.svg',
		undo: '/icons/Undo.svg'
	} as const;

	const activePage = $derived(
		project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0]!
	);
	const geometryDocument = $derived(activePage.document);
	const layerItems = $derived(buildLayerItems(geometryDocument.root, expandedGroupIds));
	const visibleLayerItems = $derived(
		layerItems
			.filter((item) => !isHiddenByLayerDrag(item))
			.map((item, sortIndex) => ({ ...item, sortIndex }))
	);
	const svgExportPages = $derived(
		project.pages.map((page, index) => ({
			document: page.document,
			id: page.id,
			name: page.name || `Page ${index + 1}`,
			width: page.document.width,
			height: page.document.height,
			active: page.id === project.activePageId
		}))
	);
	const pageContextMenuPage = $derived(
		pageContextMenu ? project.pages.find((page) => page.id === pageContextMenu?.pageId) : undefined
	);
	const layerContextMenuNode = $derived(
		layerContextMenu?.nodeId ? findNode(geometryDocument, layerContextMenu.nodeId) : undefined
	);
	const selectedNode = $derived(
		selectedNodeIds[0] ? findNode(geometryDocument, selectedNodeIds[0]) : undefined
	);
	const clipPathCandidates = $derived(
		selectedNode ? collectClipPathCandidates(geometryDocument.root, selectedNode.id) : []
	);
	const maskCandidates = $derived(
		selectedNode ? collectMaskCandidates(geometryDocument.root, selectedNode.id) : []
	);

	function initialProjectFromData(): VibeSVGProject {
		return createProject({
			name: 'VibeSVG Project',
			width: 256,
			height: 256
		});
	}

	function initialSaveStatusFromData(): 'idle' | 'saved' {
		return 'idle';
	}

	function buildLayerItems(
		parent: Extract<GeometryNode, { type: 'group' }>,
		expandedIds: NodeId[],
		depth = 0
	): LayerItem[] {
		const items: LayerItem[] = [];
		const expanded = new Set(expandedIds);
		const children = parent.children;

		for (let uiIndex = 0; uiIndex < children.length; uiIndex += 1) {
			const astIndex = children.length - 1 - uiIndex;
			const node = children[astIndex];

			if (!node) {
				continue;
			}

			const expandable = node.type === 'group' && node.children.length > 0;
			const isExpanded = expanded.has(node.id);

			items.push({
				astIndex,
				depth,
				expanded: isExpanded,
				expandable,
				node,
				parentId: parent.id,
				uiIndex
			});

			if (node.type === 'group' && isExpanded) {
				items.push(...buildLayerItems(node, expandedIds, depth + 1));
			}
		}

		return items;
	}

	function collectClipPathCandidates(
		node: Extract<GeometryNode, { type: 'group' }>,
		excludedNodeId: NodeId
	): Array<{ id: NodeId; name: string; type: string }> {
		const candidates: Array<{ id: NodeId; name: string; type: string }> = [];

		for (const child of node.children) {
			if (
				child.id !== excludedNodeId &&
				(child.type === 'rect' ||
					child.type === 'circle' ||
					child.type === 'ellipse' ||
					child.type === 'polygon' ||
					(child.type === 'path' && child.closed))
			) {
				candidates.push({
					id: child.id,
					name: child.name ?? child.id,
					type: child.type
				});
			}

			if (child.type === 'group') {
				candidates.push(...collectClipPathCandidates(child, excludedNodeId));
			}
		}

		return candidates;
	}

	function collectMaskCandidates(
		node: Extract<GeometryNode, { type: 'group' }>,
		excludedNodeId: NodeId
	): Array<{ id: NodeId; name: string; type: string }> {
		const candidates: Array<{ id: NodeId; name: string; type: string }> = [];

		for (const child of node.children) {
			if (child.id !== excludedNodeId) {
				candidates.push({
					id: child.id,
					name: child.name ?? child.id,
					type: child.type
				});
			}

			if (child.type === 'group') {
				candidates.push(...collectMaskCandidates(child, excludedNodeId));
			}
		}

		return candidates;
	}

	function isHiddenByLayerDrag(item: LayerItem) {
		if (!layerDragNodeId || item.node.id === layerDragNodeId) {
			return false;
		}

		const dragNode = findNode(geometryDocument, layerDragNodeId);

		return dragNode?.type === 'group' && isAncestorOf(layerDragNodeId, item.node.id);
	}

	$effect(() => {
		geometryDocument;
		selectedNodeIds;
		tool;
		activePathNodeId;
		draftStart;
		draftEnd;
		shapePreviewPoint;
		viewport;
		canvasPixelRatio;
		snapTarget;
		draw();
	});

	$effect(() => {
		selectedNodeIds;
		sendSelectionToHost();
	});

	onMount(() => {
		context = canvas.getContext('2d') ?? undefined;
		connectHostWebSocket();

		const resize = () => {
			resizeCanvasToElement();

			if (!hasFitInitialViewport) {
				fitInitialCanvasToDocument();
				return;
			}

			draw();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (pageContextMenu && event.key === 'Escape') {
				event.preventDefault();
				closePageContextMenu();
				return;
			}

			if (layerContextMenu && event.key === 'Escape') {
				event.preventDefault();
				closeLayerContextMenu();
				return;
			}

			if (settingsOpen && event.key === 'Escape') {
				event.preventDefault();
				closeProjectSettings();
				return;
			}

			if (svgImportOpen && event.key === 'Escape') {
				event.preventDefault();
				svgImportOpen = false;
				return;
			}

			if (svgExportOpen && event.key === 'Escape') {
				event.preventDefault();
				svgExportOpen = false;
				return;
			}

			if (isTextInput(event.target)) {
				return;
			}

			if (event.code === 'Space') {
				event.preventDefault();
				spacePressed = true;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				handleEscapeKey();
				return;
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();

				if (event.shiftKey) {
					redo();
				} else {
					undo();
				}
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
				event.preventDefault();

				if (event.shiftKey) {
					ungroupSelection();
				} else {
					groupSelection();
				}
			}

			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				deleteSelection();
			}
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.code === 'Space') {
				spacePressed = false;
				panning = false;
				lastPanPoint = undefined;
			}
		};

		const handleWindowClick = () => {
			closePageContextMenu();
			closeLayerContextMenu();
		};

		resize();
		void fitCanvasToDocumentAfterLayout();
		window.addEventListener('resize', resize);
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		window.addEventListener('click', handleWindowClick);

		return () => {
			closeHostWebSocket();
			window.removeEventListener('resize', resize);
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('click', handleWindowClick);
		};
	});

	function setTool(nextTool: Tool) {
		tool = nextTool;
		closeToolTooltip();
		draftStart = undefined;
		draftEnd = undefined;
		shapePreviewPoint = undefined;
		activePathNodeId = undefined;
		dragging = false;
		editingHandle = undefined;
		panning = false;
		snapTarget = undefined;
	}

	function setLineTool(mode: PathSegmentMode) {
		pathSegmentMode = mode;
		closeToolTooltip();

		if (tool !== 'path') {
			setTool('path');
		}
	}

	function handleEscapeKey() {
		if (editingHandle || dragging || panning) {
			editingHandle = undefined;
			dragging = false;
			panning = false;
			lastDragPoint = undefined;
			lastPanPoint = undefined;
			blurActiveElement();
			return;
		}

		if (editingGroupId) {
			exitGroupEdit();
			blurActiveElement();
			return;
		}

		if (tool === 'path') {
			if (draftStart || draftEnd || activePathNodeId || snapTarget) {
				finishPathDrawing();
				blurActiveElement();
				return;
			}

			setTool('select');
			blurActiveElement();
			return;
		}

		if (tool === 'text' || isShapeTool(tool)) {
			setTool('select');
			blurActiveElement();
			return;
		}

		cancelDraft();
		blurActiveElement();
	}

	function blurActiveElement() {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}

	function handlePointerDown(event: PointerEvent) {
		const screenPoint = pointerToScreen(event);
		const rawWorldPoint = pointerToWorld(event);
		const worldPoint =
			tool === 'select' || isShapeTool(tool) ? rawWorldPoint : snapWorldPoint(rawWorldPoint);

		canvas.setPointerCapture(event.pointerId);

		if (event.button === 1 || event.button === 2 || spacePressed) {
			event.preventDefault();
			panning = true;
			lastPanPoint = screenPoint;
			return;
		}

		if (event.button !== 0) {
			return;
		}

		if (tool === 'select') {
			const hitHandle = hitTestEditHandle(
				geometryDocument,
				selectedNodeIds,
				worldPoint,
				8 / viewport.zoom
			);

			if (hitHandle) {
				editingHandle = hitHandle;
				selectedNodeIds = [hitHandle.nodeId];
				beginLiveEdit();
				return;
			}

			const hitNodeId = hitTest(geometryDocument, worldPoint, {
				tolerance: 8 / viewport.zoom
			});
			const selectableNodeId = hitNodeId ? canvasSelectableNodeId(hitNodeId) : undefined;

			if (selectableNodeId) {
				selectNode(selectableNodeId, event.shiftKey || event.metaKey || event.ctrlKey);
			} else if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
				selectedNodeIds = [];
			}

			dragging = Boolean(selectableNodeId);
			lastDragPoint = worldPoint;

			if (selectableNodeId) {
				beginLiveEdit();
			}

			return;
		}

		if (isShapeTool(tool)) {
			insertShapeAtPoint(tool, worldPoint);
			return;
		}

		if (tool === 'text') {
			insertTextAtPoint(worldPoint);
			return;
		}

		if (tool === 'path') {
			handlePathPointerDown(worldPoint);
			return;
		}
	}

	function handlePointerMove(event: PointerEvent) {
		const screenPoint = pointerToScreen(event);
		const rawWorldPoint = pointerToWorld(event);
		const worldPoint =
			tool === 'path' || (draftStart && tool !== 'select')
				? snapWorldPoint(rawWorldPoint)
				: rawWorldPoint;

		if (panning && lastPanPoint) {
			shapePreviewPoint = undefined;
			viewport = panViewport(viewport, {
				x: screenPoint.x - lastPanPoint.x,
				y: screenPoint.y - lastPanPoint.y
			});
			lastPanPoint = screenPoint;
			return;
		}

		if (isShapeTool(tool)) {
			shapePreviewPoint = clampPointToDocument(rawWorldPoint);
		} else {
			shapePreviewPoint = undefined;
		}

		if (tool === 'select' && dragging && lastDragPoint) {
			const dx = worldPoint.x - lastDragPoint.x;
			const dy = worldPoint.y - lastDragPoint.y;

			if (dx === 0 && dy === 0) {
				return;
			}

			let nextDocument = geometryDocument;

			for (const nodeId of effectiveSelectedNodeIds()) {
				nextDocument = applyPatch(nextDocument, {
					op: 'move',
					target: nodeId,
					dx,
					dy
				});
			}

			updateActiveDocument(nextDocument);
			liveEditDidChange = true;
			lastDragPoint = worldPoint;
			return;
		}

		if (tool === 'select' && editingHandle) {
			const patch = createEditHandleUpdatePatch(geometryDocument, editingHandle, worldPoint);

			if (patch && updatePatchChangesNode(patch)) {
				updateActiveDocument(applyPatch(geometryDocument, patch));
				liveEditDidChange = true;
			}

			return;
		}

		if (draftStart) {
			draftEnd = worldPoint;
		}
	}

	function handlePointerUp(event: PointerEvent) {
		canvas.releasePointerCapture(event.pointerId);

		if (panning) {
			panning = false;
			lastPanPoint = undefined;
			return;
		}

		if (tool === 'select') {
			dragging = false;
			editingHandle = undefined;
			lastDragPoint = undefined;
			finishLiveEdit();
			return;
		}
	}

	function handlePointerLeave() {
		shapePreviewPoint = undefined;
		snapTarget = undefined;
	}

	function handleCanvasDoubleClick(event: MouseEvent) {
		if (tool !== 'select') {
			return;
		}

		const hitNodeId = hitTest(geometryDocument, pointerToWorld(event), {
			tolerance: 8 / viewport.zoom
		});
		const selectableNodeId = hitNodeId ? canvasSelectableNodeId(hitNodeId) : undefined;
		const node = selectableNodeId ? findNode(geometryDocument, selectableNodeId) : undefined;

		if (node?.type === 'group') {
			editGroup(node.id);
		}
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();

		const screenPoint = pointerToScreen(event);
		const zoomMultiplier = Math.exp(-event.deltaY * 0.0008);
		viewport = zoomViewportAtPoint(viewport, screenPoint, viewport.zoom * zoomMultiplier);
	}

	function updateDocumentDimension(field: 'width' | 'height', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const value = Number(input.value);

		if (!Number.isFinite(value)) {
			return;
		}

		commitPatch({
			op: 'updateDocument',
			changes: {
				[field]: value
			}
		});
	}

	function updateDocumentViewBox(field: keyof ViewBox, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const value = Number(input.value);

		if (!Number.isFinite(value)) {
			return;
		}

		const viewBox = {
			...getDocumentViewBox(geometryDocument),
			[field]: value
		};

		if (viewBox.width <= 0 || viewBox.height <= 0) {
			return;
		}

		commitPatch({
			op: 'updateDocument',
			changes: { viewBox }
		});
	}

	function updatePageName(pageId: string, value: string) {
		const name = value.trim();
		const page = project.pages.find((candidate) => candidate.id === pageId);

		if (!page || !name || page.name === name) {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			pages: project.pages.map((candidate) =>
				candidate.id === pageId
					? {
							...candidate,
							name,
							document: {
								...candidate.document,
								name
							}
						}
					: candidate
			),
			updatedAt: new Date().toISOString()
		};
		markProjectChanged();
	}

	function updateActivePageName(event: Event) {
		updatePageName(project.activePageId, (event.currentTarget as HTMLInputElement).value);
	}

	function startProjectNameRename() {
		renamingProjectName = true;
		projectNameDraft = project.name;
		void tick().then(() => {
			projectNameInput?.focus();
			projectNameInput?.select();
		});
	}

	function confirmProjectNameRename() {
		if (!renamingProjectName) {
			return;
		}

		const name = projectNameDraft.trim();
		renamingProjectName = false;
		projectNameDraft = '';

		if (!name || name === project.name) {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			name,
			updatedAt: new Date().toISOString()
		};
		markProjectChanged();
	}

	function cancelProjectNameRename() {
		renamingProjectName = false;
		projectNameDraft = '';
	}

	function handleProjectNameKeyDown(event: KeyboardEvent) {
		event.stopPropagation();

		if (event.key === 'Enter') {
			event.preventDefault();
			confirmProjectNameRename();
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			cancelProjectNameRename();
		}
	}

	type BackgroundPreset = 'alpha' | 'black' | 'gray' | 'white';

	function updateDocumentBackground(preset: BackgroundPreset) {
		commitPatch({
			op: 'updateDocument',
			changes: {
				background: backgroundFromPreset(preset)
			}
		});
	}

	function updateProjectPrompt(value: string) {
		project = {
			...project,
			projectPrompt: value,
			updatedAt: new Date().toISOString()
		};
		markProjectChanged();
	}

	function updateDefaultCanvas(field: 'width' | 'height', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const value = Math.max(1, Number(input.value));

		if (!Number.isFinite(value)) {
			return;
		}

		const current = projectDefaultCanvas();

		project = {
			...project,
			settings: {
				...project.settings,
				defaultCanvas: {
					...current,
					[field]: value
				}
			},
			updatedAt: new Date().toISOString()
		};
		markProjectChanged();
	}

	function projectDefaultCanvas() {
		return {
			width: project.settings?.defaultCanvas?.width ?? geometryDocument.width,
			height: project.settings?.defaultCanvas?.height ?? geometryDocument.height
		};
	}

	function openProjectSettings() {
		settingsEditStartProject = cloneProject(project);
		settingsOpen = true;
	}

	function closeProjectSettings() {
		if (settingsEditStartProject && !projectsEqual(settingsEditStartProject, project)) {
			undoStack = [...undoStack, settingsEditStartProject];
			redoStack = [];
		}

		settingsEditStartProject = undefined;
		settingsOpen = false;
	}

	function backgroundFromPreset(preset: BackgroundPreset): DocumentBackground {
		if (preset === 'gray') {
			return { type: 'solid', color: themeColor('page-gray', pageBackgroundColorFallbacks.gray) };
		}

		if (preset === 'black') {
			return { type: 'solid', color: themeColor('page-black', pageBackgroundColorFallbacks.black) };
		}

		if (preset === 'alpha') {
			return {
				type: 'checkerboard',
				light: themeColor('page-alpha-light', pageBackgroundColorFallbacks.alphaLight),
				dark: themeColor('page-alpha-dark', pageBackgroundColorFallbacks.alphaDark),
				size: 32
			};
		}

		return { type: 'solid', color: themeColor('page-white', pageBackgroundColorFallbacks.white) };
	}

	function themeColor(name: string, fallback: string) {
		if (typeof window === 'undefined') {
			return fallback;
		}

		return (
			getComputedStyle(document.documentElement).getPropertyValue(`--color-gs-${name}`).trim() ||
			fallback
		);
	}

	function normalizeColor(color: string) {
		return color.trim().toLowerCase();
	}

	function backgroundPreset(background: DocumentBackground | undefined): BackgroundPreset {
		if (background?.type === 'checkerboard') {
			return 'alpha';
		}

		if (background?.type === 'solid') {
			const color = normalizeColor(background.color);
			const black = normalizeColor(themeColor('page-black', pageBackgroundColorFallbacks.black));
			const gray = normalizeColor(themeColor('page-gray', pageBackgroundColorFallbacks.gray));

			if (color === black || color === '#000000' || color === 'black') {
				return 'black';
			}

			if (
				color === gray ||
				color === '#6b7280' ||
				color === '#808080' ||
				color === '#a0a0a0' ||
				color === 'gray' ||
				color === 'grey'
			) {
				return 'gray';
			}
		}

		return 'white';
	}

	function updateZoomPercent(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const value = Number(input.value);

		if (!Number.isFinite(value)) {
			return;
		}

		viewport = zoomViewportAtPoint(viewport, canvasCenterPoint(), value / 100);
	}

	function adjustZoom(multiplier: number) {
		viewport = zoomViewportAtPoint(viewport, canvasCenterPoint(), viewport.zoom * multiplier);
	}

	function fitCanvasToDocument() {
		const rect = resizeCanvasToElement();

		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}

		viewport = fitViewportToDocument(geometryDocument, {
			width: rect.width,
			height: rect.height
		});
	}

	function fitInitialCanvasToDocument() {
		fitCanvasToDocument();
		hasFitInitialViewport = true;
	}

	async function fitCanvasToDocumentAfterLayout() {
		await tick();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		if (canvas) {
			fitInitialCanvasToDocument();
		}
	}

	function resizeCanvasToElement() {
		const rect = canvas.getBoundingClientRect();
		canvasPixelRatio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(rect.width * canvasPixelRatio));
		canvas.height = Math.max(1, Math.round(rect.height * canvasPixelRatio));

		return rect;
	}

	function setActualSizeZoom() {
		viewport = zoomViewportAtPoint(viewport, canvasCenterPoint(), 1);
	}

	function fitCanvasToActivePageAfterUpdate() {
		void tick().then(() => {
			if (canvas) {
				fitCanvasToDocument();
			}
		});
	}

	function canvasCenterPoint(): Point {
		const rect = canvas.getBoundingClientRect();

		return {
			x: rect.width / 2,
			y: rect.height / 2
		};
	}

	function confirmPathDraft() {
		if (!draftStart || !draftEnd || tool !== 'path') {
			return;
		}

		const distance = Math.hypot(draftEnd.x - draftStart.x, draftEnd.y - draftStart.y);

		if (distance > 2 / viewport.zoom) {
			const pathId = `path-${nextNodeIndex}`;
			const patch = createLinePathInsertPatch({
				id: pathId,
				start: draftStart,
				end: draftEnd,
				segmentMode: pathSegmentMode,
				style: defaultStrokeStyle()
			});

			commitPatch(patch);
			selectedNodeIds = [pathId];
			activePathNodeId = pathId;
			nextNodeIndex += 1;
			draftStart = draftEnd;
			draftEnd = draftEnd;
		}
	}

	function handlePathPointerDown(point: Point) {
		if (!draftStart) {
			const existingPathStart = getAppendablePathStart(point);

			if (existingPathStart) {
				activePathNodeId = existingPathStart.nodeId;
				selectedNodeIds = [existingPathStart.nodeId];
				draftStart = existingPathStart.point;
				draftEnd = existingPathStart.point;
				return;
			}

			selectedNodeIds = [];
			activePathNodeId = undefined;
			draftStart = point;
			draftEnd = point;
			return;
		}

		draftEnd = point;

		if (activePathNodeId) {
			appendPathSegment(point);
			return;
		}

		confirmPathDraft();
	}

	function appendPathSegment(point: Point) {
		if (!activePathNodeId || !draftStart) {
			return;
		}

		if (isPointOnActivePathStart(point)) {
			closeActivePath();
			return;
		}

		const distance = Math.hypot(point.x - draftStart.x, point.y - draftStart.y);

		if (distance <= 2 / viewport.zoom) {
			return;
		}

		const patch = createAppendPathSegmentPatch(
			geometryDocument,
			activePathNodeId,
			point,
			pathSegmentMode
		);

		if (!patch) {
			finishPathDrawing();
			return;
		}

		commitPatch(patch);
		selectedNodeIds = [activePathNodeId];
		draftStart = point;
		draftEnd = point;
	}

	function closeActivePath() {
		if (!activePathNodeId) {
			return;
		}

		const patch = createPathClosedUpdatePatch(geometryDocument, activePathNodeId, true);

		if (!patch) {
			finishPathDrawing();
			return;
		}

		commitPatch(patch);
		selectedNodeIds = [activePathNodeId];
		finishPathDrawing();
	}

	function getAppendablePathStart(point: Point): { nodeId: NodeId; point: Point } | undefined {
		if (!snapTarget || !pointsEqual(snapTarget.point, point)) {
			return undefined;
		}

		const node = findNode(geometryDocument, snapTarget.nodeId);

		if (!isPathNode(node) || node.closed) {
			return undefined;
		}

		const endPoint = getPathEndPoint(node);

		if (!pointsEqual(point, endPoint)) {
			return undefined;
		}

		return {
			nodeId: node.id,
			point: endPoint
		};
	}

	function isPointOnActivePathStart(point: Point): boolean {
		if (!activePathNodeId || !snapTarget || snapTarget.nodeId !== activePathNodeId) {
			return false;
		}

		const node = findNode(geometryDocument, activePathNodeId);

		return isPathNode(node) && pointsEqual(point, node.start);
	}

	function isPathNode(node: GeometryNode | undefined): node is PathNode {
		return Boolean(node && node.type === 'path');
	}

	function getPathEndPoint(node: PathNode): Point {
		return node.segments.at(-1)?.to ?? node.start;
	}

	function pointsEqual(a: Point, b: Point): boolean {
		return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
	}

	function catmullControl1(previous: Point, start: Point, end: Point): Point {
		return {
			x: start.x + (end.x - previous.x) / 6,
			y: start.y + (end.y - previous.y) / 6
		};
	}

	function catmullControl2(start: Point, end: Point, next: Point): Point {
		return {
			x: end.x - (next.x - start.x) / 6,
			y: end.y - (next.y - start.y) / 6
		};
	}

	function finishPathDrawing() {
		activePathNodeId = undefined;
		editingHandle = undefined;
		dragging = false;
		cancelDraft();
	}

	function cancelDraft() {
		draftStart = undefined;
		draftEnd = undefined;
		shapePreviewPoint = undefined;
		snapTarget = undefined;
	}

	function snapWorldPoint(point: Point): Point {
		const snap = snapPointToExistingVertex(geometryDocument, point, 8 / viewport.zoom);
		snapTarget = snap;

		return snap?.point ?? point;
	}

	function pointerToScreen(event: MouseEvent | PointerEvent | WheelEvent): Point {
		const rect = canvas.getBoundingClientRect();

		return {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
	}

	function pointerToWorld(event: MouseEvent | PointerEvent): Point {
		return screenToWorld(pointerToScreen(event), viewport);
	}

	function isTextInput(target: EventTarget | null): boolean {
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
	}

	function isShapeTool(value: Tool): value is ShapeTool {
		return value === 'rect' || value === 'ellipse' || value === 'triangle';
	}

	function insertShapeAtPoint(shapeTool: ShapeTool, point: Point) {
		const id = `${shapeTool}-${nextNodeIndex}`;
		const placementPoint = clampPointToDocument(point);
		const { start, end } = shapeBoundsForPlacement(shapeTool, placementPoint, placementPoint);
		const patch = createShapeInsertPatch(shapeTool, id, start, end);

		commitPatch(patch);
		selectedNodeIds = [id];
		nextNodeIndex += 1;
		cancelDraft();
		shapePreviewPoint = placementPoint;
	}

	function insertTextAtPoint(point: Point) {
		const id = `text-${nextNodeIndex}`;
		const placementPoint = clampPointToDocument(point);
		const node: TextNode = {
			id,
			type: 'text',
			x: placementPoint.x,
			y: placementPoint.y,
			text: 'Text',
			fill: '#111827',
			fontFamily: 'Inter, system-ui, sans-serif',
			fontSize: defaultTextFontSize(),
			fontWeight: '400'
		};

		commitPatch({
			op: 'insert',
			parentId: geometryDocument.root.id,
			node
		});
		selectedNodeIds = [id];
		nextNodeIndex += 1;
		cancelDraft();
	}

	function clampPointToDocument(point: Point): Point {
		const viewBox = getDocumentViewBox(geometryDocument);

		return {
			x: Math.min(Math.max(point.x, viewBox.x), viewBox.x + viewBox.width),
			y: Math.min(Math.max(point.y, viewBox.y), viewBox.y + viewBox.height)
		};
	}

	function shapeBoundsForPlacement(shapeTool: ShapeTool, start: Point, end: Point) {
		const distance = Math.hypot(end.x - start.x, end.y - start.y);

		if (distance > 2 / viewport.zoom) {
			return { start, end };
		}

		const defaultSize = defaultShapeSize(shapeTool);

		return clampBoundsToDocument({
			start: {
				x: start.x - defaultSize.width / 2,
				y: start.y - defaultSize.height / 2
			},
			end: {
				x: start.x + defaultSize.width / 2,
				y: start.y + defaultSize.height / 2
			}
		});
	}

	function defaultShapeSize(shapeTool: ShapeTool) {
		const viewBox = getDocumentViewBox(geometryDocument);
		const canvasWidth = Math.max(1, viewBox.width);
		const canvasHeight = Math.max(1, viewBox.height);
		const shortSide = Math.min(canvasWidth, canvasHeight);
		const widthRatio = shapeTool === 'ellipse' ? 0.44 : shapeTool === 'triangle' ? 0.34 : 0.38;
		const heightRatio = shapeTool === 'triangle' ? 0.3 : 0.25;

		return {
			width: clampDimension(shortSide * widthRatio, 1, canvasWidth),
			height: clampDimension(shortSide * heightRatio, 1, canvasHeight)
		};
	}

	function defaultTextFontSize() {
		const viewBox = getDocumentViewBox(geometryDocument);
		const shortSide = Math.max(1, Math.min(viewBox.width, viewBox.height));

		return clampDimension(shortSide * 0.094, 1, Math.max(1, viewBox.height));
	}

	function defaultStrokeWidth() {
		const viewBox = getDocumentViewBox(geometryDocument);
		const shortSide = Math.max(1, Math.min(viewBox.width, viewBox.height));

		return clampDimension(shortSide * 0.008, 0.5, 64);
	}

	function defaultStrokeStyle(): NodeStyle {
		return {
			fill: 'none',
			stroke: uiColors.primary,
			strokeWidth: defaultStrokeWidth()
		};
	}

	function clampBoundsToDocument(bounds: { start: Point; end: Point }) {
		const viewBox = getDocumentViewBox(geometryDocument);
		const x = Math.min(bounds.start.x, bounds.end.x);
		const y = Math.min(bounds.start.y, bounds.end.y);
		const width = Math.abs(bounds.end.x - bounds.start.x);
		const height = Math.abs(bounds.end.y - bounds.start.y);
		const nextX = clampDimension(
			x,
			viewBox.x,
			Math.max(viewBox.x, viewBox.x + viewBox.width - width)
		);
		const nextY = clampDimension(
			y,
			viewBox.y,
			Math.max(viewBox.y, viewBox.y + viewBox.height - height)
		);

		return {
			start: { x: nextX, y: nextY },
			end: { x: nextX + width, y: nextY + height }
		};
	}

	function clampDimension(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	function createShapeInsertPatch(shapeTool: ShapeTool, id: NodeId, start: Point, end: Point) {
		const style = defaultStrokeStyle();

		if (shapeTool === 'rect') {
			return createRectInsertPatch({ id, start, end, style });
		}

		if (shapeTool === 'ellipse') {
			return createEllipseInsertPatch({ id, start, end, style });
		}

		return createTriangleInsertPatch({ id, start, end, style });
	}

	function commitPatch(patch: Parameters<typeof applyPatch>[1]) {
		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		const nextDocument = applyPatch(geometryDocument, patch);
		const roundedNodeIds = geometryPatchNodeIds(patch);

		updateActiveDocument(
			roundedNodeIds.length > 0
				? roundGeometryDocument(nextDocument, roundedNodeIds, coordinateDecimalPlaces)
				: nextDocument
		);
	}

	function beginLiveEdit() {
		liveEditStartProject = cloneProject(project);
		liveEditDidChange = false;
		redoStack = [];
	}

	function finishLiveEdit() {
		if (!liveEditStartProject) {
			return;
		}

		const roundedNodeIds = effectiveSelectedNodeIds();

		if (liveEditDidChange && roundedNodeIds.length > 0) {
			updateActiveDocument(
				roundGeometryDocument(geometryDocument, roundedNodeIds, coordinateDecimalPlaces)
			);
		}

		undoStack = [...undoStack, liveEditStartProject];
		liveEditStartProject = undefined;
		liveEditDidChange = false;
	}

	function geometryPatchNodeIds(patch: Parameters<typeof applyPatch>[1]): NodeId[] {
		switch (patch.op) {
			case 'insert':
				return [patch.node.id];
			case 'move':
				return [patch.target];
			case 'update':
				return hasGeometryChanges(patch.changes) ? [patch.target] : [];
			case 'delete':
			case 'reorder':
			case 'reparent':
			case 'updateDocument':
			case 'gradientUpsert':
			case 'gradientDelete':
				return [];
		}
	}

	function hasGeometryChanges(changes: Partial<GeometryNode>): boolean {
		return Object.keys(changes).some((field) =>
			[
				'cx',
				'cy',
				'height',
				'points',
				'r',
				'runs',
				'rx',
				'ry',
				'segments',
				'spline',
				'start',
				'width',
				'x',
				'x1',
				'x2',
				'y',
				'y1',
				'y2'
			].includes(field)
		);
	}

	function updatePatchChangesNode(
		patch: Extract<Parameters<typeof applyPatch>[1], { op: 'update' }>
	) {
		const node = findNode(geometryDocument, patch.target);

		if (!node) {
			return false;
		}

		const currentValues = node as unknown as Record<string, unknown>;

		return Object.entries(patch.changes).some(([field, value]) => currentValues[field] !== value);
	}

	function undo() {
		const previous = undoStack.at(-1);

		if (!previous) {
			return;
		}

		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, cloneProject(project)];
		project = previous;
		cancelDraft();
		selectedNodeIds = [];
		editingGroupId = undefined;
		markProjectChanged();
	}

	function redo() {
		const next = redoStack.at(-1);

		if (!next) {
			return;
		}

		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, cloneProject(project)];
		project = next;
		cancelDraft();
		selectedNodeIds = [];
		editingGroupId = undefined;
		markProjectChanged();
	}

	function deleteSelection() {
		if (selectedNodeIds.length === 0) {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		let nextDocument = geometryDocument;

		for (const nodeId of effectiveSelectedNodeIds()) {
			nextDocument = applyPatch(nextDocument, {
				op: 'delete',
				target: nodeId
			});
		}

		updateActiveDocument(nextDocument);
		selectedNodeIds = [];
		cancelDraft();
	}

	function setActivePage(pageId: string) {
		if (pageId === project.activePageId) {
			return;
		}

		project = {
			...project,
			activePageId: pageId
		};
		selectedNodeIds = [];
		editingGroupId = undefined;
		finishPathDrawing();
		fitCanvasToActivePageAfterUpdate();
		markProjectChanged();
		closePageContextMenu();
	}

	function addPage() {
		const pageId = nextPageId();
		const defaultCanvas = projectDefaultCanvas();
		const page = createPage({
			pageId,
			name: `Page ${project.pages.length + 1}`,
			width: defaultCanvas.width,
			height: defaultCanvas.height
		});

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			activePageId: page.id,
			pages: [...project.pages, page],
			updatedAt: new Date().toISOString()
		};
		selectedNodeIds = [];
		finishPathDrawing();
		fitCanvasToActivePageAfterUpdate();
		markProjectChanged();
	}

	function addImportedSvgPage(importedDocument: GeometryDocument, pageName: string) {
		const pageId = nextPageId();
		const page = {
			id: pageId,
			name: pageName,
			document: {
				...importedDocument,
				id: `${pageId}-document`,
				name: pageName
			}
		};

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			activePageId: page.id,
			pages: [...project.pages, page],
			updatedAt: new Date().toISOString()
		};
		selectedNodeIds = [];
		editingGroupId = undefined;
		finishPathDrawing();
		fitCanvasToActivePageAfterUpdate();
		markProjectChanged();
	}

	async function importSvgFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';

		if (!file) {
			return;
		}

		const pageName = file.name.replace(/\.svg$/i, '').trim() || `Page ${project.pages.length + 1}`;
		let importedDocument: GeometryDocument;

		try {
			importedDocument = importFromSvg(await file.text());
		} catch (error) {
			window.alert(error instanceof Error ? error.message : 'Failed to import SVG.');
			return;
		}

		addImportedSvgPage(importedDocument, pageName);
		svgImportOpen = false;
	}

	function importSvgText() {
		const svgText = svgImportText.trim();

		if (!svgText) {
			return;
		}

		try {
			addImportedSvgPage(importFromSvg(svgText), `Imported SVG ${project.pages.length + 1}`);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : 'Failed to import SVG.');
			return;
		}

		svgImportText = '';
		svgImportOpen = false;
	}

	function duplicatePage(pageId = project.activePageId) {
		const sourcePage = project.pages.find((page) => page.id === pageId) ?? activePage;
		const duplicatePageId = nextPageId();
		const document = cloneDocument(sourcePage.document);

		document.id = `${duplicatePageId}-document`;
		document.name = `${sourcePage.name} Copy`;

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			activePageId: duplicatePageId,
			pages: [
				...project.pages,
				{
					id: duplicatePageId,
					name: document.name,
					document
				}
			],
			updatedAt: new Date().toISOString()
		};
		selectedNodeIds = [];
		finishPathDrawing();
		fitCanvasToActivePageAfterUpdate();
		markProjectChanged();
		closePageContextMenu();
	}

	function deletePage(pageId = project.activePageId) {
		if (project.pages.length <= 1) {
			return;
		}

		const pageIndex = project.pages.findIndex((page) => page.id === pageId);

		if (pageIndex < 0) {
			return;
		}

		const pages = project.pages.filter((page) => page.id !== pageId);
		const fallbackPage = pages[Math.max(0, pageIndex - 1)] ?? pages[0];
		const deletingActivePage = pageId === project.activePageId;
		const nextActivePageId = deletingActivePage ? fallbackPage?.id : project.activePageId;

		if (!nextActivePageId) {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		project = {
			...project,
			activePageId: nextActivePageId,
			pages,
			updatedAt: new Date().toISOString()
		};

		if (deletingActivePage) {
			selectedNodeIds = [];
			finishPathDrawing();
			fitCanvasToActivePageAfterUpdate();
		}

		markProjectChanged();
		closePageContextMenu();
	}

	function openPageContextMenu(event: MouseEvent, pageId: string) {
		event.preventDefault();
		event.stopPropagation();
		closePageTooltip();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const page = project.pages.find((candidate) => candidate.id === pageId);
		pageContextMenu = {
			pageId,
			x: rect.left + rect.width / 2,
			y: rect.top
		};
		renamingPageId = undefined;
		renamingPageName = page?.name ?? '';
	}

	function closePageContextMenu() {
		pageContextMenu = undefined;
		renamingPageId = undefined;
		renamingPageName = '';
	}

	function showPageTooltip(event: MouseEvent | FocusEvent, text: string) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const maxTooltipWidth = 260;
		const gutter = 12;
		const minX = gutter + maxTooltipWidth / 2;
		const maxX = window.innerWidth - gutter - maxTooltipWidth / 2;

		pageTooltip = {
			text,
			x: Math.min(Math.max(rect.left + rect.width / 2, minX), maxX),
			y: rect.top
		};
	}

	function closePageTooltip() {
		pageTooltip = undefined;
	}

	function showToolTooltip(event: MouseEvent | FocusEvent, text: string) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const gutter = 12;
		const tooltipOffset = 10;
		const maxTooltipWidth = 180;

		toolTooltip = {
			text,
			x: Math.max(
				gutter,
				Math.min(rect.right + tooltipOffset, window.innerWidth - gutter - maxTooltipWidth)
			),
			y: rect.top + rect.height / 2
		};
	}

	function closeToolTooltip() {
		toolTooltip = undefined;
	}

	function openLayerContextMenu(event: MouseEvent, nodeId?: NodeId) {
		event.preventDefault();
		event.stopPropagation();

		if (nodeId && !selectedNodeIds.includes(nodeId)) {
			selectedNodeIds = [nodeId];
		}

		layerContextMenu = {
			nodeId,
			x: event.clientX,
			y: event.clientY
		};
	}

	function closeLayerContextMenu() {
		layerContextMenu = undefined;
	}

	function handleCanvasContextMenu(event: MouseEvent) {
		event.preventDefault();

		if (tool !== 'select') {
			return;
		}

		const hitNodeId = hitTest(geometryDocument, pointerToWorld(event), {
			tolerance: 8 / viewport.zoom
		});
		const selectableNodeId = hitNodeId ? canvasSelectableNodeId(hitNodeId) : undefined;

		if (selectableNodeId && !selectedNodeIds.includes(selectableNodeId)) {
			selectedNodeIds = [selectableNodeId];
		}

		openLayerContextMenu(event, selectableNodeId);
	}

	function startPageContextRename() {
		if (!pageContextMenuPage) {
			return;
		}

		renamingPageId = pageContextMenuPage.id;
		renamingPageName = pageContextMenuPage.name;
		void tick().then(() => {
			pageRenameInput?.focus();
			pageRenameInput?.select();
		});
	}

	function confirmPageContextRename() {
		if (!renamingPageId) {
			return;
		}

		updatePageName(renamingPageId, renamingPageName);
		renamingPageId = undefined;
		renamingPageName = '';
	}

	function cancelPageContextRename() {
		renamingPageId = undefined;
		renamingPageName = '';
	}

	function handlePageRenameKeyDown(event: KeyboardEvent) {
		event.stopPropagation();

		if (event.key === 'Enter') {
			event.preventDefault();
			confirmPageContextRename();
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			cancelPageContextRename();
		}
	}

	function handleLayerSortStart(event: DragStartEvent) {
		if (!isSortable(event.operation.source)) {
			return;
		}

		layerDragNodeId = String(event.operation.source.id);
		layerDragStartProject = cloneProject(project);
	}

	function handleLayerSortOver(event: DragOverEvent) {
		const { source, target } = event.operation;

		if (!isSortable(source) || !isSortable(target) || source.id === target.id) {
			return;
		}

		const sourceItem = visibleLayerItems.find((item) => item.node.id === source.id);
		const targetItem = visibleLayerItems.find((item) => item.node.id === target.id);

		if (!sourceItem || !targetItem) {
			return;
		}

		moveLayer(sourceItem, targetItem);
	}

	function handleLayerSortEnd(event: DragEndEvent) {
		const startProject = layerDragStartProject;
		layerDragStartProject = undefined;
		layerDragNodeId = undefined;

		if (!startProject) {
			return;
		}

		if (event.canceled) {
			project = startProject;
			markProjectChanged();
			return;
		}

		if (projectsEqual(project, startProject)) {
			return;
		}

		undoStack = [...undoStack, startProject];
		redoStack = [];
	}

	function moveLayer(sourceItem: LayerItem, targetItem: LayerItem) {
		if (targetItem.node.type === 'group' && targetItem.node.id !== sourceItem.parentId) {
			moveLayerIntoGroup(sourceItem, targetItem.node.id);
			return;
		}

		if (sourceItem.parentId === targetItem.parentId) {
			reorderLayer(sourceItem, targetItem);
			return;
		}

		moveLayerToParent(sourceItem, targetItem.parentId, targetItem.astIndex);
	}

	function reorderLayer(sourceItem: LayerItem, targetItem: LayerItem) {
		if (sourceItem.astIndex === targetItem.astIndex) {
			return;
		}

		updateActiveDocument(
			reorderChildren(
				geometryDocument,
				sourceItem.parentId,
				sourceItem.astIndex,
				targetItem.astIndex
			)
		);
	}

	function moveLayerIntoGroup(sourceItem: LayerItem, targetParentId: NodeId) {
		const targetParent = findNode(geometryDocument, targetParentId);

		if (
			!targetParent ||
			targetParent.type !== 'group' ||
			!canMoveLayerToParent(sourceItem.node.id, targetParentId)
		) {
			return;
		}

		updateActiveDocument(
			moveNodeToParent(
				geometryDocument,
				sourceItem.node.id,
				targetParentId,
				targetParent.children.length
			)
		);
		expandedGroupIds = [...new Set([...expandedGroupIds, targetParentId])];
	}

	function moveLayerToParent(sourceItem: LayerItem, targetParentId: NodeId, targetIndex: number) {
		if (!canMoveLayerToParent(sourceItem.node.id, targetParentId)) {
			return;
		}

		updateActiveDocument(
			moveNodeToParent(geometryDocument, sourceItem.node.id, targetParentId, targetIndex)
		);
	}

	function canMoveLayerToParent(nodeId: NodeId, targetParentId: NodeId) {
		return (
			nodeId !== geometryDocument.root.id &&
			nodeId !== targetParentId &&
			!isAncestorOf(nodeId, targetParentId)
		);
	}

	function selectNode(nodeId: NodeId, additive = false) {
		if (!additive) {
			selectedNodeIds = [nodeId];
			return;
		}

		selectedNodeIds = selectedNodeIds.includes(nodeId)
			? selectedNodeIds.filter((selectedNodeId) => selectedNodeId !== nodeId)
			: [...selectedNodeIds, nodeId];
	}

	function toggleGroupExpanded(nodeId: NodeId) {
		expandedGroupIds = expandedGroupIds.includes(nodeId)
			? expandedGroupIds.filter((expandedGroupId) => expandedGroupId !== nodeId)
			: [...expandedGroupIds, nodeId];
	}

	function editGroup(nodeId: NodeId) {
		const node = findNode(geometryDocument, nodeId);

		if (!node || node.type !== 'group') {
			return;
		}

		editingGroupId = nodeId;
		expandedGroupIds = [...new Set([...expandedGroupIds, nodeId])];
		selectedNodeIds = [];
	}

	function exitGroupEdit() {
		editingGroupId = undefined;
		selectedNodeIds = [];
	}

	function selectedNodesHaveSameParent() {
		if (selectedNodeIds.length < 2) {
			return false;
		}

		const parents = selectedNodeIds.map((nodeId) => findParentNode(geometryDocument, nodeId));
		const firstParentId = parents[0]?.id;

		return Boolean(firstParentId && parents.every((parent) => parent?.id === firstParentId));
	}

	function effectiveSelectedNodeIds() {
		return selectedNodeIds.filter(
			(nodeId) =>
				!selectedNodeIds.some(
					(candidateId) => candidateId !== nodeId && isAncestorOf(candidateId, nodeId)
				)
		);
	}

	function isAncestorOf(ancestorId: NodeId, nodeId: NodeId) {
		let parent = findParentNode(geometryDocument, nodeId);

		while (parent) {
			if (parent.id === ancestorId) {
				return true;
			}

			if (parent.id === geometryDocument.root.id) {
				return false;
			}

			parent = findParentNode(geometryDocument, parent.id);
		}

		return false;
	}

	function canvasSelectableNodeId(hitNodeId: NodeId): NodeId | undefined {
		if (editingGroupId) {
			if (hitNodeId === editingGroupId) {
				return undefined;
			}

			if (isAncestorOf(editingGroupId, hitNodeId)) {
				return hitNodeId;
			}

			editingGroupId = undefined;
		}

		const ancestor = topGroupAncestor(hitNodeId);

		return ancestor ?? hitNodeId;
	}

	function topGroupAncestor(nodeId: NodeId): NodeId | undefined {
		let currentId = nodeId;
		let parent = findParentNode(geometryDocument, currentId);
		let topGroupId: NodeId | undefined;

		while (parent && parent.id !== geometryDocument.root.id) {
			topGroupId = parent.id;
			currentId = parent.id;
			parent = findParentNode(geometryDocument, currentId);
		}

		return topGroupId;
	}

	function groupSelection() {
		if (!selectedNodesHaveSameParent()) {
			return;
		}

		const groupId = `group-${nextNodeIndex}`;
		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		updateActiveDocument(groupNodes(geometryDocument, selectedNodeIds, groupId, 'Group'));
		selectedNodeIds = [groupId];
		expandedGroupIds = [...new Set([...expandedGroupIds, groupId])];
		nextNodeIndex += 1;
	}

	function ungroupSelection() {
		if (selectedNodeIds.length !== 1) {
			return;
		}

		const groupId = selectedNodeIds[0]!;
		const group = findNode(geometryDocument, groupId);

		if (!group || group.type !== 'group') {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		updateActiveDocument(ungroupNode(geometryDocument, groupId));
		selectedNodeIds = group.children.map((child) => child.id);
		expandedGroupIds = expandedGroupIds.filter((expandedGroupId) => expandedGroupId !== groupId);

		if (editingGroupId === groupId) {
			editingGroupId = undefined;
		}
	}

	function canRemoveSelectionFromGroup() {
		if (selectedNodeIds.length !== 1) {
			return false;
		}

		const parent = findParentNode(geometryDocument, selectedNodeIds[0]!);

		return Boolean(parent && parent.id !== geometryDocument.root.id);
	}

	function removeSelectionFromGroup() {
		if (!canRemoveSelectionFromGroup()) {
			return;
		}

		const nodeId = selectedNodeIds[0]!;
		const parent = findParentNode(geometryDocument, nodeId);
		const grandParent = parent ? findParentNode(geometryDocument, parent.id) : undefined;

		if (!parent || !grandParent) {
			return;
		}

		const parentIndex = grandParent.children.findIndex((child) => child.id === parent.id);

		if (parentIndex < 0) {
			return;
		}

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		updateActiveDocument(
			moveNodeToParent(geometryDocument, nodeId, grandParent.id, parentIndex + 1)
		);
		selectedNodeIds = [nodeId];
	}

	function nextPageId(): string {
		let index = project.pages.length + 1;

		while (project.pages.some((page) => page.id === `page-${index}`)) {
			index += 1;
		}

		return `page-${index}`;
	}

	type PaintField = 'fill' | 'stroke';
	type PaintMode = 'solid' | 'linear' | 'radial' | 'none';

	function selectedPaint(field: PaintField): Paint | undefined {
		if (!selectedNode) {
			return undefined;
		}

		return (
			selectedNode.style?.[field] ??
			(selectedNode.type === 'text' ? selectedNode[field] : undefined)
		);
	}

	function selectedGradient(field: PaintField): Gradient | undefined {
		const paint = selectedPaint(field);

		return typeof paint === 'object'
			? geometryDocument.resources?.gradients.find((gradient) => gradient.id === paint.gradientId)
			: undefined;
	}

	function paintMode(field: PaintField): PaintMode {
		const paint = selectedPaint(field);

		if (paint === 'none') {
			return 'none';
		}

		if (typeof paint === 'object') {
			return selectedGradient(field)?.type ?? 'solid';
		}

		return 'solid';
	}

	function updateSelectedPaint(field: PaintField, paint: Paint) {
		if (!selectedNode) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: { ...selectedNode.style, [field]: paint }
			} as Partial<GeometryNode>
		});
	}

	function setPaintMode(field: PaintField, mode: PaintMode) {
		if (mode === 'linear' || mode === 'radial') {
			applyGradientToSelected(field, mode);
			return;
		}

		if (mode === 'none') {
			updateSelectedPaint(field, 'none');
			return;
		}

		const gradient = selectedGradient(field);
		updateSelectedPaint(field, gradient?.stops[0]?.color ?? '#2563ff');
	}

	function updateGradient(gradient: Gradient) {
		commitPatch({ op: 'gradientUpsert', gradient });
	}

	function updateGradientStop(gradient: Gradient, index: number, changes: Partial<GradientStop>) {
		updateGradient({
			...gradient,
			stops: gradient.stops.map((stop, stopIndex) =>
				stopIndex === index ? { ...stop, ...changes } : stop
			)
		});
	}

	function updateGradientStopOffset(gradient: Gradient, index: number, rawValue: string) {
		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		updateGradientStop(gradient, index, { offset: Math.max(0, Math.min(1, value / 100)) });
	}

	function updateGradientStopOpacity(gradient: Gradient, index: number, rawValue: string) {
		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		updateGradientStop(gradient, index, { opacity: Math.max(0, Math.min(1, value / 100)) });
	}

	function addGradientStop(gradient: Gradient) {
		const orderedStops = [...gradient.stops].sort((left, right) => left.offset - right.offset);
		let largestGap = {
			start: orderedStops[0]?.offset ?? 0,
			end: orderedStops[1]?.offset ?? 1,
			color: orderedStops[0]?.color ?? '#2563ff',
			opacity: orderedStops[0]?.opacity ?? 1
		};

		for (let index = 0; index < orderedStops.length - 1; index += 1) {
			const start = orderedStops[index]!;
			const end = orderedStops[index + 1]!;

			if (end.offset - start.offset > largestGap.end - largestGap.start) {
				largestGap = {
					start: start.offset,
					end: end.offset,
					color: start.color,
					opacity: start.opacity ?? 1
				};
			}
		}

		updateGradient({
			...gradient,
			stops: [
				...gradient.stops,
				{
					offset: (largestGap.start + largestGap.end) / 2,
					color: largestGap.color,
					opacity: largestGap.opacity
				}
			].sort((left, right) => left.offset - right.offset)
		});
	}

	function removeGradientStop(gradient: Gradient, index: number) {
		if (gradient.stops.length <= 2) {
			return;
		}

		updateGradient({
			...gradient,
			stops: gradient.stops.filter((_, stopIndex) => stopIndex !== index)
		});
	}

	function updateGradientCoordinate(
		gradient: Gradient,
		coordinate: 'x1' | 'y1' | 'x2' | 'y2' | 'cx' | 'cy' | 'r',
		rawValue: string
	) {
		const value = Number(rawValue);

		if (!Number.isFinite(value) || (coordinate === 'r' && value <= 0)) {
			return;
		}

		updateGradient({ ...gradient, [coordinate]: value } as Gradient);
	}

	function gradientPreviewStyle(gradient: Gradient): string {
		const stops = gradient.stops
			.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
			.join(', ');

		return gradient.type === 'linear'
			? `linear-gradient(135deg, ${stops})`
			: `radial-gradient(circle, ${stops})`;
	}

	function updateSelectedStyle(field: keyof NodeStyle, rawValue: string) {
		if (!selectedNode) {
			return;
		}

		const trimmedValue = rawValue.trim();
		const value =
			field === 'strokeMiterlimit' || field === 'strokeDashoffset'
				? trimmedValue === ''
					? undefined
					: Number(trimmedValue)
				: field === 'strokeWidth' || field === 'opacity'
					? Number(rawValue)
					: trimmedValue || undefined;

		if (typeof value === 'number' && !Number.isFinite(value)) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: {
					...selectedNode.style,
					[field]: value
				}
			} as Partial<GeometryNode>
		});
	}

	function applyGradientToSelected(field: PaintField, type: Gradient['type']) {
		if (!selectedNode) {
			return;
		}

		const viewBox = getDocumentViewBox(geometryDocument);
		const id = `${selectedNode.id}-${field}-gradient`;
		const gradient: Gradient =
			type === 'linear'
				? {
						id,
						type: 'linear',
						x1: viewBox.x,
						y1: viewBox.y,
						x2: viewBox.x + viewBox.width,
						y2: viewBox.y + viewBox.height,
						stops: [
							{ offset: 0, color: '#3dbbff' },
							{ offset: 1, color: '#2563ff' }
						]
					}
				: {
						id,
						type: 'radial',
						cx: viewBox.x + viewBox.width / 2,
						cy: viewBox.y + viewBox.height / 2,
						r: Math.max(viewBox.width, viewBox.height) / 2,
						stops: [
							{ offset: 0, color: '#3dbbff' },
							{ offset: 1, color: '#2563ff' }
						]
					};

		undoStack = [...undoStack, cloneProject(project)];
		redoStack = [];
		updateActiveDocument(
			applyPatches(geometryDocument, [
				{ op: 'gradientUpsert', gradient },
				{
					op: 'update',
					target: selectedNode.id,
					changes: {
						style: { ...selectedNode.style, [field]: { type: 'gradient', gradientId: id } }
					} as Partial<GeometryNode>
				}
			])
		);
	}

	function toggleSelectedEffect(type: Effect['type']) {
		if (!selectedNode) {
			return;
		}

		const effects = selectedNode.style?.effects ?? [];
		const nextEffects = effects.some((effect) => effect.type === type)
			? effects.filter((effect) => effect.type !== type)
			: [
					...effects,
					type === 'blur'
						? { type: 'blur', radius: 6 }
						: { type: 'dropShadow', dx: 0, dy: 8, blur: 12, color: '#000000', opacity: 0.32 }
				];

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: { ...selectedNode.style, effects: nextEffects }
			} as Partial<GeometryNode>
		});
	}

	function selectedBlurEffect(): Extract<Effect, { type: 'blur' }> | undefined {
		return selectedNode?.style?.effects?.find(
			(effect): effect is Extract<Effect, { type: 'blur' }> => effect.type === 'blur'
		);
	}

	function selectedDropShadowEffect(): Extract<Effect, { type: 'dropShadow' }> | undefined {
		return selectedNode?.style?.effects?.find(
			(effect): effect is Extract<Effect, { type: 'dropShadow' }> => effect.type === 'dropShadow'
		);
	}

	function updateSelectedBlurRadius(rawValue: string) {
		const radius = Number(rawValue);
		const effect = selectedBlurEffect();

		if (!selectedNode || !effect || !Number.isFinite(radius)) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: {
					...selectedNode.style,
					effects: selectedNode.style?.effects?.map((currentEffect) =>
						currentEffect.type === 'blur'
							? { ...currentEffect, radius: Math.max(0, radius) }
							: currentEffect
					)
				}
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedDropShadowNumber(field: 'dx' | 'dy' | 'blur', rawValue: string) {
		const value = Number(rawValue);
		const effect = selectedDropShadowEffect();

		if (!selectedNode || !effect || !Number.isFinite(value)) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: {
					...selectedNode.style,
					effects: selectedNode.style?.effects?.map((currentEffect) =>
						currentEffect.type === 'dropShadow'
							? { ...currentEffect, [field]: field === 'blur' ? Math.max(0, value) : value }
							: currentEffect
					)
				}
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedDropShadowColor(color: string) {
		const effect = selectedDropShadowEffect();

		if (!selectedNode || !effect) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: {
					...selectedNode.style,
					effects: selectedNode.style?.effects?.map((currentEffect) =>
						currentEffect.type === 'dropShadow' ? { ...currentEffect, color } : currentEffect
					)
				}
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedDropShadowOpacity(rawValue: string) {
		const opacity = Number(rawValue);
		const effect = selectedDropShadowEffect();

		if (!selectedNode || !effect || !Number.isFinite(opacity)) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				style: {
					...selectedNode.style,
					effects: selectedNode.style?.effects?.map((currentEffect) =>
						currentEffect.type === 'dropShadow'
							? { ...currentEffect, opacity: Math.max(0, Math.min(1, opacity / 100)) }
							: currentEffect
					)
				}
			} as Partial<GeometryNode>
		});
	}

	type TransformNumberField = 'translateX' | 'translateY' | 'rotation' | 'scaleX' | 'scaleY';

	function selectedTransformValue(field: TransformNumberField): number {
		const fallback = field === 'scaleX' || field === 'scaleY' ? 1 : 0;
		return selectedNode?.transform?.[field] ?? fallback;
	}

	function transformOrigin(node: GeometryNode): Pick<NodeTransform, 'originX' | 'originY'> {
		if (node.transform?.originX !== undefined && node.transform.originY !== undefined) {
			return { originX: node.transform.originX, originY: node.transform.originY };
		}

		const bounds = getNodeBounds(geometryDocument, node.id);

		return {
			originX: bounds ? bounds.x + bounds.width / 2 : 0,
			originY: bounds ? bounds.y + bounds.height / 2 : 0
		};
	}

	function updateSelectedTransform(changes: Partial<NodeTransform>) {
		if (!selectedNode) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				transform: {
					...transformOrigin(selectedNode),
					...selectedNode.transform,
					...changes
				}
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedTransformNumber(field: TransformNumberField, rawValue: string) {
		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		updateSelectedTransform({
			[field]: field === 'scaleX' || field === 'scaleY' ? Math.max(0.01, value) : value
		});
	}

	function updateSelectedTransformScale(field: 'scaleX' | 'scaleY', rawValue: string) {
		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		const nextValue = Math.max(0.01, value);

		if (!isTransformScaleLocked) {
			updateSelectedTransform({ [field]: nextValue });
			return;
		}

		const otherField = field === 'scaleX' ? 'scaleY' : 'scaleX';
		const currentValue = selectedTransformValue(field);
		const currentOtherValue = selectedTransformValue(otherField);
		const ratio = currentValue === 0 ? 1 : currentOtherValue / currentValue;

		updateSelectedTransform({
			[field]: nextValue,
			[otherField]: Math.max(0.01, nextValue * ratio)
		});
	}

	function resetSelectedTransform() {
		if (!selectedNode?.transform) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: { transform: undefined } as Partial<GeometryNode>
		});
	}

	function updateSelectedClipPath(nodeId: string) {
		if (!selectedNode || nodeId === selectedNode.id) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				clipPath: nodeId ? { nodeId } : undefined
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedMask(nodeId: string) {
		if (!selectedNode || nodeId === selectedNode.id) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				mask: nodeId ? { nodeId } : undefined
			} as Partial<GeometryNode>
		});
	}

	type GeometryNumberField =
		| 'cx'
		| 'cy'
		| 'height'
		| 'r'
		| 'rx'
		| 'ry'
		| 'width'
		| 'x'
		| 'x1'
		| 'x2'
		| 'y'
		| 'y1'
		| 'y2';

	function updateSelectedGeometryNumber(field: GeometryNumberField, rawValue: string) {
		if (!selectedNode) {
			return;
		}

		if (
			selectedNode.type === 'rect' &&
			(field === 'rx' || field === 'ry') &&
			rawValue.trim() === ''
		) {
			commitPatch({
				op: 'update',
				target: selectedNode.id,
				changes: {
					[field]: undefined
				} as Partial<GeometryNode>
			});
			return;
		}

		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		const changes = geometryNumberChanges(selectedNode, field, value);

		if (!changes) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes
		});
	}

	function geometryNumberChanges(
		node: GeometryNode,
		field: GeometryNumberField,
		value: number
	): Partial<GeometryNode> | undefined {
		if (node.type === 'rect') {
			if (field === 'x' || field === 'y') {
				return { [field]: value } as Partial<GeometryNode>;
			}

			if (field === 'width') {
				const width = Math.max(1, value);
				return {
					width,
					rx: node.rx === undefined ? undefined : Math.min(node.rx, width / 2)
				} as Partial<GeometryNode>;
			}

			if (field === 'height') {
				const height = Math.max(1, value);
				return {
					height,
					ry: node.ry === undefined ? undefined : Math.min(node.ry, height / 2)
				} as Partial<GeometryNode>;
			}

			if (field === 'rx') {
				return { rx: Math.min(Math.max(value, 0), node.width / 2) } as Partial<GeometryNode>;
			}

			if (field === 'ry') {
				return { ry: Math.min(Math.max(value, 0), node.height / 2) } as Partial<GeometryNode>;
			}
		}

		if (node.type === 'ellipse') {
			if (field === 'cx' || field === 'cy') {
				return { [field]: value } as Partial<GeometryNode>;
			}

			if (field === 'rx' || field === 'ry') {
				return { [field]: Math.max(0.5, value) } as Partial<GeometryNode>;
			}
		}

		if (node.type === 'circle') {
			if (field === 'cx' || field === 'cy') {
				return { [field]: value } as Partial<GeometryNode>;
			}

			if (field === 'r') {
				return { r: Math.max(0.5, value) } as Partial<GeometryNode>;
			}
		}

		if (node.type === 'line') {
			if (field === 'x1' || field === 'y1' || field === 'x2' || field === 'y2') {
				return { [field]: value } as Partial<GeometryNode>;
			}
		}

		if (node.type === 'text') {
			if (field === 'x' || field === 'y') {
				return { [field]: value } as Partial<GeometryNode>;
			}
		}

		return undefined;
	}

	function updateSelectedTextContent(rawValue: string) {
		if (!selectedNode || selectedNode.type !== 'text') {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				text: rawValue
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedTextField(
		field: 'dominantBaseline' | 'fontFamily' | 'fontStyle' | 'fontWeight' | 'textAnchor',
		rawValue: string
	) {
		if (!selectedNode || selectedNode.type !== 'text') {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				[field]: rawValue.trim() || undefined
			} as Partial<GeometryNode>
		});
	}

	function updateSelectedTextNumber(field: 'fontSize', rawValue: string) {
		if (!selectedNode || selectedNode.type !== 'text') {
			return;
		}

		const value = Number(rawValue);

		if (!Number.isFinite(value)) {
			return;
		}

		commitPatch({
			op: 'update',
			target: selectedNode.id,
			changes: {
				[field]: Math.max(1, value)
			} as Partial<GeometryNode>
		});
	}

	function colorPickerValue(value: Paint | undefined, fallback: string): string {
		return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
	}

	function paintFieldValue(value: Paint | undefined, fallback: string): string {
		if (!value) {
			return fallback;
		}

		return typeof value === 'string' ? value : `Gradient: ${value.gradientId}`;
	}

	function exportSvgPages(pageIds: string[]) {
		const selectedPageIds = new Set(pageIds);
		const pages = project.pages.filter((page) => selectedPageIds.has(page.id));

		if (pages.length === 0) {
			return;
		}

		if (pages.length === 1) {
			const page = pages[0]!;
			downloadTextFile(
				exportToSvg(page.document),
				`${fileSafeName(page.name || page.id)}.svg`,
				'image/svg+xml'
			);
			svgExportOpen = false;
			return;
		}

		const projectSlug = fileSafeName(project.name || 'vibesvg-project');
		const usedNames = new Map<string, number>();
		const entries: Record<string, Uint8Array> = {};

		pages.forEach((page) => {
			const basename = uniqueExportFilename(fileSafeName(page.name || page.id), usedNames);
			entries[`${projectSlug}/${basename}.svg`] = strToU8(exportToSvg(page.document));
		});

		downloadBlob(
			new Blob([zipSync(entries)], { type: 'application/zip' }),
			`${projectSlug}-svg.zip`
		);
		svgExportOpen = false;
	}

	function downloadTextFile(content: string, filename: string, type: string) {
		downloadBlob(new Blob([content], { type }), filename);
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');

		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function downloadProject() {
		const snapshot = cloneProject(project);
		downloadTextFile(
			JSON.stringify(snapshot, null, 2),
			`${fileSafeName(project.name || 'vibesvg')}.vsvg.json`,
			'application/json'
		);
	}

	function fileSafeName(value: string) {
		return (
			value
				.trim()
				.replace(/[^a-z0-9-_]+/gi, '-')
				.replace(/^-+|-+$/g, '') || 'vibesvg'
		);
	}

	function uniqueExportFilename(basename: string, usedNames: Map<string, number>) {
		const count = usedNames.get(basename) ?? 0;
		usedNames.set(basename, count + 1);

		return count === 0 ? basename : `${basename}-${count + 1}`;
	}

	function connectHostWebSocket() {
		const hostWebSocketUrl = currentHostWebSocketUrl();

		if (!hostWebSocketUrl) {
			hostStatus = 'disabled';
			return;
		}

		closingHostSocket = false;
		hostStatus = 'connecting';

		const socket = new WebSocket(hostWebSocketUrl);
		hostSocket = socket;

		socket.onopen = () => {
			if (hostSocket !== socket) {
				return;
			}

			hostStatus = 'connected';
			saveStatus = 'saved';
			sendSelectionToHost();
		};

		socket.onmessage = (event) => {
			if (typeof event.data !== 'string') {
				return;
			}

			handleHostMessage(event.data);
		};

		socket.onclose = () => {
			if (hostSocket !== socket) {
				return;
			}

			hostSocket = undefined;
			hostStatus = closingHostSocket ? 'disabled' : 'error';

			if (!closingHostSocket) {
				hostReconnectTimer = setTimeout(connectHostWebSocket, 1000);
			}
		};

		socket.onerror = () => {
			hostStatus = 'error';
		};
	}

	function closeHostWebSocket() {
		closingHostSocket = true;

		if (hostReconnectTimer) {
			clearTimeout(hostReconnectTimer);
			hostReconnectTimer = undefined;
		}

		if (hostSyncTimer) {
			clearTimeout(hostSyncTimer);
			hostSyncTimer = undefined;
		}

		hostSocket?.close();
		hostSocket = undefined;
	}

	function currentHostWebSocketUrl() {
		if (typeof window === 'undefined') {
			return undefined;
		}

		if (import.meta.env.VITE_VIBESVG_HOST_WS_URL) {
			return import.meta.env.VITE_VIBESVG_HOST_WS_URL;
		}

		if (import.meta.env.DEV) {
			return `ws://${window.location.hostname}:6202/ws`;
		}

		return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
	}

	function handleHostMessage(rawMessage: string) {
		let message: unknown;

		try {
			message = JSON.parse(rawMessage);
		} catch {
			return;
		}

		if (!isHostMessage(message)) {
			return;
		}

		if (message.type === 'project:ack') {
			saveStatus = 'saved';
			return;
		}

		if (message.type === 'project:snapshot') {
			if (projectsEqual(project, message.project)) {
				saveStatus = 'saved';
				return;
			}

			applyRemoteProject(message.project);
		}
	}

	function isHostMessage(
		message: unknown
	): message is { type: 'project:ack' } | { type: 'project:snapshot'; project: VibeSVGProject } {
		return Boolean(
			message &&
			typeof message === 'object' &&
			'type' in message &&
			(message.type === 'project:ack' ||
				(message.type === 'project:snapshot' &&
					'project' in message &&
					isProjectLike(message.project)))
		);
	}

	function isProjectLike(value: unknown): value is VibeSVGProject {
		return Boolean(
			value &&
			typeof value === 'object' &&
			'schemaVersion' in value &&
			value.schemaVersion === 1 &&
			'pages' in value &&
			Array.isArray(value.pages)
		);
	}

	function applyRemoteProject(nextProject: VibeSVGProject) {
		project = structuredClone(nextProject) as VibeSVGProject;
		nextNodeIndex = Math.max(nextNodeIndex, nextNodeIndexFromProject(project));
		undoStack = [];
		redoStack = [];
		selectedNodeIds = [];
		editingGroupId = undefined;
		finishPathDrawing();
		saveStatus = 'saved';

		if (hasFitInitialViewport) {
			void fitCanvasToDocumentAfterLayout();
		}
	}

	function markProjectChanged() {
		if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
			return;
		}

		saveStatus = 'saving';

		if (hostSyncTimer) {
			clearTimeout(hostSyncTimer);
		}

		hostSyncTimer = setTimeout(() => {
			hostSyncTimer = undefined;
			sendProjectToHost();
		}, 250);
	}

	function sendProjectToHost() {
		if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
			return false;
		}

		saveStatus = 'saving';
		hostSocket.send(
			JSON.stringify({
				type: 'project:update',
				project: cloneProject(project)
			})
		);

		return true;
	}

	function sendSelectionToHost() {
		if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
			return;
		}

		hostSocket.send(
			JSON.stringify({
				type: 'selection:update',
				nodeIds: [...selectedNodeIds]
			})
		);
	}

	function projectsEqual(left: VibeSVGProject, right: VibeSVGProject) {
		return JSON.stringify($state.snapshot(left)) === JSON.stringify(right);
	}

	function nextNodeIndexFromProject(sourceProject: VibeSVGProject) {
		let maxIndex = 0;

		for (const page of sourceProject.pages) {
			walkNode(page.document.root, (node) => {
				const match = /-(\d+)$/.exec(node.id);

				if (match) {
					maxIndex = Math.max(maxIndex, Number(match[1]));
				}
			});
		}

		return maxIndex + 1;
	}

	function walkNode(node: GeometryNode, visit: (node: GeometryNode) => void) {
		visit(node);

		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				walkNode(child, visit);
			}
		}
	}

	function cloneDocument(documentToClone: GeometryDocument): GeometryDocument {
		return structuredClone($state.snapshot(documentToClone)) as GeometryDocument;
	}

	function cloneProject(projectToClone: VibeSVGProject): VibeSVGProject {
		return structuredClone($state.snapshot(projectToClone)) as VibeSVGProject;
	}

	function updateActiveDocument(document: GeometryDocument) {
		project = {
			...project,
			updatedAt: new Date().toISOString(),
			pages: project.pages.map((page) =>
				page.id === project.activePageId
					? {
							...page,
							name: document.name,
							document
						}
					: page
			)
		};
		markProjectChanged();
	}

	function draw() {
		if (!context) {
			return;
		}

		renderDocument(context, geometryDocument, viewport, {
			selectedNodeIds,
			transparentBackground: true,
			pixelRatio: canvasPixelRatio,
			showEditHandles: selectedNodeIds.length > 0
		});

		drawShapePreview(context);
		drawCatmullRomCandidate(context);
		drawBasisSplineCandidate(context);
		drawCubicBezierCandidate(context);
		drawDraft(context);
		drawSnapTarget(context);
	}

	function drawCatmullRomCandidate(canvasContext: CanvasRenderingContext2D) {
		if (
			tool !== 'path' ||
			pathSegmentMode !== 'catmullRom' ||
			!activePathNodeId ||
			!draftStart ||
			!draftEnd
		) {
			return;
		}

		const node = findNode(geometryDocument, activePathNodeId);

		if (!isPathNode(node) || node.segments.length === 0) {
			return;
		}

		const points = [node.start, ...node.segments.map((segment) => segment.to)];
		const start = points.at(-1);
		const previous = points.at(-2);
		const beforePrevious = points.at(-3) ?? previous;
		const lastSegment = node.segments.at(-1);

		if (!start || !previous || !beforePrevious || !lastSegment || lastSegment.type !== 'cubic') {
			return;
		}

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.strokeStyle = uiColors.primary;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);

		const adjustedPreviousControl1 = catmullControl1(beforePrevious, previous, start);
		const adjustedPreviousControl2 = catmullControl2(previous, start, draftEnd);
		const nextControl1 = catmullControl1(previous, start, draftEnd);
		const nextControl2 = catmullControl2(start, draftEnd, draftEnd);

		canvasContext.beginPath();
		canvasContext.moveTo(previous.x, previous.y);
		canvasContext.bezierCurveTo(
			adjustedPreviousControl1.x,
			adjustedPreviousControl1.y,
			adjustedPreviousControl2.x,
			adjustedPreviousControl2.y,
			start.x,
			start.y
		);
		canvasContext.bezierCurveTo(
			nextControl1.x,
			nextControl1.y,
			nextControl2.x,
			nextControl2.y,
			draftEnd.x,
			draftEnd.y
		);
		canvasContext.stroke();
		canvasContext.restore();
	}

	function drawBasisSplineCandidate(canvasContext: CanvasRenderingContext2D) {
		if (tool !== 'path' || pathSegmentMode !== 'basis' || !activePathNodeId || !draftEnd) {
			return;
		}

		const node = findNode(geometryDocument, activePathNodeId);

		if (!isPathNode(node) || node.spline?.type !== 'basis') {
			return;
		}

		const candidate = createBasisSplinePathGeometry([...node.spline.points, draftEnd]);

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.strokeStyle = uiColors.primary;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);
		drawPathGeometry(canvasContext, candidate.start, candidate.segments);
		canvasContext.restore();
	}

	function drawCubicBezierCandidate(canvasContext: CanvasRenderingContext2D) {
		if (tool !== 'path' || pathSegmentMode !== 'cubic' || !activePathNodeId || !draftEnd) {
			return;
		}

		const node = findNode(geometryDocument, activePathNodeId);

		if (!isPathNode(node) || node.segments.length === 0) {
			return;
		}

		const start = getPathEndPoint(node);
		const previous =
			node.segments.length < 2
				? node.start
				: (node.segments[node.segments.length - 2]?.to ?? node.start);
		const segment = createCubicBezierSegment(previous, start, draftEnd);

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.strokeStyle = uiColors.primary;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);
		drawPathGeometry(canvasContext, start, [segment]);
		canvasContext.restore();
	}

	function drawShapePreview(canvasContext: CanvasRenderingContext2D) {
		if (!shapePreviewPoint || !isShapeTool(tool) || draftStart) {
			return;
		}

		const bounds = shapeBoundsForPlacement(tool, shapePreviewPoint, shapePreviewPoint);

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.globalAlpha = 0.38;
		canvasContext.strokeStyle = uiColors.primaryHover;
		canvasContext.fillStyle = uiColors.primaryPreviewFill;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);

		drawShapeCandidate(canvasContext, tool, bounds.start, bounds.end);

		canvasContext.restore();
	}

	function drawShapeCandidate(
		canvasContext: CanvasRenderingContext2D,
		shapeTool: 'rect' | 'ellipse' | 'triangle',
		start: Point,
		end: Point
	) {
		const x = Math.min(start.x, end.x);
		const y = Math.min(start.y, end.y);
		const width = Math.abs(end.x - start.x);
		const height = Math.abs(end.y - start.y);

		if (shapeTool === 'ellipse') {
			canvasContext.beginPath();
			canvasContext.ellipse(
				x + width / 2,
				y + height / 2,
				width / 2,
				height / 2,
				0,
				0,
				Math.PI * 2
			);
			canvasContext.fill();
			canvasContext.stroke();
			return;
		}

		if (shapeTool === 'triangle') {
			const points = trianglePointsFromBounds(start, end);
			const [first, ...rest] = points;

			if (!first) {
				return;
			}

			canvasContext.beginPath();
			canvasContext.moveTo(first.x, first.y);

			for (const point of rest) {
				canvasContext.lineTo(point.x, point.y);
			}

			canvasContext.closePath();
			canvasContext.fill();
			canvasContext.stroke();
			return;
		}

		canvasContext.beginPath();
		canvasContext.rect(x, y, width, height);
		canvasContext.fill();
		canvasContext.stroke();
	}

	function drawDraft(canvasContext: CanvasRenderingContext2D) {
		if (!draftStart || !draftEnd) {
			return;
		}

		if (tool === 'path' && pathSegmentMode === 'catmullRom' && activePathNodeId) {
			return;
		}

		if (tool === 'path' && pathSegmentMode === 'basis' && activePathNodeId) {
			return;
		}

		if (tool === 'path' && pathSegmentMode === 'cubic' && activePathNodeId) {
			return;
		}

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.strokeStyle = uiColors.primary;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);

		if (isShapeTool(tool)) {
			const bounds = shapeBoundsForPlacement(tool, draftStart, draftEnd);

			if (tool === 'ellipse') {
				canvasContext.beginPath();
				const ellipseX = Math.min(bounds.start.x, bounds.end.x);
				const ellipseY = Math.min(bounds.start.y, bounds.end.y);
				const ellipseWidth = Math.abs(bounds.end.x - bounds.start.x);
				const ellipseHeight = Math.abs(bounds.end.y - bounds.start.y);

				canvasContext.ellipse(
					ellipseX + ellipseWidth / 2,
					ellipseY + ellipseHeight / 2,
					ellipseWidth / 2,
					ellipseHeight / 2,
					0,
					0,
					Math.PI * 2
				);
				canvasContext.stroke();
			} else if (tool === 'rect') {
				const rectX = Math.min(bounds.start.x, bounds.end.x);
				const rectY = Math.min(bounds.start.y, bounds.end.y);
				const rectWidth = Math.abs(bounds.end.x - bounds.start.x);
				const rectHeight = Math.abs(bounds.end.y - bounds.start.y);

				canvasContext.strokeRect(rectX, rectY, rectWidth, rectHeight);
			} else {
				const points = trianglePointsFromBounds(bounds.start, bounds.end);
				const [first, ...rest] = points;

				if (first) {
					canvasContext.beginPath();
					canvasContext.moveTo(first.x, first.y);

					for (const point of rest) {
						canvasContext.lineTo(point.x, point.y);
					}

					canvasContext.closePath();
					canvasContext.stroke();
				}
			}
		}

		if (tool === 'path') {
			drawPathDraftSegment(canvasContext, draftStart, draftEnd);
		}

		canvasContext.setLineDash([]);
		canvasContext.fillStyle = uiColors.primaryHover;
		drawDraftHandle(canvasContext, draftStart);

		drawDraftHandle(canvasContext, draftEnd);

		canvasContext.restore();
	}

	function drawSnapTarget(canvasContext: CanvasRenderingContext2D) {
		if (!snapTarget) {
			return;
		}

		canvasContext.save();
		canvasContext.setTransform(
			viewport.zoom * canvasPixelRatio,
			0,
			0,
			viewport.zoom * canvasPixelRatio,
			viewport.x * canvasPixelRatio,
			viewport.y * canvasPixelRatio
		);
		canvasContext.strokeStyle = uiColors.warning;
		canvasContext.lineWidth = 2 / viewport.zoom;
		canvasContext.beginPath();
		canvasContext.arc(snapTarget.point.x, snapTarget.point.y, 7 / viewport.zoom, 0, Math.PI * 2);
		canvasContext.stroke();
		canvasContext.restore();
	}

	function drawDraftHandle(canvasContext: CanvasRenderingContext2D, point: Point) {
		canvasContext.beginPath();
		canvasContext.arc(point.x, point.y, 4 / viewport.zoom, 0, Math.PI * 2);
		canvasContext.fill();
	}

	function drawPathDraftSegment(canvasContext: CanvasRenderingContext2D, start: Point, end: Point) {
		if (pathSegmentMode === 'basis') {
			const geometry = createBasisSplinePathGeometry([start, end]);
			drawPathGeometry(canvasContext, geometry.start, geometry.segments);
			return;
		}

		if (pathSegmentMode === 'arc') {
			drawArcDraftSegment(canvasContext, start, end);
			return;
		}

		canvasContext.beginPath();
		canvasContext.moveTo(start.x, start.y);

		if (pathSegmentMode === 'quadratic') {
			const control = {
				x: (start.x + end.x) / 2 - (end.y - start.y) * -0.35,
				y: (start.y + end.y) / 2 + (end.x - start.x) * -0.35
			};
			canvasContext.quadraticCurveTo(control.x, control.y, end.x, end.y);
		} else if (pathSegmentMode === 'cubic' || pathSegmentMode === 'catmullRom') {
			canvasContext.bezierCurveTo(
				start.x + (end.x - start.x) / 3,
				start.y + (end.y - start.y) / 3,
				start.x + ((end.x - start.x) * 2) / 3,
				start.y + ((end.y - start.y) * 2) / 3,
				end.x,
				end.y
			);
		} else {
			canvasContext.lineTo(end.x, end.y);
		}

		canvasContext.stroke();
	}

	function drawArcDraftSegment(canvasContext: CanvasRenderingContext2D, start: Point, end: Point) {
		const tangent = arcDraftTangent();
		const segment = createArcSegmentFromTangent(start, end, tangent);
		const circle = arcCandidateCircle(start, segment, tangent);

		canvasContext.save();
		canvasContext.setLineDash([]);

		if (circle) {
			canvasContext.globalAlpha = 0.28;
			canvasContext.lineWidth = 1.5 / viewport.zoom;
			canvasContext.beginPath();
			canvasContext.arc(circle.center.x, circle.center.y, circle.radius, 0, Math.PI * 2);
			canvasContext.stroke();
			canvasContext.globalAlpha = 1;
		}

		canvasContext.lineWidth = 3 / viewport.zoom;
		canvasContext.beginPath();
		canvasContext.moveTo(start.x, start.y);
		drawArcSegment(canvasContext, start, segment);
		canvasContext.stroke();
		canvasContext.restore();
	}

	function arcDraftTangent(): Point {
		if (!activePathNodeId) {
			return { x: 1, y: 0 };
		}

		const node = findNode(geometryDocument, activePathNodeId);

		if (!isPathNode(node)) {
			return { x: 1, y: 0 };
		}

		return getPathEndTangent(node);
	}

	function arcCandidateCircle(
		start: Point,
		segment: Extract<Segment, { type: 'arc' }>,
		tangent: Point
	) {
		const length = Math.hypot(tangent.x, tangent.y);

		if (length < 0.001) {
			return undefined;
		}

		const unitTangent = {
			x: tangent.x / length,
			y: tangent.y / length
		};
		const normal = {
			x: -unitTangent.y,
			y: unitTangent.x
		};
		const signedRadius = segment.sweep ? segment.rx : -segment.rx;
		const center = {
			x: start.x + normal.x * signedRadius,
			y: start.y + normal.y * signedRadius
		};

		return {
			center,
			radius: segment.rx
		};
	}

	function drawPathGeometry(
		canvasContext: CanvasRenderingContext2D,
		start: Point,
		segments: Segment[]
	) {
		canvasContext.beginPath();
		canvasContext.moveTo(start.x, start.y);

		let current = start;

		for (const segment of segments) {
			if (segment.type === 'line') {
				canvasContext.lineTo(segment.to.x, segment.to.y);
			} else if (segment.type === 'quadratic') {
				canvasContext.quadraticCurveTo(
					segment.control.x,
					segment.control.y,
					segment.to.x,
					segment.to.y
				);
			} else if (segment.type === 'cubic') {
				canvasContext.bezierCurveTo(
					segment.control1.x,
					segment.control1.y,
					segment.control2.x,
					segment.control2.y,
					segment.to.x,
					segment.to.y
				);
			} else if (segment.type === 'arc') {
				drawArcSegment(canvasContext, current, segment);
			}

			current = segment.to;
		}

		canvasContext.stroke();
	}
</script>

<svelte:head>
	<title>VibeSVG</title>
</svelte:head>

<div class="app-shell">
	<header class="topbar">
		<div class="topbar-project-group">
			<div class="topbar-brand">
				<img alt="" aria-hidden="true" class="brand-mark" src={iconPaths.app} />
			</div>

			<div class="history-controls" aria-label="History">
				<button
					aria-label="Undo"
					title="Undo"
					type="button"
					onclick={undo}
					disabled={undoStack.length === 0}
				>
					<img alt="" aria-hidden="true" src={iconPaths.undo} />
				</button>
				<button
					aria-label="Redo"
					title="Redo"
					type="button"
					onclick={redo}
					disabled={redoStack.length === 0}
				>
					<img alt="" aria-hidden="true" src={iconPaths.redo} />
				</button>
			</div>

			<div class="project-name-shell">
				{#if renamingProjectName}
					<input
						bind:this={projectNameInput}
						class="project-name-input"
						type="text"
						value={projectNameDraft}
						oninput={(event) => (projectNameDraft = event.currentTarget.value)}
						onblur={confirmProjectNameRename}
						onkeydown={handleProjectNameKeyDown}
					/>
				{:else}
					<button
						aria-label="Rename project"
						class="project-name-display"
						title="Rename project"
						type="button"
						onclick={startProjectNameRename}
					>
						<h1>{project.name}</h1>
						<img alt="" aria-hidden="true" src={iconPaths.edit} />
					</button>
				{/if}
			</div>
		</div>

		<div class="topbar-actions-group">
			<div class="topbar-status">
			<div class="export-menu">
				<input
					bind:this={svgImportInput}
					accept=".svg,image/svg+xml"
					hidden
					type="file"
					onchange={importSvgFile}
				/>
				<button
					type="button"
					aria-expanded={svgImportOpen}
					onclick={() => (svgImportOpen = !svgImportOpen)}
				>
					Import SVG
				</button>
				{#if svgImportOpen}
					<div class="export-popover import-popover">
						<div class="export-popover-header">
							<h2>Import SVG</h2>
							<button
								type="button"
								aria-label="Close import menu"
								onclick={() => (svgImportOpen = false)}>x</button
							>
						</div>
						<button
							class="import-file-button"
							type="button"
							onclick={() => svgImportInput?.click()}
						>
							Choose SVG File
						</button>
						<label class="import-text-field" for="svg-import-text">
							<span>Paste SVG</span>
							<textarea id="svg-import-text" placeholder="<svg ...>" bind:value={svgImportText}
							></textarea>
						</label>
						<div class="export-popover-footer">
							<span>{svgImportText.trim() ? 'Ready to import' : 'Paste SVG text'}</span>
							<button
								class="primary"
								type="button"
								disabled={!svgImportText.trim()}
								onclick={importSvgText}
							>
								Import
							</button>
						</div>
					</div>
				{/if}
			</div>
			<div class="export-menu">
				<button
					type="button"
					aria-expanded={svgExportOpen}
					onclick={() => (svgExportOpen = !svgExportOpen)}
				>
					Export SVG
				</button>
				{#if svgExportOpen}
					<ExportSvgPopover
						activePageId={project.activePageId}
						pages={svgExportPages}
						onClose={() => (svgExportOpen = false)}
						onExport={exportSvgPages}
					/>
				{/if}
			</div>
			<button type="button" onclick={downloadProject}>Export Project</button>
				<button type="button" onclick={openProjectSettings}>Settings</button>
			</div>
		</div>
	</header>

	<main class="workspace">
		<aside class="sidebar">
			<h2 class="sidebar-title">Layers</h2>
			<DragDropProvider
				onDragStart={handleLayerSortStart}
				onDragOver={handleLayerSortOver}
				onDragEnd={handleLayerSortEnd}
			>
				<div class="layer-list">
					{#if layerItems.length === 0}
						<div class="empty-row">No nodes</div>
					{/if}

					{#each visibleLayerItems as item (item.node.id)}
						<LayerRow
							{item}
							selected={selectedNodeIds.includes(item.node.id)}
							onContextMenu={openLayerContextMenu}
							onEditGroup={editGroup}
							onSelect={selectNode}
							onToggleExpanded={toggleGroupExpanded}
						/>
					{/each}
				</div>
			</DragDropProvider>
		</aside>

		<div class="editor-stage">
			<section class="canvas-shell">
				<div class="toolbar" aria-label="Tools">
					<button
						aria-label="Select"
						class:active={tool === 'select'}
						type="button"
						onclick={() => setTool('select')}
						onmouseenter={(event) => showToolTooltip(event, 'Select')}
						onfocus={(event) => showToolTooltip(event, 'Select')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.select} />
					</button>
					<button
						aria-label="Rectangle"
						class:active={tool === 'rect'}
						type="button"
						onclick={() => setTool('rect')}
						onmouseenter={(event) => showToolTooltip(event, 'Rectangle')}
						onfocus={(event) => showToolTooltip(event, 'Rectangle')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.rect} />
					</button>
					<button
						aria-label="Ellipse"
						class:active={tool === 'ellipse'}
						type="button"
						onclick={() => setTool('ellipse')}
						onmouseenter={(event) => showToolTooltip(event, 'Ellipse')}
						onfocus={(event) => showToolTooltip(event, 'Ellipse')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.ellipse} />
					</button>
					<button
						aria-label="Triangle"
						class:active={tool === 'triangle'}
						type="button"
						onclick={() => setTool('triangle')}
						onmouseenter={(event) => showToolTooltip(event, 'Triangle')}
						onfocus={(event) => showToolTooltip(event, 'Triangle')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.triangle} />
					</button>
					<button
						aria-label="Text"
						class:active={tool === 'text'}
						type="button"
						onclick={() => setTool('text')}
						onmouseenter={(event) => showToolTooltip(event, 'Text')}
						onfocus={(event) => showToolTooltip(event, 'Text')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.text} />
					</button>
					<div class="toolbar-separator" aria-hidden="true"></div>
					<button
						aria-label="Line"
						class:active={tool === 'path' && pathSegmentMode === 'line'}
						type="button"
						onclick={() => setLineTool('line')}
						onmouseenter={(event) => showToolTooltip(event, 'Line')}
						onfocus={(event) => showToolTooltip(event, 'Line')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.line} />
					</button>
					<button
						aria-label="Arc"
						class:active={tool === 'path' && pathSegmentMode === 'arc'}
						type="button"
						onclick={() => setLineTool('arc')}
						onmouseenter={(event) => showToolTooltip(event, 'Arc')}
						onfocus={(event) => showToolTooltip(event, 'Arc')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.arc} />
					</button>
					<button
						aria-label="Cubic Bezier"
						class:active={tool === 'path' && pathSegmentMode === 'cubic'}
						type="button"
						onclick={() => setLineTool('cubic')}
						onmouseenter={(event) => showToolTooltip(event, 'Cubic Bezier')}
						onfocus={(event) => showToolTooltip(event, 'Cubic Bezier')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.cubic} />
					</button>
					<button
						aria-label="Catmull"
						class:active={tool === 'path' && pathSegmentMode === 'catmullRom'}
						type="button"
						onclick={() => setLineTool('catmullRom')}
						onmouseenter={(event) => showToolTooltip(event, 'Catmull')}
						onfocus={(event) => showToolTooltip(event, 'Catmull')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.catmullRom} />
					</button>
					<button
						aria-label="Basis"
						class:active={tool === 'path' && pathSegmentMode === 'basis'}
						type="button"
						onclick={() => setLineTool('basis')}
						onmouseenter={(event) => showToolTooltip(event, 'Basis')}
						onfocus={(event) => showToolTooltip(event, 'Basis')}
						onmouseleave={closeToolTooltip}
						onblur={closeToolTooltip}
					>
						<img alt="" aria-hidden="true" src={iconPaths.basis} />
					</button>
				</div>
				<div class="zoom-control" aria-label="Canvas zoom">
					<button aria-label="Zoom out" title="Zoom out" type="button" onclick={() => adjustZoom(1 / 1.2)}
						>−</button
					>
					<input
						aria-label="Zoom percentage"
						min="10"
						max="6400"
						step="1"
						type="number"
						value={Math.round(viewport.zoom * 100)}
						onchange={updateZoomPercent}
					/>
					<span>%</span>
					<button aria-label="Zoom in" title="Zoom in" type="button" onclick={() => adjustZoom(1.2)}
						>+</button
					>
					<button class="zoom-fit-button" type="button" onclick={fitCanvasToDocument}>Fit</button>
				</div>
				<canvas
					class:panning
					class:space-pan={spacePressed}
					bind:this={canvas}
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointerleave={handlePointerLeave}
					ondblclick={handleCanvasDoubleClick}
					onwheel={handleWheel}
					oncontextmenu={handleCanvasContextMenu}
				></canvas>
			</section>

			<footer class="page-strip" aria-label="Pages">
				<div class="page-strip-list">
					{#each project.pages as page, pageIndex}
						{@const pageName = page.name || `Page ${pageIndex + 1}`}
						<button
							aria-label={`${page.name}, ${page.document.width} x ${page.document.height}px`}
							class:active={page.id === project.activePageId}
							type="button"
							onclick={() => setActivePage(page.id)}
							oncontextmenu={(event) => openPageContextMenu(event, page.id)}
							onmouseenter={(event) => showPageTooltip(event, pageName)}
							onfocus={(event) => showPageTooltip(event, pageName)}
							onmouseleave={closePageTooltip}
							onblur={closePageTooltip}
						>
							<PageThumbnail document={page.document} />
							<span class="page-name">{pageName}</span>
						</button>
					{/each}
					<button
						class="page-add-button"
						type="button"
						aria-label="New page"
						title="New page"
						onclick={addPage}
					>
						<span>+</span>
					</button>
				</div>
			</footer>

			{#if pageTooltip}
				<div
					class="page-floating-tooltip"
					style={`left: ${pageTooltip.x}px; top: ${pageTooltip.y}px;`}
					role="tooltip"
				>
					{pageTooltip.text}
				</div>
			{/if}

			{#if toolTooltip}
				<div
					class="tool-floating-tooltip"
					style={`left: ${toolTooltip.x}px; top: ${toolTooltip.y}px;`}
					role="tooltip"
				>
					{toolTooltip.text}
				</div>
			{/if}

			{#if pageContextMenu && pageContextMenuPage}
				<div
					class="page-context-menu"
					style={`left: ${pageContextMenu.x}px; top: ${pageContextMenu.y}px;`}
					role="menu"
					tabindex="-1"
					onclick={(event) => event.stopPropagation()}
					oncontextmenu={(event) => event.preventDefault()}
					onkeydown={(event) => event.stopPropagation()}
				>
					<div class="page-context-title">
						{#if renamingPageId === pageContextMenuPage.id}
							<input
								bind:this={pageRenameInput}
								class="page-context-name-input"
								type="text"
								value={renamingPageName}
								oninput={(event) =>
									(renamingPageName = (event.currentTarget as HTMLInputElement).value)}
								onblur={confirmPageContextRename}
								onkeydown={handlePageRenameKeyDown}
							/>
						{:else}
							<button
								class="page-context-name-button"
								type="button"
								onclick={startPageContextRename}
							>
								{pageContextMenuPage.name}
							</button>
						{/if}
						<span
							>{pageContextMenuPage.document.width} x {pageContextMenuPage.document.height}px</span
						>
					</div>
					<button
						type="button"
						role="menuitem"
						onclick={() => duplicatePage(pageContextMenuPage.id)}
					>
						Duplicate
					</button>
					<button
						class="danger"
						type="button"
						role="menuitem"
						disabled={project.pages.length <= 1}
						onclick={() => deletePage(pageContextMenuPage.id)}
					>
						Delete
					</button>
				</div>
			{/if}

			{#if layerContextMenu}
				<div
					class="page-context-menu layer-context-menu"
					style={`left: ${layerContextMenu.x}px; top: ${layerContextMenu.y}px;`}
					role="menu"
					tabindex="-1"
					onclick={(event) => event.stopPropagation()}
					oncontextmenu={(event) => event.preventDefault()}
					onkeydown={(event) => event.stopPropagation()}
				>
					<div class="page-context-title">
						<span>
							{#if selectedNodeIds.length > 1}
								{selectedNodeIds.length} selected
							{:else}
								{layerContextMenuNode?.name ?? layerContextMenuNode?.type ?? 'Selection'}
							{/if}
						</span>
					</div>
					<button
						type="button"
						role="menuitem"
						disabled={!selectedNodesHaveSameParent()}
						onclick={() => {
							groupSelection();
							closeLayerContextMenu();
						}}
					>
						Group
					</button>
					<button
						type="button"
						role="menuitem"
						disabled={!(selectedNodeIds.length === 1 && selectedNode?.type === 'group')}
						onclick={() => {
							if (selectedNode?.type === 'group') {
								editGroup(selectedNode.id);
							}
							closeLayerContextMenu();
						}}
					>
						Edit Group
					</button>
					<button
						type="button"
						role="menuitem"
						disabled={!(selectedNodeIds.length === 1 && selectedNode?.type === 'group')}
						onclick={() => {
							ungroupSelection();
							closeLayerContextMenu();
						}}
					>
						Ungroup
					</button>
					<button
						type="button"
						role="menuitem"
						disabled={!canRemoveSelectionFromGroup()}
						onclick={() => {
							removeSelectionFromGroup();
							closeLayerContextMenu();
						}}
					>
						Remove from Group
					</button>
					<button
						class="danger"
						type="button"
						role="menuitem"
						disabled={selectedNodeIds.length === 0}
						onclick={() => {
							deleteSelection();
							closeLayerContextMenu();
						}}
					>
						Delete
					</button>
				</div>
			{/if}
		</div>

		<aside
			class="inspector"
			class:selectionActive={selectedNodeIds.length === 1}
			class:multiSelection={selectedNodeIds.length > 1}
		>
			<div class="inspector-header">
				<div>
					<span class="inspector-eyebrow">Inspector</span>
					<strong>
						{selectedNodeIds.length > 1
							? `${selectedNodeIds.length} selected`
							: selectedNode
								? selectedNode.name || selectedNode.type
								: activePage.name || 'Document'}
					</strong>
				</div>
				{#if selectedNode && selectedNodeIds.length === 1}
					<span class="inspector-node-type">{selectedNode.type}</span>
				{/if}
			</div>

			{#if selectedNodeIds.length > 1}
				<div class="multi-selection-summary">
					Select a single layer to edit its appearance, transform, and geometry.
				</div>
			{/if}

			<details class="inspector-section document-section" open>
				<summary>
					<span>Page Settings</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				<div class="field-grid">
					<label for="document-name">Name</label>
					<input
						id="document-name"
						class="text-field"
						type="text"
						value={activePage.name}
						onchange={updateActivePageName}
					/>

					<label for="document-width">Output Width</label>
					<div class="number-field">
						<input
							id="document-width"
							min="1"
							step="1"
							type="number"
							value={geometryDocument.width}
							onchange={(event) => updateDocumentDimension('width', event)}
						/>
						<span>px</span>
					</div>

					<label for="document-height">Output Height</label>
					<div class="number-field">
						<input
							id="document-height"
							min="1"
							step="1"
							type="number"
							value={geometryDocument.height}
							onchange={(event) => updateDocumentDimension('height', event)}
						/>
						<span>px</span>
					</div>
				</div>

				<details class="document-advanced">
					<summary>Advanced</summary>
					<div class="field-grid">
						<label for="document-viewbox-x">ViewBox X</label>
					<div class="number-field">
						<input
							id="document-viewbox-x"
							step="any"
							type="number"
							value={getDocumentViewBox(geometryDocument).x}
							onchange={(event) => updateDocumentViewBox('x', event)}
						/>
					</div>

					<label for="document-viewbox-y">ViewBox Y</label>
					<div class="number-field">
						<input
							id="document-viewbox-y"
							step="any"
							type="number"
							value={getDocumentViewBox(geometryDocument).y}
							onchange={(event) => updateDocumentViewBox('y', event)}
						/>
					</div>

					<label for="document-viewbox-width">ViewBox Width</label>
					<div class="number-field">
						<input
							id="document-viewbox-width"
							min="0.0001"
							step="any"
							type="number"
							value={getDocumentViewBox(geometryDocument).width}
							onchange={(event) => updateDocumentViewBox('width', event)}
						/>
					</div>

					<label for="document-viewbox-height">ViewBox Height</label>
					<div class="number-field">
						<input
							id="document-viewbox-height"
							min="0.0001"
							step="any"
							type="number"
							value={getDocumentViewBox(geometryDocument).height}
							onchange={(event) => updateDocumentViewBox('height', event)}
						/>
					</div>
					</div>
				</details>
			</details>

			<details class="inspector-section selection-section">
				<summary>
					<span>Composition</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				{#if selectedNode && selectedNodeIds.length === 1}
					<div class="field-grid composition-fields">
						<label for="clip-path">Clip</label>
						<select
							id="clip-path"
							class="clip-path-select"
							value={selectedNode.clipPath?.nodeId ?? ''}
							onchange={(event) => updateSelectedClipPath(event.currentTarget.value)}
						>
							<option value="">None</option>
							{#each clipPathCandidates as candidate}
								<option value={candidate.id}>{candidate.name} · {candidate.type}</option>
							{/each}
						</select>

						<label for="mask">Mask</label>
						<select
							id="mask"
							class="clip-path-select"
							value={selectedNode.mask?.nodeId ?? ''}
							onchange={(event) => updateSelectedMask(event.currentTarget.value)}
						>
							<option value="">None</option>
							{#each maskCandidates as candidate}
								<option value={candidate.id}>{candidate.name} · {candidate.type}</option>
							{/each}
						</select>
						{#if clipPathCandidates.length === 0}
							<span></span>
							<p class="composition-hint">Add a closed shape to use as a clip.</p>
						{/if}
					</div>
				{:else}
					<div class="empty-row">
						{selectedNodeIds.length > 1 ? `${selectedNodeIds.length} selected` : 'No selection'}
					</div>
				{/if}
			</details>

			<details class="inspector-section selection-section" open>
				<summary>
					<span>Transform</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				{#if selectedNode && selectedNodeIds.length === 1}
					<div class="field-grid transform-fields">
						<label for="transform-translate-x">Move</label>
						<div class="transform-inline-fields">
							<input
								id="transform-translate-x"
								aria-label="Horizontal translation"
								class="text-field"
								type="number"
								step="1"
								value={selectedTransformValue('translateX')}
								oninput={(event) =>
									updateSelectedTransformNumber('translateX', event.currentTarget.value)}
							/>
							<input
								aria-label="Vertical translation"
								class="text-field"
								type="number"
								step="1"
								value={selectedTransformValue('translateY')}
								oninput={(event) =>
									updateSelectedTransformNumber('translateY', event.currentTarget.value)}
							/>
						</div>

						<label for="transform-rotation">Rotate</label>
						<div class="transform-number-field">
							<input
								id="transform-rotation"
								class="text-field"
								type="number"
								step="1"
								value={selectedTransformValue('rotation')}
								oninput={(event) =>
									updateSelectedTransformNumber('rotation', event.currentTarget.value)}
							/>
							<span>°</span>
						</div>

						<label for="transform-scale-x">Scale</label>
						<div class="transform-scale-fields">
							<input
								id="transform-scale-x"
								aria-label="Horizontal scale"
								class="text-field"
								type="number"
								min="0.01"
								step="0.05"
								value={selectedTransformValue('scaleX')}
								oninput={(event) =>
									updateSelectedTransformScale('scaleX', event.currentTarget.value)}
							/>
							<input
								aria-label="Vertical scale"
								class="text-field"
								type="number"
								min="0.01"
								step="0.05"
								value={selectedTransformValue('scaleY')}
								oninput={(event) =>
									updateSelectedTransformScale('scaleY', event.currentTarget.value)}
							/>
							<button
								aria-label="Lock scale ratio"
								aria-pressed={isTransformScaleLocked}
								class:active={isTransformScaleLocked}
								class="transform-lock-button"
								type="button"
								onclick={() => (isTransformScaleLocked = !isTransformScaleLocked)}>Link</button
							>
						</div>

						<span></span>
						<button
							class="transform-reset-button"
							disabled={!selectedNode.transform}
							type="button"
							onclick={resetSelectedTransform}>Reset transform</button
						>
					</div>
				{:else}
					<div class="empty-row">
						{selectedNodeIds.length > 1 ? `${selectedNodeIds.length} selected` : 'No selection'}
					</div>
				{/if}
			</details>

			<details
				class="inspector-section selection-section text-section"
				class:textUnavailable={selectedNode?.type !== 'text'}
				open
			>
				<summary>
					<span>Text</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				{#if selectedNode && selectedNodeIds.length === 1 && selectedNode.type === 'text'}
					<div class="field-grid">
						<label for="text-content">Content</label>
						<textarea
							id="text-content"
							class="text-area-field"
							value={selectedNode.text}
							oninput={(event) => updateSelectedTextContent(event.currentTarget.value)}
						></textarea>

						<label for="text-font-family">Family</label>
						<input
							id="text-font-family"
							class="text-field"
							value={selectedNode.fontFamily ?? ''}
							oninput={(event) => updateSelectedTextField('fontFamily', event.currentTarget.value)}
						/>

						<label for="text-font-size">Size</label>
						<input
							id="text-font-size"
							class="text-field"
							min="1"
							step="1"
							type="number"
							value={selectedNode.fontSize ?? 16}
							oninput={(event) => updateSelectedTextNumber('fontSize', event.currentTarget.value)}
						/>

						<label for="text-font-weight">Weight</label>
						<input
							id="text-font-weight"
							class="text-field"
							value={String(selectedNode.fontWeight ?? '')}
							oninput={(event) => updateSelectedTextField('fontWeight', event.currentTarget.value)}
						/>

						<label for="text-font-style">Style</label>
						<div class="line-style-options" id="text-font-style">
							{#each ['normal', 'italic'] as fontStyle}
								<button
									class:active={(selectedNode.fontStyle ?? 'normal') === fontStyle}
									type="button"
									onclick={() => updateSelectedTextField('fontStyle', fontStyle)}
								>
									{fontStyle}
								</button>
							{/each}
						</div>

						<label for="text-anchor">Anchor</label>
						<div class="line-style-options" id="text-anchor">
							{#each ['start', 'middle', 'end'] as textAnchor}
								<button
									class:active={(selectedNode.textAnchor ?? 'start') === textAnchor}
									type="button"
									onclick={() => updateSelectedTextField('textAnchor', textAnchor)}
								>
									{textAnchor}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div class="empty-row">
						{selectedNodeIds.length === 1
							? 'N/A'
							: selectedNodeIds.length > 1
								? `${selectedNodeIds.length} selected`
								: 'No selection'}
					</div>
				{/if}
			</details>

			<details class="inspector-section document-section" open>
				<summary>
					<span>Page Background</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				<div class="background-options" aria-label="Page background">
					{#each ['white', 'gray', 'black', 'alpha'] as preset}
						<button
							aria-label={`${preset} background`}
							class:active={backgroundPreset(geometryDocument.background) === preset}
							class="background-swatch {preset}"
							type="button"
							onclick={() => updateDocumentBackground(preset as BackgroundPreset)}
						></button>
					{/each}
				</div>
			</details>

			<details
				class="inspector-section selection-section geometry-section"
				class:geometryUnavailable={selectedNode?.type === 'group'}
			>
				<summary>
					<span>Geometry</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				{#if selectedNode && selectedNodeIds.length === 1}
					<div class="field-grid">
						{#if selectedNode.type === 'rect'}
							<label for="rect-x">X</label>
							<input
								id="rect-x"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.x}
								oninput={(event) => updateSelectedGeometryNumber('x', event.currentTarget.value)}
							/>

							<label for="rect-y">Y</label>
							<input
								id="rect-y"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.y}
								oninput={(event) => updateSelectedGeometryNumber('y', event.currentTarget.value)}
							/>

							<label for="rect-width">Width</label>
							<input
								id="rect-width"
								class="text-field"
								min="1"
								step="1"
								type="number"
								value={selectedNode.width}
								oninput={(event) =>
									updateSelectedGeometryNumber('width', event.currentTarget.value)}
							/>

							<label for="rect-height">Height</label>
							<input
								id="rect-height"
								class="text-field"
								min="1"
								step="1"
								type="number"
								value={selectedNode.height}
								oninput={(event) =>
									updateSelectedGeometryNumber('height', event.currentTarget.value)}
							/>

							<label for="rect-rx">Corner X</label>
							<input
								id="rect-rx"
								class="text-field"
								min="0"
								max={selectedNode.width / 2}
								placeholder={String(selectedNode.ry ?? 0)}
								step="1"
								type="number"
								value={selectedNode.rx ?? ''}
								oninput={(event) => updateSelectedGeometryNumber('rx', event.currentTarget.value)}
							/>

							<label for="rect-ry">Corner Y</label>
							<input
								id="rect-ry"
								class="text-field"
								min="0"
								max={selectedNode.height / 2}
								placeholder={String(selectedNode.rx ?? 0)}
								step="1"
								type="number"
								value={selectedNode.ry ?? ''}
								oninput={(event) => updateSelectedGeometryNumber('ry', event.currentTarget.value)}
							/>
						{:else if selectedNode.type === 'ellipse'}
							<label for="ellipse-cx">Center X</label>
							<input
								id="ellipse-cx"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.cx}
								oninput={(event) => updateSelectedGeometryNumber('cx', event.currentTarget.value)}
							/>

							<label for="ellipse-cy">Center Y</label>
							<input
								id="ellipse-cy"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.cy}
								oninput={(event) => updateSelectedGeometryNumber('cy', event.currentTarget.value)}
							/>

							<label for="ellipse-rx">Radius X</label>
							<input
								id="ellipse-rx"
								class="text-field"
								min="0.5"
								step="1"
								type="number"
								value={selectedNode.rx}
								oninput={(event) => updateSelectedGeometryNumber('rx', event.currentTarget.value)}
							/>

							<label for="ellipse-ry">Radius Y</label>
							<input
								id="ellipse-ry"
								class="text-field"
								min="0.5"
								step="1"
								type="number"
								value={selectedNode.ry}
								oninput={(event) => updateSelectedGeometryNumber('ry', event.currentTarget.value)}
							/>
						{:else if selectedNode.type === 'circle'}
							<label for="circle-cx">Center X</label>
							<input
								id="circle-cx"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.cx}
								oninput={(event) => updateSelectedGeometryNumber('cx', event.currentTarget.value)}
							/>

							<label for="circle-cy">Center Y</label>
							<input
								id="circle-cy"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.cy}
								oninput={(event) => updateSelectedGeometryNumber('cy', event.currentTarget.value)}
							/>

							<label for="circle-r">Radius</label>
							<input
								id="circle-r"
								class="text-field"
								min="0.5"
								step="1"
								type="number"
								value={selectedNode.r}
								oninput={(event) => updateSelectedGeometryNumber('r', event.currentTarget.value)}
							/>
						{:else if selectedNode.type === 'line'}
							<label for="line-x1">X1</label>
							<input
								id="line-x1"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.x1}
								oninput={(event) => updateSelectedGeometryNumber('x1', event.currentTarget.value)}
							/>

							<label for="line-y1">Y1</label>
							<input
								id="line-y1"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.y1}
								oninput={(event) => updateSelectedGeometryNumber('y1', event.currentTarget.value)}
							/>

							<label for="line-x2">X2</label>
							<input
								id="line-x2"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.x2}
								oninput={(event) => updateSelectedGeometryNumber('x2', event.currentTarget.value)}
							/>

							<label for="line-y2">Y2</label>
							<input
								id="line-y2"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.y2}
								oninput={(event) => updateSelectedGeometryNumber('y2', event.currentTarget.value)}
							/>
						{:else if selectedNode.type === 'text'}
							<label for="text-x">X</label>
							<input
								id="text-x"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.x}
								oninput={(event) => updateSelectedGeometryNumber('x', event.currentTarget.value)}
							/>

							<label for="text-y">Y</label>
							<input
								id="text-y"
								class="text-field"
								step="1"
								type="number"
								value={selectedNode.y}
								oninput={(event) => updateSelectedGeometryNumber('y', event.currentTarget.value)}
							/>
						{:else}
							<div class="empty-row">N/A</div>
						{/if}
					</div>
				{:else}
					<div class="empty-row">
						{selectedNodeIds.length > 1 ? `${selectedNodeIds.length} selected` : 'No selection'}
					</div>
				{/if}
			</details>

			<details class="inspector-section selection-section" open>
				<summary>
					<span>Appearance</span>
					<svg
						aria-hidden="true"
						class="section-chevron"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							class="section-chevron-closed"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m8.25 4.5 7.5 7.5-7.5 7.5"
						/>
						<path
							class="section-chevron-open"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m19.5 8.25-7.5 7.5-7.5-7.5"
						/>
					</svg>
				</summary>
				{#if selectedNode && selectedNodeIds.length === 1 && selectedNode.type !== 'group'}
					<div class="field-grid">
						<label for="fill-mode-solid">Fill</label>
						<div class="paint-editor">
							<div class="paint-mode-options">
								<button
									id="fill-mode-solid"
									class:active={paintMode('fill') === 'solid'}
									type="button"
									onclick={() => setPaintMode('fill', 'solid')}>Solid</button
								>
								<button
									class:active={paintMode('fill') === 'linear'}
									type="button"
									onclick={() => setPaintMode('fill', 'linear')}>Linear</button
								>
								<button
									class:active={paintMode('fill') === 'radial'}
									type="button"
									onclick={() => setPaintMode('fill', 'radial')}>Radial</button
								>
								<button
									class:active={paintMode('fill') === 'none'}
									type="button"
									onclick={() => setPaintMode('fill', 'none')}>None</button
								>
							</div>
							{#if paintMode('fill') === 'solid'}
								<div class="solid-paint-row">
									<input
										aria-label="Fill color"
										class="color-field"
										type="color"
										value={colorPickerValue(selectedPaint('fill'), uiColors.primary)}
										oninput={(event) => updateSelectedPaint('fill', event.currentTarget.value)}
									/>
									<input
										id="fill"
										class="text-field"
										value={paintFieldValue(selectedPaint('fill'), uiColors.primary)}
										oninput={(event) => updateSelectedPaint('fill', event.currentTarget.value)}
									/>
								</div>
							{:else if paintMode('fill') !== 'none'}
								{@const gradient = selectedGradient('fill')}
								{#if gradient}
									<div class="gradient-editor">
										<div
											class="gradient-preview"
											style:background={gradientPreviewStyle(gradient)}
											aria-label="Fill gradient preview"
										></div>
										<div class="gradient-stops-heading">
											<span>Stops</span>
											<button type="button" onclick={() => addGradientStop(gradient)}>Add</button>
										</div>
										<div class="gradient-stops">
											{#each gradient.stops as stop, index}
												<div class="gradient-stop">
													<input
														aria-label={`Fill stop ${index + 1} color`}
														class="color-field"
														type="color"
														value={colorPickerValue(stop.color, '#2563ff')}
														oninput={(event) =>
															updateGradientStop(gradient, index, {
																color: event.currentTarget.value
															})}
													/>
													<input
														aria-label={`Fill stop ${index + 1} position`}
														type="range"
														min="0"
														max="100"
														value={stop.offset * 100}
														oninput={(event) =>
															updateGradientStopOffset(gradient, index, event.currentTarget.value)}
													/>
													<input
														aria-label={`Fill stop ${index + 1} position percent`}
														class="text-field"
														type="number"
														min="0"
														max="100"
														value={Math.round(stop.offset * 100)}
														oninput={(event) =>
															updateGradientStopOffset(gradient, index, event.currentTarget.value)}
													/>
													<input
														aria-label={`Fill stop ${index + 1} opacity`}
														class="text-field"
														type="number"
														min="0"
														max="100"
														value={Math.round((stop.opacity ?? 1) * 100)}
														oninput={(event) =>
															updateGradientStopOpacity(gradient, index, event.currentTarget.value)}
													/>
													<button
														aria-label={`Remove fill stop ${index + 1}`}
														class="gradient-stop-remove"
														disabled={gradient.stops.length <= 2}
														type="button"
														onclick={() => removeGradientStop(gradient, index)}>×</button
													>
												</div>
											{/each}
										</div>
										<div class="gradient-coordinate-grid">
											{#if gradient.type === 'linear'}
												<span>Start</span><input
													aria-label="Fill gradient start X"
													class="text-field"
													type="number"
													value={gradient.x1}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'x1', event.currentTarget.value)}
												/><input
													aria-label="Fill gradient start Y"
													class="text-field"
													type="number"
													value={gradient.y1}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'y1', event.currentTarget.value)}
												/>
												<span>End</span><input
													aria-label="Fill gradient end X"
													class="text-field"
													type="number"
													value={gradient.x2}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'x2', event.currentTarget.value)}
												/><input
													aria-label="Fill gradient end Y"
													class="text-field"
													type="number"
													value={gradient.y2}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'y2', event.currentTarget.value)}
												/>
											{:else}
												<span>Center</span><input
													aria-label="Fill gradient center X"
													class="text-field"
													type="number"
													value={gradient.cx}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'cx', event.currentTarget.value)}
												/><input
													aria-label="Fill gradient center Y"
													class="text-field"
													type="number"
													value={gradient.cy}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'cy', event.currentTarget.value)}
												/>
												<label for="fill-gradient-radius">Radius</label><input
													id="fill-gradient-radius"
													aria-label="Fill gradient radius"
													class="text-field"
													type="number"
													min="0.01"
													value={gradient.r}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'r', event.currentTarget.value)}
												/><span></span>
											{/if}
										</div>
									</div>
								{/if}
							{/if}
						</div>

						<label for="stroke-mode-solid">Stroke</label>
						<div class="paint-editor">
							<div class="paint-mode-options">
								<button
									id="stroke-mode-solid"
									class:active={paintMode('stroke') === 'solid'}
									type="button"
									onclick={() => setPaintMode('stroke', 'solid')}>Solid</button
								>
								<button
									class:active={paintMode('stroke') === 'linear'}
									type="button"
									onclick={() => setPaintMode('stroke', 'linear')}>Linear</button
								>
								<button
									class:active={paintMode('stroke') === 'radial'}
									type="button"
									onclick={() => setPaintMode('stroke', 'radial')}>Radial</button
								>
								<button
									class:active={paintMode('stroke') === 'none'}
									type="button"
									onclick={() => setPaintMode('stroke', 'none')}>None</button
								>
							</div>
							{#if paintMode('stroke') === 'solid'}
								<div class="solid-paint-row">
									<input
										aria-label="Stroke color"
										class="color-field"
										type="color"
										value={colorPickerValue(selectedPaint('stroke'), '#111827')}
										oninput={(event) => updateSelectedPaint('stroke', event.currentTarget.value)}
									/>
									<input
										id="stroke"
										class="text-field"
										value={paintFieldValue(selectedPaint('stroke'), '#111827')}
										oninput={(event) => updateSelectedPaint('stroke', event.currentTarget.value)}
									/>
								</div>
							{:else if paintMode('stroke') !== 'none'}
								{@const gradient = selectedGradient('stroke')}
								{#if gradient}
									<div class="gradient-editor">
										<div
											class="gradient-preview"
											style:background={gradientPreviewStyle(gradient)}
											aria-label="Stroke gradient preview"
										></div>
										<div class="gradient-stops-heading">
											<span>Stops</span>
											<button type="button" onclick={() => addGradientStop(gradient)}>Add</button>
										</div>
										<div class="gradient-stops">
											{#each gradient.stops as stop, index}
												<div class="gradient-stop">
													<input
														aria-label={`Stroke stop ${index + 1} color`}
														class="color-field"
														type="color"
														value={colorPickerValue(stop.color, '#2563ff')}
														oninput={(event) =>
															updateGradientStop(gradient, index, {
																color: event.currentTarget.value
															})}
													/>
													<input
														aria-label={`Stroke stop ${index + 1} position`}
														type="range"
														min="0"
														max="100"
														value={stop.offset * 100}
														oninput={(event) =>
															updateGradientStopOffset(gradient, index, event.currentTarget.value)}
													/>
													<input
														aria-label={`Stroke stop ${index + 1} position percent`}
														class="text-field"
														type="number"
														min="0"
														max="100"
														value={Math.round(stop.offset * 100)}
														oninput={(event) =>
															updateGradientStopOffset(gradient, index, event.currentTarget.value)}
													/>
													<input
														aria-label={`Stroke stop ${index + 1} opacity`}
														class="text-field"
														type="number"
														min="0"
														max="100"
														value={Math.round((stop.opacity ?? 1) * 100)}
														oninput={(event) =>
															updateGradientStopOpacity(gradient, index, event.currentTarget.value)}
													/>
													<button
														aria-label={`Remove stroke stop ${index + 1}`}
														class="gradient-stop-remove"
														disabled={gradient.stops.length <= 2}
														type="button"
														onclick={() => removeGradientStop(gradient, index)}>×</button
													>
												</div>
											{/each}
										</div>
										<div class="gradient-coordinate-grid">
											{#if gradient.type === 'linear'}
												<span>Start</span><input
													aria-label="Stroke gradient start X"
													class="text-field"
													type="number"
													value={gradient.x1}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'x1', event.currentTarget.value)}
												/><input
													aria-label="Stroke gradient start Y"
													class="text-field"
													type="number"
													value={gradient.y1}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'y1', event.currentTarget.value)}
												/>
												<span>End</span><input
													aria-label="Stroke gradient end X"
													class="text-field"
													type="number"
													value={gradient.x2}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'x2', event.currentTarget.value)}
												/><input
													aria-label="Stroke gradient end Y"
													class="text-field"
													type="number"
													value={gradient.y2}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'y2', event.currentTarget.value)}
												/>
											{:else}
												<span>Center</span><input
													aria-label="Stroke gradient center X"
													class="text-field"
													type="number"
													value={gradient.cx}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'cx', event.currentTarget.value)}
												/><input
													aria-label="Stroke gradient center Y"
													class="text-field"
													type="number"
													value={gradient.cy}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'cy', event.currentTarget.value)}
												/>
												<label for="stroke-gradient-radius">Radius</label><input
													id="stroke-gradient-radius"
													aria-label="Stroke gradient radius"
													class="text-field"
													type="number"
													min="0.01"
													value={gradient.r}
													oninput={(event) =>
														updateGradientCoordinate(gradient, 'r', event.currentTarget.value)}
												/><span></span>
											{/if}
										</div>
									</div>
								{/if}
							{/if}
						</div>

						<label for="effects-blur">Effects</label>
						<div class="effects-editor">
							<div class="effect-toggles">
								<button
									id="effects-blur"
									class:active={Boolean(selectedBlurEffect())}
									type="button"
									onclick={() => toggleSelectedEffect('blur')}>Blur</button
								>
								<button
									class:active={Boolean(selectedDropShadowEffect())}
									type="button"
									onclick={() => toggleSelectedEffect('dropShadow')}>Shadow</button
								>
							</div>
							{#if selectedBlurEffect()}
								{@const blurEffect = selectedBlurEffect()}
								{#if blurEffect}
									<div class="effect-control-grid">
										<span>Blur</span>
										<input
											aria-label="Blur radius"
											class="text-field"
											type="number"
											min="0"
											step="0.5"
											value={blurEffect.radius}
											oninput={(event) => updateSelectedBlurRadius(event.currentTarget.value)}
										/>
									</div>
								{/if}
							{/if}
							{#if selectedDropShadowEffect()}
								{@const shadowEffect = selectedDropShadowEffect()}
								{#if shadowEffect}
									<div class="effect-control-grid shadow-controls">
										<span>Offset</span>
										<div class="effect-inline-fields">
											<input
												aria-label="Shadow horizontal offset"
												class="text-field"
												type="number"
												step="0.5"
												value={shadowEffect.dx}
												oninput={(event) =>
													updateSelectedDropShadowNumber('dx', event.currentTarget.value)}
											/>
											<input
												aria-label="Shadow vertical offset"
												class="text-field"
												type="number"
												step="0.5"
												value={shadowEffect.dy}
												oninput={(event) =>
													updateSelectedDropShadowNumber('dy', event.currentTarget.value)}
											/>
										</div>
										<span>Blur</span>
										<input
											aria-label="Shadow blur"
											class="text-field"
											type="number"
											min="0"
											step="0.5"
											value={shadowEffect.blur}
											oninput={(event) =>
												updateSelectedDropShadowNumber('blur', event.currentTarget.value)}
										/>
										<span>Color</span>
										<div class="solid-paint-row">
											<input
												aria-label="Shadow color picker"
												class="color-field"
												type="color"
												value={colorPickerValue(shadowEffect.color, '#000000')}
												oninput={(event) =>
													updateSelectedDropShadowColor(event.currentTarget.value)}
											/>
											<input
												aria-label="Shadow color"
												class="text-field"
												value={shadowEffect.color}
												oninput={(event) =>
													updateSelectedDropShadowColor(event.currentTarget.value)}
											/>
										</div>
										<span>Opacity</span>
										<div class="effect-opacity-control">
											<input
												aria-label="Shadow opacity"
												type="range"
												min="0"
												max="100"
												value={(shadowEffect.opacity ?? 1) * 100}
												oninput={(event) =>
													updateSelectedDropShadowOpacity(event.currentTarget.value)}
											/>
											<input
												aria-label="Shadow opacity percent"
												class="text-field"
												type="number"
												min="0"
												max="100"
												value={Math.round((shadowEffect.opacity ?? 1) * 100)}
												oninput={(event) =>
													updateSelectedDropShadowOpacity(event.currentTarget.value)}
											/>
										</div>
									</div>
								{/if}
							{/if}
						</div>

						<label for="stroke-width">Stroke W</label>
						<input
							id="stroke-width"
							class="text-field"
							min="0"
							step="0.5"
							type="number"
							value={selectedNode.style?.strokeWidth ??
								(selectedNode.type === 'text' ? selectedNode.strokeWidth : undefined) ??
								2}
							oninput={(event) => updateSelectedStyle('strokeWidth', event.currentTarget.value)}
						/>

						<label for="stroke-linecap">Cap</label>
						<div class="line-style-options" id="stroke-linecap">
							{#each strokeLinecapOptions as linecap}
								<button
									class:active={(selectedNode.style?.strokeLinecap ?? 'butt') === linecap}
									type="button"
									onclick={() => updateSelectedStyle('strokeLinecap', linecap)}
								>
									{linecap}
								</button>
							{/each}
						</div>

						<label for="stroke-linejoin">Join</label>
						<div class="line-style-options" id="stroke-linejoin">
							{#each strokeLinejoinOptions as linejoin}
								<button
									class:active={(selectedNode.style?.strokeLinejoin ?? 'miter') === linejoin}
									type="button"
									onclick={() => updateSelectedStyle('strokeLinejoin', linejoin)}
								>
									{linejoin}
								</button>
							{/each}
						</div>

						{#if (selectedNode.style?.strokeLinejoin ?? 'miter') === 'miter'}
							<label for="stroke-miterlimit">Miter</label>
							<input
								id="stroke-miterlimit"
								class="text-field"
								min="0"
								step="0.5"
								type="number"
								value={selectedNode.style?.strokeMiterlimit ?? 4}
								oninput={(event) =>
									updateSelectedStyle('strokeMiterlimit', event.currentTarget.value)}
							/>
						{/if}

						<label for="stroke-dasharray">Dash</label>
						<input
							id="stroke-dasharray"
							class="text-field"
							placeholder="8 4"
							value={selectedNode.style?.strokeDasharray ?? ''}
							oninput={(event) => updateSelectedStyle('strokeDasharray', event.currentTarget.value)}
						/>

						<label for="stroke-dashoffset">Dash Offset</label>
						<input
							id="stroke-dashoffset"
							class="text-field"
							step="1"
							type="number"
							value={selectedNode.style?.strokeDashoffset ?? 0}
							oninput={(event) =>
								updateSelectedStyle('strokeDashoffset', event.currentTarget.value)}
						/>

						<label for="opacity">Opacity</label>
						<input
							id="opacity"
							class="text-field"
							min="0"
							max="1"
							step="0.05"
							type="number"
							value={selectedNode.style?.opacity ??
								(selectedNode.type === 'text' ? selectedNode.opacity : undefined) ??
								1}
							oninput={(event) => updateSelectedStyle('opacity', event.currentTarget.value)}
						/>
					</div>
					<button class="secondary-button danger" type="button" onclick={deleteSelection}
						>Delete Selection</button
					>
				{:else}
					<div class="empty-row">
						{#if selectedNodeIds.length > 1}
							{selectedNodeIds.length} selected
						{:else if selectedNode?.type === 'group'}
							Group selected
						{:else}
							No selection
						{/if}
					</div>
				{/if}
			</details>
		</aside>
	</main>

	{#if settingsOpen}
		<div class="modal-backdrop" role="presentation" onclick={closeProjectSettings}>
			<div
				aria-labelledby="project-settings-title"
				aria-modal="true"
				class="settings-modal"
				role="dialog"
				tabindex="-1"
				onclick={(event) => event.stopPropagation()}
				onkeydown={(event) => event.stopPropagation()}
			>
				<header class="modal-header">
					<h2 id="project-settings-title">Project Settings</h2>
					<button aria-label="Close settings" type="button" onclick={closeProjectSettings}
						>Close</button
					>
				</header>

				<label class="settings-field" for="project-prompt">
					<span>Prompt</span>
					<textarea
						id="project-prompt"
						placeholder="Draw a cohesive logo set in a minimal geometric style..."
						value={project.projectPrompt ?? ''}
						oninput={(event) => updateProjectPrompt(event.currentTarget.value)}
					></textarea>
				</label>

				<div class="settings-grid" aria-label="Default canvas">
					<h3>Default Canvas</h3>
					<label for="default-canvas-width">Width</label>
					<div class="number-field">
						<input
							id="default-canvas-width"
							min="1"
							step="1"
							type="number"
							value={projectDefaultCanvas().width}
							onchange={(event) => updateDefaultCanvas('width', event)}
						/>
						<span>px</span>
					</div>

					<label for="default-canvas-height">Height</label>
					<div class="number-field">
						<input
							id="default-canvas-height"
							min="1"
							step="1"
							type="number"
							value={projectDefaultCanvas().height}
							onchange={(event) => updateDefaultCanvas('height', event)}
						/>
						<span>px</span>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
