import { describe, expect, it } from "vitest";
import {
	DATA_VERSION,
	DEFAULT_SETTINGS,
	MAX_RECENT,
	parseData,
	pushRecent,
	serializeData,
} from "../../src/icons/data";

describe("parseData", () => {
	it("falls back to defaults for missing or malformed data", () => {
		for (const raw of [null, undefined, "garbage", 42, [], {}, { icons: 7, settings: "x" }]) {
			const data = parseData(raw);
			expect(data.settings).toEqual(DEFAULT_SETTINGS);
			expect(data.icons.size).toBe(0);
			expect(data.recent).toEqual([]);
		}
	});

	it("reads version 1 files", () => {
		const data = parseData({ version: 1, icons: { Folder: "📁", "A.md": "🚀" } });
		expect(data.icons.toRecord()).toEqual({ Folder: "📁", "A.md": "🚀" });
		expect(data.settings).toEqual(DEFAULT_SETTINGS);
	});

	it("reads the early plain path map", () => {
		expect(parseData({ "A.md": "🚀" }).icons.get("A.md")).toBe("🚀");
	});

	it("reads settings and ignores invalid values", () => {
		const data = parseData({
			version: 2,
			settings: { noteTitle: "inline", showInTabs: false, showInViewHeader: "no" },
		});
		expect(data.settings).toEqual({
			noteTitle: "inline",
			showInTabs: false,
			showInViewHeader: true,
		});
		expect(parseData({ settings: { noteTitle: "huge" } }).settings.noteTitle).toBe("off");
	});

	it("cleans the recent list", () => {
		expect(parseData({ recent: ["🚀", "nope", "🚀", 3, "🎉"] }).recent).toEqual(["🚀", "🎉"]);
	});

	it("round-trips", () => {
		const original = parseData({
			settings: { noteTitle: "off", showInTabs: true, showInViewHeader: false },
			icons: { Folder: "📁" },
			recent: ["🎉"],
		});
		const saved = serializeData(original);
		expect(saved.version).toBe(DATA_VERSION);
		expect(parseData(saved)).toEqual(original);
	});
});

describe("pushRecent", () => {
	it("moves the emoji to the front without duplicates", () => {
		expect(pushRecent(["🎉", "🚀", "📁"], "🚀")).toEqual(["🚀", "🎉", "📁"]);
	});

	it(`keeps at most ${MAX_RECENT}`, () => {
		const full = Array.from({ length: MAX_RECENT }, (_, i) =>
			String.fromCodePoint(0x1f600 + i),
		);
		const next = pushRecent(full, "🚀");
		expect(next).toHaveLength(MAX_RECENT);
		expect(next[0]).toBe("🚀");
	});
});
