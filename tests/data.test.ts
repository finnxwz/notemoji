import { describe, expect, it } from "vitest";
/** Copies of Obsidian icons as stored in data.json. */
const STAR =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7z"/></svg>';
const ARROW =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';

import {
	DATA_VERSION,
	DEFAULT_SETTINGS,
	ICONS_MARKER,
	libraryIconsInUse,
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
			expect(data.libraryIcons.size).toBe(0);
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
			settings: {
				noteTitle: "inline",
				showInTabs: false,
				showInViewHeader: "no",
				showInLinks: true,
			},
		});
		expect(data.settings).toEqual({
			noteTitle: "inline",
			showInTabs: false,
			showInViewHeader: false,
			showInLinks: true,
			emojiStyle: "system",
			emojiFont: "",
			autoEmoji: false,
		});
		expect(parseData({ settings: { noteTitle: "huge" } }).settings.noteTitle).toBe("inline");
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

	it("reads automatic emoji for new notes, off unless turned on", () => {
		expect(parseData({ settings: { autoEmoji: true } }).settings.autoEmoji).toBe(true);
		expect(parseData({ settings: { autoEmoji: "yes" } }).settings.autoEmoji).toBe(false);
		expect(parseData({ version: 1, icons: {} }).settings.autoEmoji).toBe(false);
	});

	it("cleans the recent list", () => {
		expect(parseData({ recent: ["🚀", "nope", "🚀", 3, "🎉"] }).recent).toEqual(["🚀", "🎉"]);
	});

	it("round-trips", () => {
		const original = parseData({
			settings: { noteTitle: "off", showInTabs: true, showInViewHeader: false },
			icons: { Folder: "📁", "A.md": "custom:logo", "B.md": "lucide:star" },
			recent: ["🎉", "custom:logo", "lucide:star"],
			libraryIcons: { "lucide:star": STAR },
			customIcons: { logo: { type: "image/webp", data: "UklGRg==" } },
		});
		const saved = serializeData(original);
		expect(saved.version).toBe(DATA_VERSION);
		expect(parseData(saved)).toEqual(original);
		expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
	});

	it("keeps the icons, the large part, at the end of the file", () => {
		const saved = serializeData(
			parseData({
				customIcons: { a: { type: "image/png", data: "AAAA" } },
				libraryIcons: { "lucide:star": STAR },
			}),
		);
		expect(Object.keys(saved).slice(-2)).toEqual(["libraryIcons", "customIcons"]);
	});

	it("reads copies of Obsidian icons and keeps the ones it can't use", () => {
		const raw = {
			version: 2,
			icons: { [ICONS_MARKER]: "", "A.md": "lucide:star" },
			libraryIcons: {
				"lucide:star": STAR,
				"phosphor:star": "<svg/>",
				"lucide:arrow-right": { type: "image/svg+xml", data: "PHN2Zz4=" },
			},
		};
		const data = parseData(raw);
		expect(data.source).toBe("current");
		expect(Object.fromEntries(data.libraryIcons)).toEqual({ "lucide:star": STAR });
		expect(Object.keys(data.unknown.libraryIcons)).toEqual([
			"phosphor:star",
			"lucide:arrow-right",
		]);
		expect(JSON.parse(JSON.stringify(serializeData(data)))).toMatchObject(raw);
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
		expect(parseData({ libraryIcons: {} }).source).toBe("current");
		expect(parseData({ version: 3, icons: {} }).source).toBe("newer");
	});

	it("keeps what a newer version added when saving", () => {
		const raw = {
			version: 2,
			settings: { noteTitle: "inline", emojiStyle: "fluent", iconSize: "large" },
			icons: { "A.md": "phosphor:rocket", "B.md": "🚀" },
			recent: ["phosphor:rocket", "🚀"],
			customIcons: {
				logo: { type: "image/png", data: "AAAA", name: "Company logo" },
				photo: { type: "image/avif", data: "AAAA", width: 512 },
				"lucide:star": { type: "image/svg+xml", data: "AAAA" },
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

	it("puts back the Obsidian icons and their copies that 1.x dropped", () => {
		const known = parseData({
			version: 2,
			icons: { [ICONS_MARKER]: "", "A.md": "lucide:star", "B.md": "🚀" },
			recent: ["lucide:star"],
			libraryIcons: { "lucide:star": STAR, "phosphor:star": "<svg/>" },
		});
		const old = { version: 1, icons: { "A.md": "🎉", "B.md": "🌱" } };
		const repaired = repairAfterOldVersion(old, known);
		// An outdated 1.x copy can't replace an Obsidian icon either.
		expect(repaired.icons.toRecord()).toEqual({ "A.md": "lucide:star", "B.md": "🌱" });
		expect(Object.fromEntries(repaired.libraryIcons)).toEqual({ "lucide:star": STAR });
		expect(serializeData(repaired).libraryIcons).toEqual({
			"phosphor:star": "<svg/>",
			"lucide:star": STAR,
		});

		// Copies that Obsidian Sync merged in from a 2.x copy are used.
		const merged = { ...old, libraryIcons: { "lucide:star": ARROW } };
		const fromFile = repairAfterOldVersion(merged, known);
		expect(Object.fromEntries(fromFile.libraryIcons)).toEqual({ "lucide:star": ARROW });
		expect(fromFile.unknown.libraryIcons).toEqual({});
	});

	it("never drops a copy of an Obsidian icon when Obsidian Sync merged in an older section", () => {
		const known = parseData({
			version: 2,
			icons: { [ICONS_MARKER]: "", "A.md": "lucide:rocket", "B.md": "lucide:star" },
			libraryIcons: { "lucide:rocket": ARROW, "lucide:star": STAR },
		});
		// The copies of an older 2.x file, without rocket, which this device may not be able to
		// draw again.
		const raw = { version: 1, icons: { "C.md": "🌱" }, libraryIcons: { "lucide:star": ARROW } };
		const repaired = repairAfterOldVersion(raw, known);
		expect(repaired.icons.get("A.md")).toBe("lucide:rocket");
		// The file's copies are never replaced; those it lacks are put back.
		expect(serializeData(repaired).libraryIcons).toEqual({
			"lucide:rocket": ARROW,
			"lucide:star": ARROW,
		});
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
			'{"version":2,"icons":{},"__proto__":1,"settings":{"__proto__":2},"customIcons":{"__proto__":{"type":"x"}},"libraryIcons":{"__proto__":"<svg/>"}}',
		) as unknown;
		const saved = JSON.parse(JSON.stringify(serializeData(parseData(raw)))) as Record<
			string,
			Record<string, unknown>
		>;
		expect(Object.keys(saved)).toContain("__proto__");
		expect(Object.keys(saved.settings)).toContain("__proto__");
		expect(Object.keys(saved.customIcons)).toEqual(["__proto__"]);
		expect(Object.keys(saved.libraryIcons)).toEqual(["__proto__"]);
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

	it("keeps custom icons of the same name from two devices apart", () => {
		const png = (data: string) => ({ type: "image/png", data });
		const stored = (raw: object) => serializeData(parseData({ version: 2, ...raw }));
		const base = stored({
			icons: { "A.md": "custom:logo" },
			customIcons: { logo: png("AAAA") },
		});
		// Here: logo replaced by another image, photo uploaded, both used and recently used.
		const local = stored({
			icons: { "A.md": "custom:logo", "B.md": "custom:photo", "C.md": "custom:logo" },
			recent: ["custom:photo", "custom:logo"],
			customIcons: { logo: png("BBBB"), photo: png("CCCC") },
		});
		// The file: another device did the same with its own images, and has a photo-2.
		const remote = stored({
			icons: { "A.md": "custom:logo", "D.md": "custom:photo" },
			recent: ["custom:photo"],
			customIcons: { logo: png("DDDD"), photo: png("EEEE"), "photo-2": png("FFFF") },
		});
		const merged = parseData(mergeChanges(base, local, remote));
		// The file's keep their names, those from here get new ones.
		expect(Object.fromEntries(merged.customIcons)).toEqual({
			logo: png("DDDD"),
			photo: png("EEEE"),
			"photo-2": png("FFFF"),
			"logo-2": png("BBBB"),
			"photo-3": png("CCCC"),
		});
		// What was set here shows this device's icons; the rest the file's.
		expect(merged.icons.toRecord()).toEqual({
			"A.md": "custom:logo",
			"B.md": "custom:photo-3",
			"C.md": "custom:logo-2",
			"D.md": "custom:photo",
		});
		expect(merged.recent).toEqual(["custom:photo-3", "custom:logo-2"]);

		// The same image on both sides, or a change on one side only, is one icon.
		const same = stored({
			icons: { "A.md": "custom:logo", "B.md": "custom:photo" },
			customIcons: { logo: png("AAAA"), photo: png("CCCC") },
		});
		const theirs = stored({ customIcons: { logo: png("DDDD"), photo: png("CCCC") } });
		const combined = parseData(mergeChanges(base, same, theirs));
		expect(Object.fromEntries(combined.customIcons)).toEqual({
			logo: png("DDDD"),
			photo: png("CCCC"),
		});
		expect(combined.icons.get("B.md")).toBe("custom:photo");
	});

	it("combines copies of Obsidian icons without ever dropping or replacing the file's", () => {
		const stored = (icons: Record<string, string>, libraryIcons: Record<string, string>) =>
			serializeData(parseData({ version: 2, icons, libraryIcons }));
		const base = stored(
			{ "A.md": "lucide:star", "B.md": "lucide:x" },
			{ "lucide:star": STAR, "lucide:x": STAR },
		);
		// Here: x is no longer used (its copy left out), arrow-right added, star drawn differently.
		const local = stored(
			{ "A.md": "lucide:star", "C.md": "lucide:arrow-right" },
			{ "lucide:star": ARROW, "lucide:arrow-right": ARROW },
		);
		// The file: another device uses x again and added shapes.
		const remote = stored(
			{ "A.md": "lucide:star", "B.md": "lucide:x", "D.md": "lucide:shapes" },
			{ "lucide:star": STAR, "lucide:x": STAR, "lucide:shapes": ARROW },
		);
		const merged = parseData(mergeChanges(base, local, remote));
		expect(Object.fromEntries(merged.libraryIcons)).toEqual({
			"lucide:star": STAR,
			"lucide:x": STAR,
			"lucide:shapes": ARROW,
			"lucide:arrow-right": ARROW,
		});
	});

	it("doesn't bring back copies of other icon sources that a newer version dropped", () => {
		const stored = (libraryIcons: Record<string, string>, icons: Record<string, string> = {}) =>
			serializeData(parseData({ version: 2, icons, libraryIcons }));
		const base = stored({ "phosphor:star": "<svg/>", "phosphor:x": "<svg/>" });
		// Here: an unsaved change.
		const local = stored(
			{ "phosphor:star": "<svg/>", "phosphor:x": "<svg/>" },
			{ "A.md": "🚀" },
		);
		// The file: a newer version dropped star, which it no longer uses, and added house.
		const remote = stored({ "phosphor:x": "<svg/>", "phosphor:house": "<svg/>" });
		const merged = serializeData(parseData(mergeChanges(base, local, remote)));
		expect(merged.libraryIcons).toEqual({ "phosphor:x": "<svg/>", "phosphor:house": "<svg/>" });
		expect(merged.icons).toMatchObject({ "A.md": "🚀" });
	});

	it("saves only the copies of Obsidian icons in use", () => {
		const data = parseData({
			version: 2,
			icons: { "A.md": "lucide:star" },
			recent: ["lucide:x"],
			libraryIcons: { "lucide:star": STAR, "lucide:x": STAR, "lucide:unused": ARROW },
		});
		expect(serializeData(data).libraryIcons).toEqual({
			"lucide:star": STAR,
			"lucide:x": STAR,
		});
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

describe("libraryIconsInUse", () => {
	it("finds the Obsidian icons of items and of the recent list", () => {
		const data = parseData({
			icons: {
				"A.md": "lucide:star",
				"B.md": "🚀",
				"C.md": "custom:logo",
				"D.md": "lucide:star",
			},
			recent: ["lucide:arrow-right", "🎉", "phosphor:star"],
			libraryIcons: { "lucide:shapes": STAR },
		});
		expect([...libraryIconsInUse(data)].sort()).toEqual(["lucide:arrow-right", "lucide:star"]);
	});

	it("also those a newer version uses in places this version doesn't know", () => {
		const data = parseData({
			version: 2,
			settings: { folderIcon: "lucide:folder", iconSize: 2 },
			icons: {},
			bookmarks: { "C.md": ["lucide:bookmark", { nested: { deeper: "lucide:house" } }] },
			links: "lucide:Bad Name",
			// A custom icon in a form this version can't read, made from an Obsidian icon.
			customIcons: { badge: { icon: "lucide:badge", colour: "#e33" } },
		});
		expect([...libraryIconsInUse(data)].sort()).toEqual([
			"lucide:badge",
			"lucide:bookmark",
			"lucide:folder",
			"lucide:house",
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
