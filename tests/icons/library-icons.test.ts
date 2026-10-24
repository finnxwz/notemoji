import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isLibraryIconSvg,
	LibraryIcons,
	lucideLabel,
	lucideNames,
	MAX_LIBRARY_ICON_SIZE,
	readLibraryIcons,
	searchLucide,
	svgMarkup,
} from "../../src/icons/library-icons";
import { getIcon, getIconIds } from "../obsidian";

/** The stored copy of an icon of the fake Obsidian, as this device draws it. */
const drawn = (name: string) => svgMarkup(getIcon(`lucide-${name}`)!);
/** A copy made by another Obsidian version: same name, other drawing. */
const other = (name: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${name}</title></svg>`;

function setup(initial: Array<[string, string]> = [], reserved: string[] = []) {
	let copies = new Map(initial);
	const save = vi.fn();
	const icons = new LibraryIcons(
		() => copies,
		save,
		() => reserved,
		{ getIcon, getIconIds },
	);
	return {
		icons,
		save,
		copies: () => copies,
		/** Swaps in different data, like a reload of data.json after sync. */
		reload(next: Array<[string, string]>) {
			copies = new Map(next);
		},
	};
}

function spyUrls() {
	let next = 0;
	const created: Blob[] = [];
	const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		created.push(blob as Blob);
		return `blob:${++next}`;
	});
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	return { create, revoke, created };
}

afterEach(() => vi.restoreAllMocks());

describe("Obsidian's icon names", () => {
	it("are read from the registered ids, without other icons, sorted", () => {
		expect(
			lucideNames([
				"lucide-star",
				"notemoji-emoji",
				"lucide-arrow-right",
				"lucide-Bad_Name",
				"dice",
				"lucide-star",
			]),
		).toEqual(["arrow-right", "star"]);
	});

	it("are shown in plain words", () => {
		expect(lucideLabel("arrow-up-right")).toBe("arrow up right");
		expect(lucideLabel("dice-1")).toBe("dice 1");
	});

	it("are found by the start of their words, the closest match first", () => {
		const names = ["arrow-big-right", "arrow-right", "arrow-up-right", "star", "star-off"];
		expect(searchLucide(names, "arrow r")).toEqual([
			"arrow-right",
			"arrow-big-right",
			"arrow-up-right",
		]);
		expect(searchLucide(names, "ARROW-RIGHT")[0]).toBe("arrow-right");
		expect(searchLucide(names, "right up")).toEqual(["arrow-up-right"]);
		expect(searchLucide(names, "star")).toEqual(["star", "star-off"]);
		expect(searchLucide(names, "tar")).toEqual([]);
		expect(searchLucide(names, "  ")).toEqual([]);
		expect(searchLucide(names, "arrow", 2)).toHaveLength(2);
	});
});

describe("stored copies", () => {
	it("are SVG markup of a sensible size", () => {
		expect(isLibraryIconSvg(drawn("star"))).toBe(true);
		expect(isLibraryIconSvg("<svg/>")).toBe(true);
		for (const value of [
			"",
			"<svgx>",
			"<html><svg></svg></html>",
			" <svg></svg>",
			`<svg>${"x".repeat(MAX_LIBRARY_ICON_SIZE)}</svg>`,
			42,
			null,
			{ svg: "<svg/>" },
		]) {
			expect(isLibraryIconSvg(value), JSON.stringify(value)).toBe(false);
		}
	});

	it("keep Obsidian's drawing without its classes", () => {
		const markup = drawn("star");
		expect(markup).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
		expect(markup).toContain('viewBox="0 0 24 24"');
		expect(markup).toContain('stroke="currentColor"');
		expect(markup).toContain('stroke-width="2"');
		expect(markup).not.toContain("class=");
		expect(markup).toContain("<path");
	});

	it("are read leniently, keeping what can't be used as it is", () => {
		const unreadable: Record<string, unknown> = {};
		const copies = readLibraryIcons(
			{
				"lucide:star": drawn("star"),
				"lucide:arrow-right": drawn("arrow-right"),
				"phosphor:star": "<svg/>",
				"lucide:Bad Name": "<svg/>",
				"lucide:shapes": { type: "image/svg+xml", data: "PHN2Zz4=" },
				"lucide:huge": `<svg>${"x".repeat(MAX_LIBRARY_ICON_SIZE)}</svg>`,
				"lucide:script": "<script>alert(1)</script>",
			},
			unreadable,
		);
		expect([...copies.keys()]).toEqual(["lucide:star", "lucide:arrow-right"]);
		expect(Object.keys(unreadable)).toEqual([
			"phosphor:star",
			"lucide:Bad Name",
			"lucide:shapes",
			"lucide:huge",
			"lucide:script",
		]);
		expect(unreadable["lucide:shapes"]).toEqual({ type: "image/svg+xml", data: "PHN2Zz4=" });
		for (const raw of [null, "x", [], 3]) expect(readLibraryIcons(raw).size).toBe(0);
	});
});

describe("LibraryIcons", () => {
	it("lists the icons of this device's Obsidian", () => {
		const { icons } = setup();
		expect(icons.list()).toEqual([
			"arrow-left",
			"arrow-right",
			"arrow-up-right",
			"shapes",
			"star",
		]);
	});

	it("stores a copy of a picked icon, but never replaces one", () => {
		const { icons, save, copies } = setup([["lucide:star", other("star")]]);
		icons.keep("arrow-right");
		expect(copies().get("lucide:arrow-right")).toBe(drawn("arrow-right"));
		expect(save).toHaveBeenCalledTimes(1);
		// Made by another Obsidian version: stays as it is.
		icons.keep("star");
		expect(copies().get("lucide:star")).toBe(other("star"));
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("stores nothing for an icon this device doesn't have, or one kept for a newer version", () => {
		const { icons, save, copies } = setup([], ["lucide:shapes"]);
		icons.keep("rocket");
		icons.keep("shapes");
		expect(copies().size).toBe(0);
		expect(save).not.toHaveBeenCalled();
	});

	it("drops copies no longer in use and adds missing ones, saving only after a change", () => {
		const { icons, save, copies } = setup([
			["lucide:star", other("star")],
			["lucide:shapes", drawn("shapes")],
		]);
		icons.update(new Set(["lucide:star", "lucide:arrow-right", "lucide:rocket"]));
		expect(Object.fromEntries(copies())).toEqual({
			"lucide:star": other("star"),
			"lucide:arrow-right": drawn("arrow-right"),
		});
		expect(save).toHaveBeenCalledTimes(1);
		// Nothing left to do: no second save.
		icons.update(new Set(["lucide:star", "lucide:arrow-right", "lucide:rocket"]));
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("leaves copies kept for a newer version to it", () => {
		const { icons, save, copies } = setup([], ["lucide:star"]);
		icons.update(new Set(["lucide:star"]));
		expect(copies().size).toBe(0);
		expect(save).not.toHaveBeenCalled();
	});

	it("counts the room the copies take", () => {
		const { icons } = setup([
			["lucide:star", "<svg>1</svg>"],
			["lucide:shapes", "<svg>12</svg>"],
		]);
		expect(icons.usage()).toEqual({ count: 2, bytes: 25 });
	});

	describe("image URLs", () => {
		it("show the copy, else this device's drawing, else nothing", async () => {
			const { created } = spyUrls();
			const { icons } = setup([["lucide:star", other("star")]]);
			expect(icons.url("star")).toBe("blob:1");
			expect(icons.url("arrow-right")).toBe("blob:2");
			expect(icons.url("rocket")).toBeUndefined();
			expect(created.map((blob) => blob.type)).toEqual(["image/svg+xml", "image/svg+xml"]);
			expect(await created[0].text()).toBe(other("star"));
			expect(await created[1].text()).toBe(drawn("arrow-right"));
			// Made once per icon.
			expect(icons.url("star")).toBe("blob:1");
			expect(created).toHaveLength(2);
		});

		it("of the copy only, for the picker", () => {
			const { revoke } = spyUrls();
			const { icons } = setup([["lucide:star", other("star")]]);
			const live = icons.url("arrow-right");
			expect(icons.storedUrl("arrow-right")).toBeUndefined();
			// The drawing shown elsewhere stays usable.
			expect(revoke).not.toHaveBeenCalled();
			expect(icons.url("arrow-right")).toBe(live);
			expect(icons.storedUrl("star")).toBe(icons.url("star"));
		});

		it("follow copies that sync brings, replaces or removes", () => {
			const { revoke } = spyUrls();
			const test = setup([["lucide:star", other("star")]]);
			const { icons } = test;
			const before = { star: icons.url("star"), arrow: icons.url("arrow-right") };
			test.reload([["lucide:arrow-right", other("arrow-right")]]);
			icons.releaseStale();
			expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual([
				before.star,
				before.arrow,
			]);
			expect(icons.url("arrow-right")).not.toBe(before.arrow);
			// Back to this device's drawing.
			expect(icons.url("star")).not.toBe(before.star);
			expect(icons.url("star")).toBeDefined();
		});

		it("are freed when an unused copy is dropped, and all on unload", () => {
			const { revoke } = spyUrls();
			const { icons } = setup([["lucide:star", other("star")]]);
			const url = icons.url("star");
			icons.update(new Set());
			expect(revoke).toHaveBeenCalledWith(url);
			icons.url("star");
			icons.url("shapes");
			icons.dispose();
			expect(revoke).toHaveBeenCalledTimes(3);
		});

		it("ask Obsidian for each drawing once", () => {
			spyUrls();
			const api = { getIcon: vi.fn(getIcon), getIconIds };
			const icons = new LibraryIcons(
				() => new Map(),
				vi.fn(),
				() => [],
				api,
			);
			icons.url("star");
			icons.url("star");
			icons.url("rocket");
			icons.url("rocket");
			expect(api.getIcon.mock.calls).toEqual([["lucide-star"], ["lucide-rocket"]]);
		});
	});
});
