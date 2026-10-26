import type { DataAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import { isCompletePng, SpriteCacheFolder } from "../../src/picker/sprite-cache";
import { FakeAdapter } from "../fake-app";

const FOLDER = ".obsidian/plugins/notemoji/cache/sprites";
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
/** A "PNG" of `size` bytes: right signature and end chunk, zeros in between. */
const bytes = (size: number) => {
	const data = new Uint8Array(Math.max(size, 16));
	data.set(PNG_START);
	data.set(PNG_END, data.length - PNG_END.length);
	return data.buffer;
};

function setup() {
	const adapter = new FakeAdapter();
	return { adapter, cache: new SpriteCacheFolder(adapter as unknown as DataAdapter, FOLDER) };
}

describe("SpriteCacheFolder", () => {
	it("stores and reads images by key and category", async () => {
		const { adapter, cache } = setup();
		expect(await cache.read("twemoji/windows-1x-f1-1870-abc", "smileys")).toBeNull();
		await cache.write("twemoji/windows-1x-f1-1870-abc", "smileys", bytes(10));
		expect(adapter.files.has(`${FOLDER}/twemoji/windows-1x-f1-1870-abc/smileys.png`)).toBe(
			true,
		);
		expect((await cache.read("twemoji/windows-1x-f1-1870-abc", "smileys"))?.byteLength).toBe(
			16,
		);
	});

	it("ignores images that were only partly written or synced", async () => {
		const { cache } = setup();
		const whole = bytes(100);
		expect(isCompletePng(whole)).toBe(true);
		expect(isCompletePng(whole.slice(0, 60))).toBe(false);
		expect(isCompletePng(new ArrayBuffer(100))).toBe(false);
		await cache.write("system/linux-1x-f1-x", "smileys", whole.slice(0, 60));
		expect(await cache.read("system/linux-1x-f1-x", "smileys")).toBeNull();
	});

	it("replaces outdated images of the same device and density, keeps the others", async () => {
		const { adapter, cache } = setup();
		await cache.write("twemoji/windows-1x-f1-1800-old", "smileys", bytes(1));
		await cache.write("twemoji/windows-2x-f1-1800-old", "smileys", bytes(1));
		await cache.write("twemoji/ios-2x-f1-1800-old", "smileys", bytes(1));
		await cache.write("twemoji/windows-1x-f1-1870-new", "smileys", bytes(1));
		await cache.write("twemoji/windows-1x-f1-1870-new", "people", bytes(1));
		expect(
			[...adapter.files.keys()].map((path) => path.slice(FOLDER.length + 1)).sort(),
		).toEqual([
			"twemoji/ios-2x-f1-1800-old/smileys.png",
			"twemoji/windows-1x-f1-1870-new/people.png",
			"twemoji/windows-1x-f1-1870-new/smileys.png",
			"twemoji/windows-2x-f1-1800-old/smileys.png",
		]);
	});

	it("keeps the images of other computers of the same kind, the two most recent", async () => {
		const { adapter, cache } = setup();
		const folders = () =>
			[...new Set([...adapter.files.keys()].map((path) => path.split("/").at(-2)))].sort();
		// Windows 10 and 11 draw the same style differently; the cache folder syncs.
		await cache.write("twemoji/windows-1x-f1-win10-1870-abc", "smileys", bytes(1));
		await cache.write("twemoji/windows-1x-f1-win11-1870-abc", "smileys", bytes(1));
		expect(folders()).toEqual(["windows-1x-f1-win10-1870-abc", "windows-1x-f1-win11-1870-abc"]);

		// A newer emoji list replaces both computers' outdated images.
		await cache.write("twemoji/windows-1x-f1-win10-1900-def", "smileys", bytes(1));
		expect(folders()).toEqual(["windows-1x-f1-win10-1900-def"]);

		await cache.write("twemoji/windows-1x-f1-a-1900-def", "smileys", bytes(1));
		await cache.write("twemoji/windows-1x-f1-b-1900-def", "smileys", bytes(1));
		expect(folders()).toHaveLength(3);
		// A fourth look: the oldest is dropped instead of piling up.
		await cache.write("twemoji/windows-1x-f1-c-1900-def", "smileys", bytes(1));
		expect(folders()).toEqual([
			"windows-1x-f1-a-1900-def",
			"windows-1x-f1-b-1900-def",
			"windows-1x-f1-c-1900-def",
		]);
	});

	it("removes a style, reports the size and clears everything", async () => {
		const { adapter, cache } = setup();
		await cache.write("twemoji/windows-1x-f1-x", "smileys", bytes(2048));
		await cache.write("system/windows-1x-f1-x", "smileys", bytes(1024));
		expect(await cache.size()).toBe(3072);
		await cache.removeStyle("twemoji");
		expect(await cache.size()).toBe(1024);
		await cache.clear();
		expect(await cache.size()).toBe(0);
		expect(adapter.files.size).toBe(0);
	});
});
