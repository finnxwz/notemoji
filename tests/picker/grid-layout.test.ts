import { describe, expect, it } from "vitest";
import { GridItem, GridLayout, GridSection } from "../../src/picker/grid-layout";

const items = (count: number, prefix: string): GridItem[] =>
	Array.from({ length: count }, (_, i) => ({ kind: "emoji", value: `${prefix}${i}`, name: "" }));

const metrics = { columns: 4, rowHeight: 40, headerHeight: 28, sectionGap: 8 };

// Section a: header + 2 rows (4 + 2 items); section b: no header, 1 row (3 items).
const sections: GridSection[] = [
	{ id: "a", label: "A", items: items(6, "a") },
	{ id: "b", label: "", items: items(3, "b") },
	{ id: "c", label: "C", items: items(5, "c") },
];
const layout = new GridLayout(sections, metrics);

describe("GridLayout", () => {
	it("lays out header and tile rows with their offsets", () => {
		expect(layout.rows.map((row) => [row.kind, row.top, row.first, row.count])).toEqual([
			["header", 0, -1, 0],
			["tiles", 28, 0, 4],
			["tiles", 68, 4, 2],
			["tiles", 116, 6, 3],
			["header", 164, -1, 0],
			["tiles", 192, 9, 4],
			["tiles", 232, 13, 1],
		]);
		expect(layout.items).toHaveLength(14);
		expect(layout.height).toBe(280);
	});

	it("finds rows by offset and range", () => {
		expect(layout.rowAt(0)).toBe(0);
		expect(layout.rowAt(30)).toBe(1);
		expect(layout.rowAt(115)).toBe(2);
		expect(layout.rowAt(10_000)).toBe(6);
		expect(layout.rowsBetween(60, 170)).toEqual([1, 4]);
	});

	it("knows where sections start and which one is shown", () => {
		expect(layout.sectionTop("b")).toBe(116);
		expect(layout.sectionTop("missing")).toBeUndefined();
		expect(layout.sectionAt(0)?.id).toBe("a");
		expect(layout.sectionAt(120)?.id).toBe("b");
		expect(layout.sectionAt(200)?.id).toBe("c");
		expect(layout.rowOfItem(10)?.top).toBe(192);
	});

	it("moves left and right through all items", () => {
		expect(layout.move(-1, "right")).toBe(0);
		expect(layout.move(-1, "left")).toBe(13);
		expect(layout.move(3, "right")).toBe(4);
		expect(layout.move(0, "left")).toBe(0);
		expect(layout.move(13, "right")).toBe(13);
	});

	it("moves up and down by row, keeping the column and crossing sections", () => {
		expect(layout.move(1, "down")).toBe(5);
		expect(layout.move(3, "down")).toBe(5); // shorter row: its last item
		expect(layout.move(5, "down")).toBe(7);
		expect(layout.move(7, "down")).toBe(10); // across the header of c
		expect(layout.move(12, "down")).toBe(13);
		expect(layout.move(13, "down")).toBe(13);
		expect(layout.move(10, "up")).toBe(7);
		expect(layout.move(1, "up")).toBe(1);
	});

	it("handles empty grids", () => {
		const empty = new GridLayout([], metrics);
		expect(empty.height).toBe(0);
		expect(empty.rowsBetween(0, 100)).toEqual([0, -1]);
		expect(empty.move(-1, "down")).toBe(-1);
	});
});
