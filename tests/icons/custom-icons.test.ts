import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CustomIconError,
	CustomIconLibrary,
	ICON_STORAGE_LIMIT,
	MAX_ICON_SIZE,
	readCustomIcons,
	StoredIcon,
} from "../../src/icons/custom-icons";

/** A stored icon of `size` base64 characters; `seed` makes its content unique. */
const icon = (size = 8, seed = "A", type: StoredIcon["type"] = "image/png"): StoredIcon => ({
	type,
	data: seed.repeat(size / seed.length),
});

function setup(initial: Array<[string, StoredIcon]> = []) {
	let icons = new Map(initial);
	const save = vi.fn();
	const library = new CustomIconLibrary(() => icons, save);
	return {
		library,
		save,
		icons: () => icons,
		/** Swaps in different data, like a reload of data.json after sync. */
		reload(next: Array<[string, StoredIcon]>) {
			icons = new Map(next);
		},
	};
}

afterEach(() => vi.restoreAllMocks());

describe("CustomIconLibrary", () => {
	it("adds icons under unique names made from the file name", () => {
		const { library, save, icons } = setup();
		expect(library.add("Rocket.png", icon(8, "A"))).toEqual({ id: "Rocket", existing: false });
		expect(library.add("rocket.svg", icon(8, "B"))).toEqual({
			id: "rocket-2",
			existing: false,
		});
		expect(library.list()).toEqual(["Rocket", "rocket-2"]);
		expect(library.usage()).toEqual({ count: 2, bytes: 16 });
		expect(icons().get("Rocket")).toEqual(icon(8, "A"));
		expect(save).toHaveBeenCalledTimes(2);
	});

	it("stores an icon uploaded twice only once", () => {
		const { library, save } = setup();
		library.add("logo.png", icon(8, "A"));
		expect(library.add("logo copy.png", icon(8, "A"))).toEqual({ id: "logo", existing: true });
		expect(library.list()).toEqual(["logo"]);
		expect(save).toHaveBeenCalledTimes(1);
		// Same bytes as another format are a different icon.
		expect(library.add("logo.gif", icon(8, "A", "image/gif")).existing).toBe(false);
	});

	it("tells an upload apart only by its image, not by fields of a newer version", () => {
		const { library, save, icons } = setup([
			["logo", { ...icon(8, "A"), extra: { name: "Company logo" } }],
		]);
		expect(library.add("logo copy.png", icon(8, "A"))).toEqual({ id: "logo", existing: true });
		// A new icon has no fields of a newer version.
		expect(library.add("photo.png", { ...icon(8, "B"), extra: { name: "x" } }).id).toBe(
			"photo",
		);
		expect(icons().get("photo")).toEqual(icon(8, "B"));
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("keeps the total within 3 MB, so at least 50 full-size icons always fit", () => {
		const { library } = setup();
		const full = Math.floor(ICON_STORAGE_LIMIT / MAX_ICON_SIZE);
		expect(full).toBeGreaterThanOrEqual(50);
		for (let index = 0; index < full; index += 1) {
			library.add(
				`icon ${index}.png`,
				icon(MAX_ICON_SIZE, String.fromCharCode(65 + (index % 26)) + index),
			);
		}
		expect(library.usage().count).toBe(full);
		expect(() => library.add("one more.png", icon(MAX_ICON_SIZE, "z"))).toThrow(
			/no room left for "one more.png".*3 MB/,
		);
		expect(library.usage().count).toBe(full);
		// Something small still fits into what is left.
		expect(library.add("tiny.png", icon(4, "zzzz")).existing).toBe(false);
	});

	it("shares the room with the copies of Obsidian icons", () => {
		const icons = new Map<string, StoredIcon>();
		const library = new CustomIconLibrary(
			() => icons,
			vi.fn(),
			() => [],
			() => ICON_STORAGE_LIMIT - 8,
		);
		expect(library.add("small.png", icon(8, "A")).existing).toBe(false);
		expect(() => library.add("more.png", icon(4, "B"))).toThrow(/no room left/);
	});

	it("refuses icons over the per-icon limit (prepared icons never are)", () => {
		const { library } = setup();
		expect(() => library.add("x.png", icon(MAX_ICON_SIZE + 4))).toThrow(CustomIconError);
	});

	it("removes one or all icons", () => {
		const { library, save } = setup([
			["a", icon(4, "A")],
			["b", icon(4, "B")],
		]);
		expect(library.remove("a")).toBe(true);
		expect(library.remove("a")).toBe(false);
		expect(library.list()).toEqual(["b"]);
		library.removeAll();
		expect(library.list()).toEqual([]);
		expect(save).toHaveBeenCalledTimes(2);
		library.removeAll();
		expect(save).toHaveBeenCalledTimes(2);
	});

	describe("image URLs", () => {
		function spyUrls() {
			let next = 0;
			const create = vi
				.spyOn(URL, "createObjectURL")
				.mockImplementation(() => `blob:${++next}`);
			const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
			return { create, revoke };
		}

		it("are created once per icon and freed on removal", () => {
			const { create, revoke } = spyUrls();
			const { library } = setup([["a", icon(4, "AAAA", "image/svg+xml")]]);
			expect(library.url("a")).toBe("blob:1");
			expect(library.url("a")).toBe("blob:1");
			expect(create).toHaveBeenCalledTimes(1);
			expect((create.mock.calls[0][0] as Blob).type).toBe("image/svg+xml");
			expect(library.url("missing")).toBeUndefined();
			library.remove("a");
			expect(revoke).toHaveBeenCalledWith("blob:1");
			expect(library.url("a")).toBeUndefined();
		});

		it("follow icons replaced or removed by sync", () => {
			const { revoke } = spyUrls();
			const test = setup([
				["a", icon(4, "A")],
				["b", icon(4, "B")],
				["c", icon(4, "C")],
			]);
			const { library } = test;
			["a", "b", "c"].forEach((id) => library.url(id));
			test.reload([
				["a", icon(4, "A")],
				["b", icon(4, "X")],
			]);
			library.releaseStale();
			expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:2", "blob:3"]);
			expect(library.url("a")).toBe("blob:1");
			expect(library.url("b")).toBe("blob:4");
			expect(library.url("c")).toBeUndefined();
		});

		it("are all freed on unload", () => {
			const { revoke } = spyUrls();
			const { library } = setup([
				["a", icon(4, "A")],
				["b", icon(4, "B")],
			]);
			library.url("a");
			library.url("b");
			library.dispose();
			expect(revoke).toHaveBeenCalledTimes(2);
		});
	});
});

describe("readCustomIcons", () => {
	it("keeps valid entries and skips everything else", () => {
		const icons = readCustomIcons({
			logo: { type: "image/png", data: "iVBORw0K" },
			"logo.svg": { type: "image/svg+xml", data: "PHN2Zz4=" },
			"../evil": { type: "image/png", data: "iVBORw0K" },
			script: { type: "text/html", data: "PHN2Zz4=" },
			avif: { type: "image/avif", data: "AAAA" },
			broken: { type: "image/png", data: "not base64!" },
			empty: { type: "image/png", data: "" },
			number: 4,
			missing: { type: "image/png" },
		});
		expect([...icons.keys()]).toEqual(["logo", "logo.svg"]);
		expect(icons.get("logo")).toEqual({ type: "image/png", data: "iVBORw0K" });
	});

	it("keeps entries it can't use, also with names of a newer version", () => {
		const unreadable: Record<string, unknown> = {};
		readCustomIcons(
			{
				logo: { type: "image/png", data: "iVBORw0K" },
				"lucide:star": { type: "image/svg+xml", data: "PHN2Zz4=" },
				avif: { type: "image/avif", data: "AAAA" },
			},
			unreadable,
		);
		expect(unreadable).toEqual({
			"lucide:star": { type: "image/svg+xml", data: "PHN2Zz4=" },
			avif: { type: "image/avif", data: "AAAA" },
		});
	});

	it("is empty for anything that is not a map", () => {
		for (const raw of [undefined, null, "x", 3, [], [["a", {}]]]) {
			expect(readCustomIcons(raw).size).toBe(0);
		}
	});

	it("keeps fields it doesn't know, so they are saved again", () => {
		const icons = readCustomIcons({
			a: { type: "image/png", data: "AAAA", name: "Logo", size: { width: 64 } },
			b: { type: "image/png", data: "AAAA" },
		});
		expect(icons.get("a")).toEqual({
			type: "image/png",
			data: "AAAA",
			extra: { name: "Logo", size: { width: 64 } },
		});
		expect(icons.get("b")).toEqual({ type: "image/png", data: "AAAA" });
		expect(Object.hasOwn(icons.get("b")!, "extra")).toBe(false);
	});
});
