import "../obsidian";
import { describe, expect, it, vi } from "vitest";
import type { EmojiCategory } from "../../src/picker/catalog";
import { EmojiSprites, IdleScheduler, SpriteOptions } from "../../src/picker/emoji-sprites";
import { flush } from "../fake-app";

const category = (id: string, emoji: string[]): EmojiCategory => ({
	id,
	label: id,
	icon: emoji[0],
	entries: emoji.map((value) => ({ emoji: value, name: value, keywords: [] })),
});

const categories = [category("a", ["😀", "😃", "😄"]), category("b", ["🐻"])];

/** Runs scheduled slices only when the test says so, with a given time budget each. */
function manualScheduler(timePerSlice: number) {
	const queue: Array<(timeLeft: () => number) => void> = [];
	const scheduler: IdleScheduler = (task) => queue.push(task);
	return {
		scheduler,
		pending: () => queue.length,
		run() {
			const task = queue.shift();
			let left = timePerSlice;
			task?.(() => (left -= 1));
		},
	};
}

function setup(overrides: Partial<SpriteOptions> = {}) {
	const drawn: string[] = [];
	const context = {
		font: "",
		textAlign: "",
		textBaseline: "",
		measureText: () => ({
			actualBoundingBoxLeft: 0,
			actualBoundingBoxRight: 24,
			actualBoundingBoxAscent: 22,
			actualBoundingBoxDescent: 4,
		}),
		fillText: (text: string) => drawn.push(text),
		// Pixels of the probe emoji: they depend on the font, like on a real device.
		getImageData: () => ({
			data: Uint8ClampedArray.from(context.font, (char) => char.charCodeAt(0)),
		}),
	};
	const canvases: Array<{ width: number; height: number }> = [];
	let urls = 0;
	const revoked: string[] = [];
	const options: SpriteOptions = {
		categories: () => categories,
		fontFamily: () => '"Noto Color Emoji"',
		pixelRatio: () => 2,
		scheduler: (task) => task(() => 100),
		createCanvas: (width, height) => {
			canvases.push({ width, height });
			return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
		},
		toPng: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
		createUrl: () => `blob:sprite-${++urls}`,
		decode: () => Promise.resolve(true),
		revokeUrl: (url) => revoked.push(url),
		...overrides,
	};
	const sprites = new EmojiSprites(options);
	return { sprites, drawn, context, canvases, revoked };
}

