import type { EmojiCategory } from "./catalog";

/**
 * Pre-rendered emoji images ("sprite sheets") for the picker.
 *
 * Emoji are colour font glyphs: the browser has to draw each one into a
 * bitmap the first time it appears, which is slow (notably on Windows) and
 * made scrolling the picker stutter. Like Slack or Discord, the picker shows
 * pre-rendered images instead. Every category is drawn once into one image,
 * in idle time and small slices, in the active emoji style; tiles then show
 * a slice of that image, so scrolling only moves pictures.
 *
 * Finished images are kept in a cache (see SpriteCache), so each style is
 * drawn only once per device. Until a category's image is ready, its tiles
 * fall back to text.
 */

/** Font size the emoji are drawn at (CSS px), like text emoji in the grid. */
const EMOJI_PX = 24;
/**
 * Space per emoji in the sprite sheet (CSS px), with room for glyphs that are
 * wider than their font size. A tile shows one whole cell; keep in sync with
 * `.notemoji-sprite` in styles.css.
 */
const CELL_PX = 32;
const COLUMNS = 32;
/** Bump when the way images are drawn changes, so cached images are drawn again. */
const SPRITE_FORMAT = 1;
/** Highest pixel density rendered; more costs memory without a visible gain. */
const MAX_RATIO = 2;
/** Longest stretch of drawing at once when no idle deadline is available (ms). */
const SLICE_BUDGET_MS = 8;
/**
 * Emoji whose look tells emoji fonts and their versions apart: a classic one,
 * two newer ones (Emoji 14 and 15, missing on older systems) and a flag
 * (letters on Windows).
 */
const PROBE_EMOJI = ["😀", "🫠", "🫨", "🇺🇳"];
const PROBE_PX = 16;

/** Where an emoji is in a sprite sheet, as CSS background values. */
export interface SpriteSlot {
	/** `url("blob:…")` */
	image: string;
	/** e.g. `-64px -32px` */
	position: string;
	/** e.g. `1024px 384px` */
	size: string;
}

export interface SpriteSource {
	slot(emoji: string): SpriteSlot | undefined;
	/** Called whenever another category became available; returns an unsubscribe function. */
	onChange(listener: () => void): () => void;
}

/** Stores finished images (PNG) by cache key and category. */
export interface SpriteCache {
	read(key: string, category: string): Promise<ArrayBuffer | null>;
	write(key: string, category: string, data: ArrayBuffer): Promise<void>;
}

/** Runs `task` when the browser is idle; `timeLeft()` tells how much time is left (ms). */
export type IdleScheduler = (task: (timeLeft: () => number) => void) => void;

export interface SpriteOptions {
	/** Categories in drawing order. */
	categories: () => readonly EmojiCategory[];
	/** CSS font-family list of the active emoji style, already loaded. */
	fontFamily: () => string;
	/**
	 * The cache key for images that look like this: style, device, emoji list
	 * and the given `details`: pixel density, drawing format and a fingerprint
	 * of how this device draws the font, e.g. "2x-f1-1kq7xy".
	 */
	cacheKey?: (details: string) => string;
	cache?: SpriteCache;
	pixelRatio?: () => number;
	scheduler?: IdleScheduler;
	createCanvas?: (width: number, height: number) => HTMLCanvasElement;
	toPng?: (canvas: HTMLCanvasElement) => Promise<Blob>;
	createUrl?: (blob: Blob) => string;
	revokeUrl?: (url: string) => void;
	/**
	 * Decodes an image ahead of time, so showing it first does not stall a
	 * frame. Resolves false when the image can't be decoded (it is damaged).
	 */
	decode?: (url: string) => Promise<boolean>;
}

const idleScheduler: IdleScheduler = (task) => {
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback((deadline) => task(() => deadline.timeRemaining()), {
			timeout: 500,
		});
	} else {
		window.setTimeout(() => {
			const end = performance.now() + SLICE_BUDGET_MS;
			task(() => end - performance.now());
		}, 16);
	}
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
	const canvas = createEl("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
};

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Could not encode the sprite sheet.")),
			"image/png",
		),
	);

const decodeImage = async (url: string): Promise<boolean> => {
	const image = new Image();
	image.src = url;
	// Decoding ahead is an optimisation only; without it, the image still loads when shown.
	if (typeof image.decode !== "function") return true;
	try {
		await image.decode();
		return true;
	} catch {
		return false;
	}
};

export class EmojiSprites implements SpriteSource {
	private readonly slots = new Map<string, SpriteSlot>();
	private readonly urls: string[] = [];
	private readonly listeners = new Set<() => void>();
	/** Increased by every rebuild; stale builds stop at their next step. */
	private generation = 0;

	constructor(private readonly options: SpriteOptions) {}

