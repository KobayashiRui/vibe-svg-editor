<script lang="ts">
	import type { GeometryNode, NodeId } from '@vibesvg/ast';
	import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers';
	import { createDraggable, createDroppable } from '@dnd-kit/svelte';

	export type LayerItem = {
		depth: number;
		expanded: boolean;
		expandable: boolean;
		node: GeometryNode;
		parentId: NodeId;
	};

	type Props = {
		item: LayerItem;
		selected: boolean;
		dropPosition?: 'before' | 'after' | 'inside';
		onEditGroup: (nodeId: NodeId) => void;
		onContextMenu: (event: MouseEvent, nodeId: NodeId) => void;
		onSelect: (nodeId: NodeId, additive: boolean) => void;
		onToggleExpanded: (nodeId: NodeId) => void;
	};

	let {
		item,
		selected,
		dropPosition,
		onContextMenu,
		onEditGroup,
		onSelect,
		onToggleExpanded
	}: Props = $props();

	const draggable = createDraggable({
		get id() {
			return item.node.id;
		},
		data: { kind: 'layer' },
		type: 'layer',
		modifiers: [RestrictToVerticalAxis]
	});

	const droppable = createDroppable({
		get id() {
			return `layer-drop:${item.node.id}`;
		},
		accept: (source) => source.type === 'layer' && source.id !== item.node.id,
		data: {
			kind: 'layer-row',
			get nodeId() {
				return item.node.id;
			}
		}
	});

	function select(event: MouseEvent) {
		onSelect(item.node.id, event.shiftKey || event.metaKey || event.ctrlKey);
	}
</script>

<div
	class:drop-after={dropPosition === 'after'}
	class:drop-before={dropPosition === 'before'}
	class:drop-inside={dropPosition === 'inside'}
	class="layer-row-drop"
	style={`--layer-depth: ${item.depth};`}
	{@attach droppable.attach}
>
	<div
		class:dragging={draggable.isDragging}
		class:expanded-group={item.node.type === 'group' && item.expanded}
		class:group-row={item.node.type === 'group'}
		class:nested-row={item.depth > 0}
		class:selected
		class="layer-row"
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
		{@attach draggable.attach}
	>
		<button
			aria-label={`Drag ${item.node.name ?? item.node.type}`}
			class="layer-drag-handle"
			type="button"
			onclick={(event) => event.stopPropagation()}
			{@attach draggable.attachHandle}
		>
			<svg aria-hidden="true" viewBox="0 0 12 18">
				<circle cx="3" cy="3" r="1" />
				<circle cx="9" cy="3" r="1" />
				<circle cx="3" cy="9" r="1" />
				<circle cx="9" cy="9" r="1" />
				<circle cx="3" cy="15" r="1" />
				<circle cx="9" cy="15" r="1" />
			</svg>
		</button>
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
</div>
