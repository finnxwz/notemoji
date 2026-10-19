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
 * Until a category's image is ready, its tiles fall back to text.
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
/** Highest pixel density rendered; more costs memory without a visible gain. */
const MAX_RATIO = 2;
/** Longest stretch of drawing at once when no idle deadline is available (ms). */
const SLICE_BUDGET_MS = 8;

/** Where an emoji is in a sprite sheet, as CSS background values. */
export interface SpriteSlot {
	/** `url("blob:…")` */
	image: string;
	/** e.g. `-56px -28px` */
	position: string;
	/** e.g. `896px 392px` */
	size: string;
}

export interface SpriteSource {
	slot(emoji: string): SpriteSlot | undefined;
	/** Called whenever another category became available; returns an unsubscribe function. */
	onChange(listener: () => void): () => void;
}

/** Runs `task` when the browser is idle; `deadline()` tells how much time is left (ms). */
export type IdleScheduler = (task: (timeLeft: () => number) => void) => void;

export interface SpriteOptions {
	/** Categories in drawing order. */
	categories: () => readonly EmojiCategory[];
	/** CSS font-family list of the active emoji style, already loaded. */
	fontFamily: () => string;
	pixelRatio?: () => number;
	scheduler?: IdleScheduler;
	createCanvas?: (width: number, height: number) => HTMLCanvasElement;
	toUrl?: (canvas: HTMLCanvasElement) => Promise<string>;
	/** Decodes an image ahead of time, so showing it first does not stall a frame. */
	decode?: (url: string) => Promise<void>;
	revokeUrl?: (url: string) => void;
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

const canvasToUrl = (canvas: HTMLCanvasElement): Promise<string> =>
	new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("toBlob failed")),
			"image/png",
		),
	);

const decodeImage = async (url: string): Promise<void> => {
	const image = new Image();
	image.src = url;
	try {
		await image.decode();
	} catch {
		// Decoding ahead is an optimisation only; the image still loads when shown.
	}
};

export class EmojiSprites implements SpriteSource {
	private readonly slots = new Map<string, SpriteSlot>();
	private readonly urls: string[] = [];
	private readonly listeners = new Set<() => void>();
	/** Increased by every rebuild; stale builds stop at their next slice. */
	private generation = 0;

	constructor(private readonly options: SpriteOptions) {}

	slot(emoji: string): SpriteSlot | undefined {
		return this.slots.get(emoji);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Drops the current images and draws all categories again (e.g. after the emoji style changed). */
	rebuild(): void {
		const generation = ++this.generation;
		this.clear();
		this.notify();
		const queue = [...this.options.categories()];
		const next = () => {
			const category = queue.shift();
			if (category && generation === this.generation)
				void this.build(category, generation).then(next);
		};
		next();
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

	/** Draws one category in idle slices, then publishes its image. */
	private async build(category: EmojiCategory, generation: number): Promise<void> {
		const ratio = Math.min(
			MAX_RATIO,
			Math.max(1, this.options.pixelRatio?.() ?? window.devicePixelRatio),
		);
		const cell = Math.round(CELL_PX * ratio);
		const entries = category.entries;
		const rows = Math.ceil(entries.length / COLUMNS);
		const canvas = (this.options.createCanvas ?? createCanvas)(COLUMNS * cell, rows * cell);
		const context = canvas.getContext("2d");
		if (!context) return;
		context.font = `${Math.round(EMOJI_PX * ratio)}px ${this.options.fontFamily()}`;
		context.textAlign = "left";
		context.textBaseline = "alphabetic";

		const schedule = this.options.scheduler ?? idleScheduler;
		let index = 0;
		await new Promise<void>((done) => {
			const slice = (timeLeft: () => number) => {
				if (generation !== this.generation) return done();
				do {
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
				} while (index < entries.length && timeLeft() > 1);
				if (index < entries.length) schedule(slice);
				else done();
			};
			schedule(slice);
		});
		if (generation !== this.generation || index < entries.length) return;

		const url = await (this.options.toUrl ?? canvasToUrl)(canvas);
		await (this.options.decode ?? decodeImage)(url);
		if (generation !== this.generation) {
			(this.options.revokeUrl ?? ((value: string) => URL.revokeObjectURL(value)))(url);
			return;
		}
		this.urls.push(url);
		const image = `url(${JSON.stringify(url)})`;
		const size = `${COLUMNS * CELL_PX}px ${rows * CELL_PX}px`;
		entries.forEach((entry, i) => {
			const x = (i % COLUMNS) * CELL_PX;
			const y = Math.floor(i / COLUMNS) * CELL_PX;
			this.slots.set(entry.emoji, { image, position: `-${x}px -${y}px`, size });
		});
		this.notify();
	}
}
