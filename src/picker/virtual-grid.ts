import type { GridItem, GridLayout, GridRow } from "./grid-layout";

/**
 * Extra space rendered above and below the visible area (at least this, or
 * one viewport), so fast scrolling and touch flicks stay filled.
 */
const MIN_OVERSCAN_PX = 240;
/** Used when the element has no size yet (hidden, or a test environment without layout). */
const FALLBACK_VIEWPORT_PX = 320;

export type TileRenderer = (tileEl: HTMLElement, item: GridItem, index: number) => void;

/**
 * A scrolling grid that only keeps the rows in view in the DOM.
 *
 * However many emoji there are, only ~100–150 tiles exist at any time, so
 * opening is instant and scrolling never has to lay out or paint the rest.
 * Rows are absolutely positioned inside a spacer as tall as the whole grid.
 */
export class VirtualGrid {
	readonly scrollEl: HTMLElement;
	private readonly canvasEl: HTMLElement;
	private layout: GridLayout | null = null;
	/** Rendered rows by row index. */
	private readonly rendered = new Map<number, HTMLElement>();

	constructor(
		parentEl: HTMLElement,
		private readonly renderTile: TileRenderer,
		private readonly onScroll: () => void,
	) {
		this.scrollEl = parentEl.createDiv({ cls: "notemoji-picker-body" });
		this.canvasEl = this.scrollEl.createDiv({ cls: "notemoji-picker-canvas" });
		// Scroll events arrive once per frame; rendering right away (rather than
		// in the next frame) means newly revealed rows are there when it paints.
		this.scrollEl.addEventListener("scroll", () => this.update(), { passive: true });
	}

	/** Width of the vertical scrollbar (0 for overlay scrollbars). */
	get scrollbarWidth(): number {
		return Math.max(0, this.scrollEl.offsetWidth - this.scrollEl.clientWidth);
	}

	get viewportHeight(): number {
		return this.scrollEl.clientHeight || FALLBACK_VIEWPORT_PX;
	}

	/** Shows a new layout from the top (or keeps the position with `keepScroll`). */
	setLayout(layout: GridLayout, keepScroll = false): void {
		this.layout = layout;
		this.clear();
		this.canvasEl.setCssProps({ "--notemoji-grid-height": `${layout.height}px` });
		if (!keepScroll) this.scrollEl.scrollTop = 0;
		this.update();
	}

	/** Renders the rows that are (nearly) visible and drops the others. */
	update(): void {
		const layout = this.layout;
		if (!layout) return;
		const top = this.scrollEl.scrollTop;
		const height = this.viewportHeight;
		const overscan = Math.max(MIN_OVERSCAN_PX, height);
		const [first, last] = layout.rowsBetween(
			Math.max(0, top - overscan),
			top + height + overscan,
		);

		for (const [index, rowEl] of this.rendered) {
			if (index >= first && index <= last) continue;
			rowEl.remove();
			this.rendered.delete(index);
		}
		for (let index = first; index <= last; index++) {
			if (!this.rendered.has(index))
				this.rendered.set(index, this.renderRow(layout.rows[index], layout));
		}
		this.onScroll();
	}

	/** The rendered element of an item, if its row is in the DOM. */
	tileElement(index: number): HTMLElement | null {
		const rowEl = this.rendered.get(this.layout?.rowIndexOfItem(index) ?? -1);
		return rowEl?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null;
	}

	/** Re-renders every rendered tile (e.g. after the active or current item changed). */
	refreshTiles(): void {
		const layout = this.layout;
		if (!layout) return;
		for (const rowEl of this.rendered.values()) {
			for (const tileEl of Array.from(rowEl.children) as HTMLElement[]) {
				const index = Number(tileEl.dataset.index);
				const item = layout.items[index];
				if (item) this.renderTile(tileEl, item, index);
			}
		}
	}

	/** Scrolls just enough to show an item's row. */
	revealItem(index: number): void {
		const row = this.layout?.rowOfItem(index);
		if (!row) return;
		const top = this.scrollEl.scrollTop;
		const header = this.layout?.metrics.headerHeight ?? 0;
		if (row.top - header < top) this.scrollTo(Math.max(0, row.top - header));
		else if (row.top + row.height > top + this.viewportHeight) {
			this.scrollTo(row.top + row.height - this.viewportHeight);
		}
	}

	scrollTo(offset: number): void {
		this.scrollEl.scrollTop = offset;
		this.update();
	}

	dispose(): void {
		this.clear();
	}

	private clear(): void {
		for (const rowEl of this.rendered.values()) rowEl.remove();
		this.rendered.clear();
	}

	private renderRow(row: GridRow, layout: GridLayout): HTMLElement {
		const rowEl = this.canvasEl.createDiv({
			cls: row.kind === "header" ? "notemoji-picker-section-title" : "notemoji-picker-row",
		});
		rowEl.setCssProps({
			"--notemoji-row-top": `${row.top}px`,
			"--notemoji-row-height": `${row.height}px`,
			"--notemoji-columns": String(layout.metrics.columns),
		});
		if (row.kind === "header") {
			rowEl.setText(layout.sections[row.section].label);
			return rowEl;
		}
		for (let index = row.first; index < row.first + row.count; index++) {
			const tileEl = rowEl.createDiv();
			this.renderTile(tileEl, layout.items[index], index);
		}
		return rowEl;
	}
}
