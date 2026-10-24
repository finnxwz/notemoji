import { describe, expect, it } from "vitest";
import {
	DATA_VERSION,
	DEFAULT_SETTINGS,
	ICONS_MARKER,
	MAX_RECENT,
	mergeChanges,
	parseData,
	pushRecent,
	repairAfterOldVersion,
	serializeData,
} from "../src/data";

describe("parseData", () => {
	it("falls back to defaults for missing or malformed data", () => {
		for (const raw of [null, undefined, "garbage", 42, [], {}, { icons: 7, settings: "x" }]) {
			const data = parseData(raw);
			expect(data.settings).toEqual(DEFAULT_SETTINGS);
			expect(data.icons.size).toBe(0);
			expect(data.recent).toEqual([]);
			expect(data.customIcons.size).toBe(0);
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
			showInViewHeader: false,
			emojiStyle: "system",
			emojiFont: "",
		});
		expect(parseData({ settings: { noteTitle: "huge" } }).settings.noteTitle).toBe("off");
	});

	it("reads the emoji style and font, ignoring invalid values", () => {
		expect(parseData({ settings: { emojiStyle: "twemoji" } }).settings.emojiStyle).toBe(
			"twemoji",
		);
		expect(parseData({ settings: { emojiStyle: "apple" } }).settings.emojiStyle).toBe("system");
		// Saved before styles existed: an own font file means the "file" style.
		const legacy = parseData({ settings: { emojiFont: "Twemoji.ttf" } }).settings;
		expect([legacy.emojiStyle, legacy.emojiFont]).toEqual(["file", "Twemoji.ttf"]);
		expect(parseData({ settings: { emojiFont: "../x.ttf" } }).settings.emojiFont).toBe("");
		expect(parseData({ settings: { emojiFont: 3 } }).settings.emojiFont).toBe("");
	});

	it("cleans the recent list", () => {
		expect(parseData({ recent: ["🚀", "nope", "🚀", 3, "🎉"] }).recent).toEqual(["🚀", "🎉"]);
	});

	it("round-trips", () => {
		const original = parseData({
			settings: { noteTitle: "off", showInTabs: true, showInViewHeader: false },
			icons: { Folder: "📁", "A.md": "custom:logo" },
			recent: ["🎉", "custom:logo"],
			customIcons: { logo: { type: "image/webp", data: "UklGRg==" } },
		});
		const saved = serializeData(original);
		expect(saved.version).toBe(DATA_VERSION);
		expect(parseData(saved)).toEqual(original);
		expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
	});

	it("keeps the custom icons, the large part, at the end of the file", () => {
		const saved = serializeData(
			parseData({ customIcons: { a: { type: "image/png", data: "AAAA" } } }),
		);
		expect(Object.keys(saved).at(-1)).toBe("customIcons");
	});

	it("keeps icons named like object properties", () => {
		const raw = JSON.parse(
			'{"customIcons":{"__proto__":{"type":"image/png","data":"AAAA"}}}',
		) as unknown;
		const data = parseData(raw);
		expect([...data.customIcons.keys()]).toEqual(["__proto__"]);
		const saved = JSON.parse(JSON.stringify(serializeData(data))) as { customIcons: object };
		expect(Object.keys(saved.customIcons)).toEqual(["__proto__"]);
	});
});

