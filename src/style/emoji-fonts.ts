import { DataAdapter, normalizePath, requestUrl } from "obsidian";
import { EMOJI_SETS, EmojiSet, findEmojiSet, isFontFileName } from "./emoji-sets";

/**
 * Prefix of the CSS font family the chosen emoji font is registered under.
 * Every load gets a new family (`Notemoji Emoji 1`, `… 2`), so switching
 * styles always re-renders: browsers may keep drawing cached glyphs when a
 * family is merely swapped for another file.
 */
export const EMOJI_FONT_FAMILY = "Notemoji Emoji";
/** CSS variable on <body> naming the active family (see styles.css). */
export const EMOJI_FONT_VARIABLE = "--notemoji-custom-family";
/** Body class that switches Notemoji's emoji to the chosen font (see styles.css). */
export const EMOJI_FONT_CLASS = "notemoji-custom-font";

/**
 * Fonts above this size get a warning before they are used: they slow down
 * Obsidian's start, can exceed the memory of phones, and many sync services
 * limit file sizes. There is no hard limit.
 */
export const LARGE_FONT_BYTES = 50 * 1024 * 1024;

/** `system`, `file` (your own font file) or the id of a downloadable set. */
export type EmojiStyle = string;

export class EmojiFontError extends Error {}

/**
 * Turns a font into a loaded `FontFace`: from data in memory, or from a CSS
 * `url(…)` so the browser reads the file itself (no copy in memory, which
 * matters for large fonts). Injectable for tests.
 */
export type FontLoader = (family: string, source: ArrayBuffer | string) => Promise<FontFace>;

/** Downloads and hashes files; injectable for tests. */
export interface Downloader {
	download(url: string): Promise<ArrayBuffer>;
	sha256(data: ArrayBuffer): Promise<string>;
}

const browserLoader: FontLoader = (family, source) => new FontFace(family, source).load();

/**
 * Whether a loaded font really draws emoji on this device: `color` needs
 * coloured pixels, `visible` any. Injectable for tests.
 */
export type GlyphCheck = (face: FontFace, family: string, need: "color" | "visible") => boolean;

/**
 * Draws 😀 with the font. Some formats are not supported everywhere: Noto
 * Color Emoji uses COLRv1, which Safari and iOS (also Obsidian on iPhone and
 * iPad) can't draw, so its emoji would be empty there.
 */
const browserGlyphCheck: GlyphCheck = (face, family, need) => {
	try {
		document.fonts.add(face);
		const size = 48;
		const canvas = createEl("canvas", { attr: { width: size, height: size } });
		const context = canvas.getContext("2d", { willReadFrequently: true });
		// Can't tell without a canvas: assume it works, as before.
		if (!context) return true;
		context.font = `40px ${JSON.stringify(family)}`;
		context.textBaseline = "top";
		context.fillStyle = "#000";
		context.fillText("😀", 2, 2);
		const { data } = context.getImageData(0, 0, size, size);
		let visible = false;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] < 64) continue;
			visible = true;
			const spread =
				Math.max(data[i], data[i + 1], data[i + 2]) -
				Math.min(data[i], data[i + 1], data[i + 2]);
			if (need === "visible" || spread > 48) return true;
		}
		return need === "visible" && visible;
	} catch {
		return true;
	} finally {
		document.fonts?.delete(face);
	}
};

const browserDownloader: Downloader = {
	async download(url) {
		return (await requestUrl({ url })).arrayBuffer;
	},
	async sha256(data) {
		const digest = await crypto.subtle.digest("SHA-256", data);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	},
};

/**
 * The emoji style: which font Notemoji's emoji are drawn with.
 *
 * - `system`: the operating system's emoji (default).
 * - a downloadable open set (see emoji-sets.ts), stored as `fonts/<set>.<ext>`;
 *   downloaded sets are kept, so switching back is instant.
 * - `file`: your own font file, stored in `fonts/own/` (one at a time).
 *
 * Only Notemoji's own elements use the font; emoji in note text stay as they
 * are. Glyphs the font lacks, or a font file that is missing on this device
 * (not downloaded or not synced yet), fall back to the system's emoji.
 * Everything lives in the plugin folder, so it is removed with the plugin.
 */
export class EmojiFonts {
	private face: FontFace | null = null;
	/** Family the current face is registered under (browsers may report `face.family` quoted). */
	private family = "";
	private readonly documents = new Set<Document>();
	/** Only the most recent `apply` may change the font. */
	private generation = 0;
	private cannotDraw = false;

	constructor(
		private readonly adapter: DataAdapter,
		readonly folder: string,
		private readonly loader: FontLoader = browserLoader,
		private readonly downloader: Downloader = browserDownloader,
		private readonly glyphCheck: GlyphCheck = browserGlyphCheck,
	) {}

	get active(): boolean {
		return this.face !== null;
	}

	/** The chosen style's file is on this device, but this device can't draw it (system emoji are shown). */
	get unsupported(): boolean {
		return this.cannotDraw;
	}

