<script lang="ts">
	import type { GeometryDocument } from '@vibesvg/ast';
	import PageThumbnail from './PageThumbnail.svelte';
	import { onMount } from 'svelte';

	export type ExportPageOption = {
		document: GeometryDocument;
		id: string;
		name: string;
		width: number;
		height: number;
		active: boolean;
	};

	type ExportMode = 'current' | 'selected' | 'all';

	let {
		activePageId,
		onClose,
		onExport,
		pages
	}: {
		activePageId: string;
		onClose: () => void;
		onExport: (pageIds: string[]) => void;
		pages: ExportPageOption[];
	} = $props();

	let mode = $state<ExportMode>('current');
	let selectedPageIds = $state<string[]>([]);
	let selectAllInput = $state<HTMLInputElement | undefined>();
	const allSelected = $derived(pages.length > 0 && selectedPageIds.length === pages.length);
	const partiallySelected = $derived(selectedPageIds.length > 0 && selectedPageIds.length < pages.length);

	onMount(() => {
		selectedPageIds = [activePageId];
	});

	$effect(() => {
		if (selectAllInput) {
			selectAllInput.indeterminate = partiallySelected;
		}
	});

	const exportPageIds = $derived.by(() => {
		if (mode === 'current') {
			return [activePageId];
		}

		if (mode === 'all') {
			return pages.map((page) => page.id);
		}

		return selectedPageIds;
	});

	function setMode(nextMode: ExportMode) {
		mode = nextMode;

		if (nextMode === 'selected' && selectedPageIds.length === 0) {
			selectedPageIds = [activePageId];
		}
	}

	function togglePage(pageId: string, checked: boolean) {
		if (checked) {
			selectedPageIds = [...new Set([...selectedPageIds, pageId])];
			return;
		}

		selectedPageIds = selectedPageIds.filter((id) => id !== pageId);
	}

	function toggleAllPages(checked: boolean) {
		selectedPageIds = checked ? pages.map((page) => page.id) : [];
	}

	function confirmExport() {
		if (exportPageIds.length === 0) {
			return;
		}

		onExport(exportPageIds);
	}
</script>

<div
	class="export-popover"
	role="dialog"
	tabindex="-1"
	aria-label="Export SVG"
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			onClose();
		}
	}}
>
	<div class="export-popover-header">
		<h2>Export SVG</h2>
		<button type="button" aria-label="Close export menu" onclick={onClose}>x</button>
	</div>

	<div class="export-mode-list" role="radiogroup" aria-label="Export scope">
		<label>
			<input type="radio" name="svg-export-mode" checked={mode === 'current'} onchange={() => setMode('current')} />
			<span>Current page</span>
		</label>
		<label>
			<input type="radio" name="svg-export-mode" checked={mode === 'all'} onchange={() => setMode('all')} />
			<span>All pages</span>
		</label>
		<label>
			<input type="radio" name="svg-export-mode" checked={mode === 'selected'} onchange={() => setMode('selected')} />
			<span>Selected pages</span>
		</label>
	</div>

	{#if mode === 'selected'}
		<div class="export-page-list" aria-label="Pages to export">
			<label class="export-page-select-all">
				<input
					bind:this={selectAllInput}
					type="checkbox"
					checked={allSelected}
					onchange={(event) => toggleAllPages(event.currentTarget.checked)}
				/>
				<span>Select all</span>
			</label>
			{#each pages as page}
				<label>
					<input
						type="checkbox"
						checked={selectedPageIds.includes(page.id)}
						onchange={(event) => togglePage(page.id, event.currentTarget.checked)}
					/>
					<span class="export-page-thumb">
						<PageThumbnail document={page.document} />
					</span>
					<span class="export-page-name">{page.name}</span>
				</label>
			{/each}
		</div>
	{/if}

	<div class="export-popover-footer">
		<span>{exportPageIds.length} page{exportPageIds.length === 1 ? '' : 's'}</span>
		<button type="button" onclick={onClose}>Cancel</button>
		<button type="button" class="primary" disabled={exportPageIds.length === 0} onclick={confirmExport}>Export</button>
	</div>
</div>