	slot(emoji: string): SpriteSlot | undefined {
		return this.slots.get(emoji);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Drops the current images and prepares all categories again (e.g. after
	 * the emoji style changed): from the cache where possible, drawn otherwise.
	 */
	rebuild(): void {
		const generation = ++this.generation;
		this.clear();
		this.notify();
		const ratio = Math.min(
			MAX_RATIO,
			Math.max(1, Math.ceil(this.options.pixelRatio?.() ?? window.devicePixelRatio)),
		);
		const key = this.options.cacheKey?.(
			`${ratio}x-f${SPRITE_FORMAT}-${this.glyphFingerprint()}`,
		);
		void (async () => {
			for (const category of this.options.categories()) {
				if (generation !== this.generation) return;
				try {
					await this.prepare(category, ratio, key, generation);
				} catch (error) {
					console.error(
						`[notemoji] Could not prepare the "${category.id}" emoji images.`,
						error,
					);
				}
			}
		})();
	}

	dispose(): void {
		this.generation += 1;
		this.clear();
		this.listeners.clear();
	}

	private clear(): void {
		const revoke = this.options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
		for (const url of this.urls.splice(0)) revoke(url);
		this.slots.clear();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	/**
	 * A short fingerprint of how this device draws a few emoji in the current
	 * font, so cached images are drawn again once that changes: after a system
	 * update brought new emoji, or on another device of the same kind.
	 */
	private glyphFingerprint(): string {
		const canvas = (this.options.createCanvas ?? createCanvas)(
			PROBE_PX * PROBE_EMOJI.length,
			PROBE_PX,
		);
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) return "0";
		context.font = `${PROBE_PX - 4}px ${this.options.fontFamily()}`;
		context.textBaseline = "bottom";
		PROBE_EMOJI.forEach((emoji, i) => context.fillText(emoji, i * PROBE_PX, PROBE_PX));
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		let hash = 0x811c9dc5;
		// Coarse colour steps: tiny smoothing differences must not count as another look.
		for (const value of data) hash = Math.imul(hash ^ (value >> 4), 0x01000193);
		return (hash >>> 0).toString(36);
	}

	/** Gets one category's image (cached or freshly drawn) and publishes it. */
	private async prepare(
		category: EmojiCategory,
		ratio: number,
		key: string | undefined,
		generation: number,
	): Promise<void> {
		const { cache } = this.options;
		const createUrl = this.options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
		const revoke = this.options.revokeUrl ?? ((value: string) => URL.revokeObjectURL(value));
		const decode = this.options.decode ?? decodeImage;
		const cached = key && cache ? await cache.read(key, category.id) : null;
		if (generation !== this.generation) return;
		let url = cached ? createUrl(new Blob([cached], { type: "image/png" })) : null;
		if (url && !(await decode(url))) {
			// Damaged in the cache (complete, but broken inside): drawn again and
			// replaced, so the category does not stay blank until the cache is cleared.
			revoke(url);
			url = null;
		}
		if (!url) {
			const png = await this.draw(category, ratio, generation);
			if (!png) return;
			if (key && cache) await cache.write(key, category.id, await png.arrayBuffer());
			if (generation !== this.generation) return;
			url = createUrl(png);
			// Used even if decoding ahead fails: drawing it again would not help.
			await decode(url);
		}
		if (generation !== this.generation) {
			revoke(url);
			return;
		}
		this.urls.push(url);
		const image = `url(${JSON.stringify(url)})`;
		const rows = Math.ceil(category.entries.length / COLUMNS);
		const size = `${COLUMNS * CELL_PX}px ${rows * CELL_PX}px`;
		category.entries.forEach((entry, i) => {
			const x = (i % COLUMNS) * CELL_PX;
			const y = Math.floor(i / COLUMNS) * CELL_PX;
			this.slots.set(entry.emoji, { image, position: `-${x}px -${y}px`, size });
		});
		this.notify();
	}

	/** Draws one category in idle slices; null when cancelled or no canvas is available. */
	private async draw(
		category: EmojiCategory,
		ratio: number,
		generation: number,
	): Promise<Blob | null> {
		const cell = CELL_PX * ratio;
		const entries = category.entries;
		const canvas = (this.options.createCanvas ?? createCanvas)(
			COLUMNS * cell,
			Math.ceil(entries.length / COLUMNS) * cell,
		);
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.font = `${EMOJI_PX * ratio}px ${this.options.fontFamily()}`;
		context.textAlign = "left";
		context.textBaseline = "alphabetic";

		const schedule = this.options.scheduler ?? idleScheduler;
		let index = 0;
		await new Promise<void>((done) => {
			const slice = (timeLeft: () => number) => {
				if (generation !== this.generation) return done();
				while (index < entries.length) {
					const emoji = entries[index].emoji;
					// Centred by the glyph's actual outline: colour emoji are often taller
					// than their font size and do not sit centred on the baseline.
					const box = context.measureText(emoji);
					const width = box.actualBoundingBoxLeft + box.actualBoundingBoxRight;
					const height = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent;
					const left =
						(index % COLUMNS) * cell + (cell - width) / 2 + box.actualBoundingBoxLeft;
					const top = Math.floor(index / COLUMNS) * cell + (cell - height) / 2;
					context.fillText(emoji, left, top + box.actualBoundingBoxAscent);
					index += 1;
					if (timeLeft() <= 1) break;
				}
				if (index < entries.length) schedule(slice);
				else done();
			};
			schedule(slice);
		});
		if (generation !== this.generation || index < entries.length) return null;
		return (this.options.toPng ?? canvasToPng)(canvas);
	}
}
