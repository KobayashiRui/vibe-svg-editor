<script lang="ts">
	import type { GeometryNode, NodeId } from '@vibesvg/ast';
	import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers';
	import { createSortable } from '@dnd-kit/svelte/sortable';

	export type LayerItem = {
		astIndex: number;
		depth: number;
		expanded: boolean;
		expandable: boolean;
		node: GeometryNode;
		parentId: NodeId;
		sortIndex?: number;
		uiIndex: number;
	};

	type Props = {
		item: LayerItem;
		selected: boolean;
		onEditGroup: (nodeId: NodeId) => void;
		onContextMenu: (event: MouseEvent, nodeId: NodeId) => void;
		onSelect: (nodeId: NodeId, additive: boolean) => void;
		onToggleExpanded: (nodeId: NodeId) => void;
	};

	let { item, selected, onContextMenu, onEditGroup, onSelect, onToggleExpanded }: Props = $props();

	const sortable = createSortable({
		get id() {
			return item.node.id;
		},
		get index() {
			return item.sortIndex ?? item.uiIndex;
		},
		get group() {
			return 'layers';
		},
		type: 'layer',
		modifiers: [RestrictToVerticalAxis]
	});

	function select(event: MouseEvent) {
		onSelect(item.node.id, event.shiftKey || event.metaKey || event.ctrlKey);
	}
</script>

<div
	class:dragging={sortable.isDragging}
	class:drop-target={sortable.isDropTarget && !sortable.isDragSource}
	class:expanded-group={item.node.type === 'group' && item.expanded}
	class:group-row={item.node.type === 'group'}
	class:nested-row={item.depth > 0}
	class:selected
	class="layer-row"
	style={`--layer-depth: ${item.depth};`}
	role="button"
	tabindex="0"
	onclick={select}
	oncontextmenu={(event) => onContextMenu(event, item.node.id)}
	ondblclick={() => item.node.type === 'group' && onEditGroup(item.node.id)}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelect(item.node.id, event.shiftKey || event.metaKey || event.ctrlKey);
		}
	}}
	{@attach sortable.attach}
>
	{#if item.expandable}
		<button
			class="layer-disclosure"
			type="button"
			aria-label={item.expanded ? 'Collapse group' : 'Expand group'}
			onclick={(event) => {
				event.stopPropagation();
				onToggleExpanded(item.node.id);
			}}
		>
			{#if item.expanded}
				<svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
				</svg>
			{:else}
				<svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
				</svg>
			{/if}
		</button>
	{/if}
	<span>{item.node.name ?? item.node.type}</span>
	<code>{item.node.type}</code>
</div>
