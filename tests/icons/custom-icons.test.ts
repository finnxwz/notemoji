import type { DataAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import {
	CustomIconError,
	CustomIconLibrary,
	formatBytes,
	MAX_CUSTOM_ICON_BYTES,
} from "../../src/icons/custom-icons";
import { FakeAdapter } from "../fake-app";

const FOLDER = ".obsidian/plugins/notemoji/icons";

function setup() {
	const adapter = new FakeAdapter();
	const library = new CustomIconLibrary(adapter as unknown as DataAdapter, FOLDER);
	return { adapter, library };
}

const bytes = (size: number) => new Uint8Array(size).buffer;

describe("CustomIconLibrary", () => {
	it("starts empty without creating the folder", async () => {
		const { adapter, library } = setup();
		expect(await library.list()).toEqual([]);
		expect(adapter.folders.size).toBe(0);
	});

	it("stores uploads in the plugin's icon folder under unique names", async () => {
		const { adapter, library } = setup();
		expect(await library.add("Rocket.png", bytes(10))).toBe("Rocket.png");
		expect(await library.add("rocket.png", bytes(20))).toBe("rocket-2.png");
		expect([...adapter.files.keys()].sort()).toEqual(
			[`${FOLDER}/Rocket.png`, `${FOLDER}/rocket-2.png`].sort(),
		);
		expect([...(await library.list())].sort()).toEqual(["Rocket.png", "rocket-2.png"].sort());
		expect(await library.usage()).toEqual({ count: 2, bytes: 30 });
		expect(library.url("Rocket.png")).toBe(`app://local/${FOLDER}/Rocket.png`);
	});

	it("rejects unsupported and oversized files", async () => {
		const { library } = setup();
		await expect(library.add("notes.txt", bytes(1))).rejects.toBeInstanceOf(CustomIconError);
		await expect(library.add("huge.png", bytes(MAX_CUSTOM_ICON_BYTES + 1))).rejects.toThrow(
			/2 MB/,
		);
		expect(await library.list()).toEqual([]);
	});

	it("ignores files in the folder that are not icons", async () => {
		const { adapter, library } = setup();
		adapter.files.set(`${FOLDER}/readme.txt`, bytes(1));
		adapter.files.set(`${FOLDER}/a.svg`, bytes(1));
		adapter.folders.add(FOLDER);
		expect(await library.list()).toEqual(["a.svg"]);
	});

	it("removes one or all icons", async () => {
		const { adapter, library } = setup();
		await library.add("a.png", bytes(1));
		await library.add("b.png", bytes(1));
		await library.remove("a.png");
		await library.remove("../../data.json");
		expect(await library.list()).toEqual(["b.png"]);
		await library.removeAll();
		expect(await library.list()).toEqual([]);
		expect(adapter.files.size).toBe(0);
	});
});

it("formats sizes", () => {
	expect(formatBytes(512)).toBe("512 B");
	expect(formatBytes(2048)).toBe("2 KB");
	expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
});