	/** Uses a style. Missing files mean system emoji; nothing is downloaded here. */
	async apply(style: EmojiStyle, ownFont: string): Promise<void> {
		const generation = ++this.generation;
		this.cannotDraw = false;
		const path = this.pathOf(style, ownFont);
		if (!path || !(await this.adapter.exists(path))) {
			if (generation === this.generation) this.unload();
			return;
		}
		try {
			const url = this.adapter.getResourcePath(path);
			const family = `${EMOJI_FONT_FAMILY} ${generation}`;
			const face = await this.loader(family, `url(${JSON.stringify(url)})`);
			if (generation !== this.generation) return;
			const color = style !== "file" && findEmojiSet(style)?.monochrome !== true;
			if (!this.glyphCheck(face, family, color ? "color" : "visible")) {
				this.cannotDraw = true;
				this.unload();
				return;
			}
			this.use(face, family);
		} catch (error) {
			console.error(`[notemoji] Could not load the emoji font "${path}".`, error);
			if (generation === this.generation) this.unload();
		}
	}

	/** Whether the file of a style is on this device. */
	async isAvailable(style: EmojiStyle, ownFont: string): Promise<boolean> {
		const path = this.pathOf(style, ownFont);
		return path !== undefined && (await this.adapter.exists(path));
	}

	/** Downloads a set, verifies its checksum and stores it. Throws with a message for the user. */
	async download(set: EmojiSet): Promise<void> {
		let data: ArrayBuffer;
		try {
			data = await this.downloader.download(set.url);
		} catch {
			throw new EmojiFontError(`Could not download ${set.name}. Check your connection.`);
		}
		if ((await this.downloader.sha256(data)) !== set.sha256) {
			throw new EmojiFontError(`The download of ${set.name} was not the expected file.`);
		}
		await this.ensureFolder(this.folder);
		await this.adapter.writeBinary(this.setPath(set), data);
	}

	/** Downloaded sets on this device with their size. */
	async downloadedSets(): Promise<Array<{ set: EmojiSet; bytes: number }>> {
		const found: Array<{ set: EmojiSet; bytes: number }> = [];
		for (const set of EMOJI_SETS) {
			const stat = await this.adapter.stat(this.setPath(set));
			if (stat) found.push({ set, bytes: stat.size });
		}
		return found;
	}

	async deleteSet(set: EmojiSet): Promise<void> {
		if (await this.adapter.exists(this.setPath(set)))
			await this.adapter.remove(this.setPath(set));
	}

	/** Stores your own font file (replacing the previous one). Returns its file name. */
	async installOwn(name: string, data: ArrayBuffer): Promise<string> {
		if (!isFontFileName(name)) {
			throw new EmojiFontError(`"${name}" is not a TTF, OTF, WOFF or WOFF2 font.`);
		}
		// Fail before replacing anything when the browser cannot use the font.
		try {
			await this.loader(EMOJI_FONT_FAMILY, data);
		} catch {
			throw new EmojiFontError(`"${name}" could not be loaded as a font.`);
		}
		await this.removeOwn();
		await this.ensureFolder(this.folder);
		await this.ensureFolder(this.ownFolder);
		await this.adapter.writeBinary(normalizePath(`${this.ownFolder}/${name}`), data);
		return name;
	}

	async removeOwn(): Promise<void> {
		if (await this.adapter.exists(this.ownFolder))
			await this.adapter.rmdir(this.ownFolder, true);
	}

	/** Makes the font available in a window (the main window and pop-outs). */
	attach(doc: Document): void {
		this.documents.add(doc);
		if (!this.face) return;
		doc.fonts.add(this.face);
		doc.body.setCssProps({ [EMOJI_FONT_VARIABLE]: JSON.stringify(this.family) });
		doc.body.addClass(EMOJI_FONT_CLASS);
	}

	/** Forgets a closed window. */
	detach(doc: Document): void {
		this.documents.delete(doc);
	}

	/** Stops using the font everywhere (keeps the files). */
	unload(): void {
		for (const doc of this.documents) {
			if (this.face) doc.fonts.delete(this.face);
			doc.body.removeClass(EMOJI_FONT_CLASS);
			doc.body.setCssProps({ [EMOJI_FONT_VARIABLE]: "" });
		}
		this.face = null;
	}

	private use(face: FontFace, family: string): void {
		this.unload();
		this.face = face;
		this.family = family;
		for (const doc of this.documents) this.attach(doc);
	}

	private get ownFolder(): string {
		return normalizePath(`${this.folder}/own`);
	}

	private setPath(set: EmojiSet): string {
		return normalizePath(`${this.folder}/${set.file}`);
	}

	private pathOf(style: EmojiStyle, ownFont: string): string | undefined {
		if (style === "file") {
			return isFontFileName(ownFont)
				? normalizePath(`${this.ownFolder}/${ownFont}`)
				: undefined;
		}
		const set = findEmojiSet(style);
		return set ? this.setPath(set) : undefined;
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
	}
}