describe("compatibility with other versions", () => {
	it("tells which version wrote the data", () => {
		expect(parseData(null).source).toBe("none");
		expect(parseData({}).source).toBe("none");
		expect(parseData({ version: 1, icons: { A: "🚀" } }).source).toBe("old");
		expect(parseData({ "A.md": "🚀" }).source).toBe("old");
		expect(parseData({ version: 2, icons: { [ICONS_MARKER]: "" } }).source).toBe("current");
		// Obsidian Sync merged a 2.x file with the emoji of a 1.x copy (no marker).
		expect(parseData({ version: 2, icons: { A: "🚀" }, customIcons: {} }).source).toBe("old");
		expect(parseData({ settings: {}, icons: {} }).source).toBe("current");
		expect(parseData({ version: 3, icons: {} }).source).toBe("newer");
	});

	it("keeps what a newer version added when saving", () => {
		const raw = {
			version: 2,
			settings: { noteTitle: "inline", emojiStyle: "fluent", iconSize: "large" },
			icons: { "A.md": "lucide:rocket", "B.md": "🚀" },
			recent: ["lucide:rocket", "🚀"],
			customIcons: {
				logo: { type: "image/png", data: "AAAA" },
				photo: { type: "image/avif", data: "AAAA", width: 512 },
			},
			bookmarks: { "C.md": "⭐" },
		};
		const data = parseData(raw);
		// Used here as far as this version understands it…
		expect(data.settings.emojiStyle).toBe("system");
		expect(data.icons.get("B.md")).toBe("🚀");
		expect([...data.customIcons.keys()]).toEqual(["logo"]);
		// …and saved without losing anything.
		expect(JSON.parse(JSON.stringify(serializeData(data)))).toMatchObject(raw);
	});

	it("saves a setting changed here over the value kept for a newer version", () => {
		const data = parseData({ version: 2, settings: { emojiStyle: "fluent" } });
		data.settings.emojiStyle = "twemoji";
		delete data.unknown.settings.emojiStyle;
		expect(serializeData(data).settings.emojiStyle).toBe("twemoji");
	});

	it("repairs data saved over by Notemoji 1.x", () => {
		const known = parseData({
			version: 2,
			settings: { noteTitle: "above" },
			icons: { "A.md": "🚀", "B.md": "custom:logo", "C.md": "📁" },
			recent: ["custom:logo", "🚀"],
			customIcons: { logo: { type: "image/png", data: "AAAA" } },
			future: true,
		});
		// 1.x kept only the emoji it understands, changed one and added one.
		const old = { version: 1, icons: { "A.md": "🎉", "D.md": "🌱" } };
		const repaired = repairAfterOldVersion(old, known);
		expect(repaired.source).toBe("current");
		expect(repaired.icons.toRecord()).toEqual({
			"A.md": "🎉",
			"B.md": "custom:logo",
			"C.md": "📁",
			"D.md": "🌱",
		});
		expect(repaired.settings.noteTitle).toBe("above");
		expect(repaired.recent).toEqual(["custom:logo", "🚀"]);
		expect([...repaired.customIcons.keys()]).toEqual(["logo"]);
		expect(serializeData(repaired).future).toBe(true);
		// The data it was repaired from is left alone.
		expect(known.icons.get("A.md")).toBe("🚀");
	});

	it("doesn't let an outdated 1.x copy replace custom icons, and matches its trimmed paths", () => {
		const known = parseData({
			version: 2,
			icons: { [ICONS_MARKER]: "", X: "custom:logo", " Spaced.md": "📁" },
		});
		const old = { version: 1, icons: { X: "🚀", "Spaced.md": "🌵" } };
		const repaired = repairAfterOldVersion(old, known);
		expect(repaired.icons.toRecord()).toEqual({ X: "custom:logo", " Spaced.md": "🌵" });
	});

	it("uses newer sections that Obsidian Sync merged into a 1.x file", () => {
		const known = parseData({
			version: 2,
			settings: { noteTitle: "above" },
			icons: { [ICONS_MARKER]: "", A: "custom:logo" },
			customIcons: { logo: { type: "image/png", data: "AAAA" } },
		});
		// Settings and icons of another 2.x device, emoji of a 1.x copy.
		const merged = {
			version: 2,
			settings: { noteTitle: "inline" },
			icons: { B: "🌱" },
			customIcons: {
				logo: { type: "image/png", data: "AAAA" },
				logo2: { type: "image/png", data: "BBBB" },
			},
			extra: 1,
		};
		const repaired = repairAfterOldVersion(merged, known);
		expect(repaired.settings.noteTitle).toBe("inline");
		expect([...repaired.customIcons.keys()]).toEqual(["logo", "logo2"]);
		expect(repaired.icons.toRecord()).toEqual({ A: "custom:logo", B: "🌱" });
		expect(serializeData(repaired).extra).toBe(1);
	});

	it("keeps entries named like object properties in every kept section", () => {
		const raw = JSON.parse(
			'{"version":2,"icons":{},"__proto__":1,"settings":{"__proto__":2},"customIcons":{"__proto__":{"type":"x"}}}',
		) as unknown;
		const saved = JSON.parse(JSON.stringify(serializeData(parseData(raw)))) as Record<
			string,
			Record<string, unknown>
		>;
		expect(Object.keys(saved)).toContain("__proto__");
		expect(Object.keys(saved.settings)).toContain("__proto__");
		expect(Object.keys(saved.customIcons)).toEqual(["__proto__"]);
	});

	it("combines changes made during a reload with the reloaded file", () => {
		const base = serializeData(
			parseData({ version: 2, settings: { showInTabs: true }, icons: { A: "🚀", B: "📁" } }),
		);
		// Here: B removed, C added, a setting changed.
		const local = serializeData(
			parseData({ version: 2, settings: { showInTabs: false }, icons: { A: "🚀", C: "🌱" } }),
		);
		// The file: A changed and D added on another device.
		const remote = serializeData(
			parseData({
				version: 2,
				settings: { noteTitle: "above" },
				icons: { A: "🎉", B: "📁", D: "🔄" },
			}),
		);
		const merged = parseData(mergeChanges(base, local, remote));
		expect(merged.source).toBe("current");
		expect(merged.icons.toRecord()).toEqual({ A: "🎉", C: "🌱", D: "🔄" });
		expect(merged.settings).toMatchObject({ showInTabs: false, noteTitle: "above" });
	});

	it("keeps paths exactly, also with spaces at the ends or named like object properties", () => {
		const raw = JSON.parse(
			'{"version":2,"icons":{" Leading.md":"🚀","Trailing ":"📁","__proto__":"🎉"}}',
		) as unknown;
		const data = parseData(raw);
		expect(data.icons.get(" Leading.md")).toBe("🚀");
		expect(data.icons.get("Trailing ")).toBe("📁");
		expect(data.icons.get("__proto__")).toBe("🎉");
		const saved = JSON.parse(JSON.stringify(serializeData(data))) as { icons: object };
		expect(Object.keys(saved.icons)).toEqual([
			ICONS_MARKER,
			" Leading.md",
			"Trailing ",
			"__proto__",
		]);
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
