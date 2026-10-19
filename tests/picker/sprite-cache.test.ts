import type { DataAdapter } from "obsidian";
import { describe, expect, it } from "vitest";
import { SpriteCacheFolder } from "../../src/picker/sprite-cache";
import { FakeAdapter } from "../fake-app";

const FOLDER = ".obsidian/plugins/notemoji/cache/sprites";
const bytes = (size: number) => new Uint8Array(size).buffer;

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
			10,
		);
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
