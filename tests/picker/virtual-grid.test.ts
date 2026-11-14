import "../obsidian";
import { afterEach, describe, expect, it } from "vitest";
import { GridItem, GridLayout } from "../../src/picker/grid-layout";
import { VirtualGrid } from "../../src/picker/virtual-grid";

const items = (count: number): GridItem[] =>
	Array.from({ length: count }, (_, i) => ({ kind: "emoji", value: String(i), name: "" }));

/** 2,000 items in rows of 10 at 40 px: 200 rows, 8,000 px tall. */
const layout = new GridLayout([{ id: "all", label: "", items: items(2000) }], {
	columns: 10,
	rowHeight: 40,
	headerHeight: 28,
	sectionGap: 0,
});

let parent: HTMLElement;
let grid: VirtualGrid;
let scrolled = 0;

function setup() {
	parent = document.body.createDiv();
	grid = new VirtualGrid(
		parent,
		(tileEl, item, index) => {
			tileEl.className = "tile";
			tileEl.dataset.index = String(index);
			tileEl.setText(item.value);
		},
		() => (scrolled += 1),
	);
	grid.setLayout(layout);
}

const tiles = () => Array.from(parent.querySelectorAll<HTMLElement>(".tile"));

afterEach(() => {
	grid.dispose();
	parent.remove();
});

describe("VirtualGrid", () => {
	it("renders only the rows near the visible area", () => {
		setup();
		// 320 px viewport + one viewport of overscan below → 16 rows of 10.
		expect(tiles()).toHaveLength(160);
		expect(tiles()[0].textContent).toBe("0");
		expect(
			grid.scrollEl
				.querySelector<HTMLElement>(".notemoji-picker-canvas")!
				.style.getPropertyValue("--notemoji-grid-height"),
		).toBe("8000px");
	});

	it("swaps rows while scrolling", () => {
		setup();
		grid.scrollTo(4000);
		const values = tiles().map((el) => Number(el.textContent));
		expect(Math.min(...values)).toBe(920);
		expect(Math.max(...values)).toBeLessThan(1200);
		// One viewport plus one above and one below: 24 rows of 10.
		expect(tiles().length).toBeLessThanOrEqual(240);
		expect(scrolled).toBeGreaterThan(0);
	});

	it("reveals an item and finds its tile", () => {
		setup();
		expect(grid.tileElement(1500)).toBeNull();
		grid.revealItem(1500);
		expect(grid.tileElement(1500)?.textContent).toBe("1500");
		expect(grid.scrollEl.scrollTop).toBeGreaterThan(5000);
	});

	it("starts from the top for a new layout and can keep the position", () => {
		setup();
		grid.scrollTo(4000);
		grid.setLayout(layout, true);
		expect(grid.scrollEl.scrollTop).toBe(4000);
		grid.setLayout(layout);
		expect(grid.scrollEl.scrollTop).toBe(0);
	});

	it("removes every row on dispose", () => {
		setup();
		grid.dispose();
		expect(tiles()).toHaveLength(0);
	});
});