describe("EmojiSprites", () => {
	it("draws every category into one image and exposes a slot per emoji", async () => {
		const { sprites, drawn, context, canvases } = setup();
		const changes = vi.fn();
		sprites.onChange(changes);
		sprites.rebuild();
		await flush(10);

		expect(drawn).toEqual(["😀", "😃", "😄", "🐻"]);
		expect(context.font).toBe('48px "Noto Color Emoji"');
		// 32 columns of 32 px cells at 2x.
		expect(canvases[0]).toEqual({ width: 32 * 64, height: 64 });
		expect(sprites.slot("😃")).toEqual({
			image: 'url("blob:sprite-1")',
			position: "-32px -0px",
			size: "1024px 32px",
		});
		expect(sprites.slot("🐻")?.image).toBe('url("blob:sprite-2")');
		expect(sprites.slot("🚀")).toBeUndefined();
		// Once when cleared, then once per finished category.
		expect(changes).toHaveBeenCalledTimes(3);
	});

	it("draws in idle slices without blocking", async () => {
		const idle = manualScheduler(2);
		const { sprites, drawn } = setup({ scheduler: idle.scheduler });
		sprites.rebuild();
		expect(drawn).toEqual([]);
		idle.run();
		expect(drawn.length).toBeGreaterThan(0);
		expect(drawn.length).toBeLessThan(3);
		while (idle.pending() > 0) {
			idle.run();
			await flush();
		}
		expect(drawn).toEqual(["😀", "😃", "😄", "🐻"]);
		expect(sprites.slot("🐻")).toBeDefined();
	});

	it("starts over when rebuilt (e.g. after a style change) and frees old images", async () => {
		const { sprites, revoked } = setup();
		sprites.rebuild();
		await flush(10);
		sprites.rebuild();
		expect(sprites.slot("😀")).toBeUndefined();
		expect(revoked).toEqual(["blob:sprite-1", "blob:sprite-2"]);
		await flush(10);
		expect(sprites.slot("😀")?.image).toBe('url("blob:sprite-3")');
	});

	it("abandons a build that was replaced while it was drawing", async () => {
		const idle = manualScheduler(100);
		const { sprites, drawn } = setup({ scheduler: idle.scheduler });
		sprites.rebuild();
		sprites.dispose();
		while (idle.pending() > 0) idle.run();
		await flush(10);
		expect(drawn).toEqual([]);
		expect(sprites.slot("😀")).toBeUndefined();
	});

	it("keeps images in the cache and reuses them instead of drawing again", async () => {
		const stored = new Map<string, ArrayBuffer>();
		const cache = {
			read: (key: string, id: string) => Promise.resolve(stored.get(`${key}/${id}`) ?? null),
			write: (key: string, id: string, data: ArrayBuffer) => {
				stored.set(`${key}/${id}`, data);
				return Promise.resolve();
			},
		};
		const cacheKey = (details: string) => `twemoji/windows-${details}-fp`;
		const first = setup({ cache, cacheKey });
		first.sprites.rebuild();
		await flush(10);
		expect([...stored.keys()]).toEqual([
			expect.stringMatching(/^twemoji\/windows-2x-f1-[0-9a-z]+-fp\/a$/),
			expect.stringMatching(/^twemoji\/windows-2x-f1-[0-9a-z]+-fp\/b$/),
		]);

		// Only the probe emoji are drawn: they show the font still looks the same.
		const second = setup({ cache, cacheKey });
		second.sprites.rebuild();
		await flush(10);
		expect(second.drawn).toEqual(["😀", "🫠", "🫨", "🇺🇳"]);
		expect(second.sprites.slot("🐻")).toBeDefined();

		// The same style drawn differently (e.g. after a system update) is drawn again.
		const third = setup({ cache, cacheKey, fontFamily: () => '"Other Emoji"' });
		third.sprites.rebuild();
		await flush(10);
		expect(third.drawn.slice(4)).toEqual(["😀", "😃", "😄", "🐻"]);
		expect(stored.size).toBe(4);
	});

	it("draws a damaged cached image again and replaces it in the cache", async () => {
		const stored = new Map<string, ArrayBuffer>();
		const cache = {
			read: (key: string, id: string) => Promise.resolve(stored.get(`${key}/${id}`) ?? null),
			write: (key: string, id: string, data: ArrayBuffer) => {
				stored.set(`${key}/${id}`, data);
				return Promise.resolve();
			},
		};
		const cacheKey = (details: string) => `twemoji/windows-${details}-fp`;
		const first = setup({ cache, cacheKey });
		first.sprites.rebuild();
		await flush(10);
		const [pathA] = [...stored.keys()];
		stored.set(pathA, new TextEncoder().encode("damaged").buffer);

		// Like a browser, which can't decode the damaged file.
		const images = new Map<string, Blob>();
		const second = setup({
			cache,
			cacheKey,
			createUrl: (blob) => {
				const url = `blob:image-${images.size + 1}`;
				images.set(url, blob);
				return url;
			},
			decode: async (url) => (await images.get(url)!.text()) !== "damaged",
		});
		second.sprites.rebuild();
		await flush(10);
		expect(second.drawn.slice(4)).toEqual(["😀", "😃", "😄"]);
		expect(second.revoked).toEqual(["blob:image-1"]);
		expect(new TextDecoder().decode(stored.get(pathA))).toBe("png");
		expect(second.sprites.slot("😀")?.image).toBe('url("blob:image-2")');
		expect(second.sprites.slot("🐻")?.image).toBe('url("blob:image-3")');
	});

	it("does nothing without a canvas context", async () => {
		const { sprites } = setup({
			createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
		});
		sprites.rebuild();
		await flush(10);
		expect(sprites.slot("😀")).toBeUndefined();
	});
});
