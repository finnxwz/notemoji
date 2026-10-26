/**
 * Geometry of the picker grid, as plain math (no DOM), so the virtual grid
 * can render only what is on screen and keyboard navigation is testable.
 *
 * The grid is a list of rows: a header row per labelled section, followed by
 * that section's tiles, `columns` per row. Items are numbered across all
 * sections ("flat index").
 */

export type GridItemKind = "emoji" | "custom" | "lucide" | "upload";

export interface GridItem {
	kind: GridItemKind;
	/** What gets stored: an emoji, `custom:<name>` or `lucide:<name>`; "" for the upload tile. */
	value: string;
	/** Shown in the footer, e.g. "rocket". */
	name: string;
}

export interface GridSection {
	id: string;
	/** Header text; an empty label means no header row. */
	label: string;
	items: GridItem[];
}

export interface GridMetrics {
	columns: number;
	/** Height of a tile row (tiles are square: width = row height). */
	rowHeight: number;
	headerHeight: number;
	/** Space after each section. */
	sectionGap: number;
}

export interface GridRow {
	kind: "header" | "tiles";
	top: number;
	height: number;
	/** Index into `sections`. */
	section: number;
	/** Flat index of the first item in this row (tile rows only). */
	first: number;
	/** Number of items in this row (tile rows only). */
	count: number;
}

export class GridLayout {
	readonly rows: GridRow[] = [];
	readonly items: GridItem[] = [];
	readonly height: number;
	/** Row index of each item, by flat index. */
	private readonly itemRow: number[] = [];
	/** Top offset of each section (its header, or its first row). */
	private readonly sectionTops: number[] = [];

	constructor(
		readonly sections: readonly GridSection[],
		readonly metrics: GridMetrics,
	) {
		const columns = Math.max(1, metrics.columns);
		let top = 0;
		sections.forEach((section, sectionIndex) => {
			this.sectionTops.push(top);
			if (section.label !== "") {
				this.rows.push({
					kind: "header",
					top,
					height: metrics.headerHeight,
					section: sectionIndex,
					first: -1,
					count: 0,
				});
				top += metrics.headerHeight;
			}
			for (let start = 0; start < section.items.length; start += columns) {
				const count = Math.min(columns, section.items.length - start);
				const first = this.items.length;
				this.rows.push({
					kind: "tiles",
					top,
					height: metrics.rowHeight,
					section: sectionIndex,
					first,
					count,
				});
				for (let i = 0; i < count; i++) {
					this.items.push(section.items[start + i]);
					this.itemRow.push(this.rows.length - 1);
				}
				top += metrics.rowHeight;
			}
			top += metrics.sectionGap;
		});
		this.height = top;
	}

	/** Rows overlapping the range [top, bottom), as [first, last] row indexes (inclusive). */
	rowsBetween(top: number, bottom: number): [number, number] {
		if (this.rows.length === 0) return [0, -1];
		return [this.rowAt(top), this.rowAt(Math.max(top, bottom - 1))];
	}

	/** Index of the row at a vertical offset (the last one starting at or before it). */
	rowAt(offset: number): number {
		let low = 0;
		let high = this.rows.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (this.rows[middle].top <= offset) low = middle;
			else high = middle - 1;
		}
		return low;
	}

	rowIndexOfItem(index: number): number {
		return this.itemRow[index] ?? -1;
	}

	rowOfItem(index: number): GridRow | undefined {
		return this.rows[this.rowIndexOfItem(index)];
	}

	sectionTop(id: string): number | undefined {
		const index = this.sections.findIndex((section) => section.id === id);
		return index === -1 ? undefined : this.sectionTops[index];
	}

	/** The section shown at a scroll position (the one whose area contains it). */
	sectionAt(offset: number): GridSection | undefined {
		let current: number | undefined;
		this.sectionTops.forEach((top, index) => {
			if (top <= offset + 1) current = index;
		});
		return current === undefined ? undefined : this.sections[current];
	}

	/**
	 * The item reached from `index` with an arrow key. Up and down keep the
	 * column (or go to the last item of a shorter row) and cross sections.
	 */
	move(index: number, direction: "left" | "right" | "up" | "down"): number {
		const last = this.items.length - 1;
		if (last < 0) return -1;
		if (index < 0) return direction === "up" || direction === "left" ? last : 0;
		if (direction === "left") return Math.max(0, index - 1);
		if (direction === "right") return Math.min(last, index + 1);

		const rowIndex = this.itemRow[index];
		const column = index - this.rows[rowIndex].first;
		const step = direction === "down" ? 1 : -1;
		for (let next = rowIndex + step; next >= 0 && next < this.rows.length; next += step) {
			const row = this.rows[next];
			if (row.kind === "tiles") return row.first + Math.min(column, row.count - 1);
		}
		return index;
	}
}
