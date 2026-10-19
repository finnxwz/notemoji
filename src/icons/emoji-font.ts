import { DataAdapter, normalizePath } from "obsidian";
import { isFontFileName } from "./icon-value";

/** CSS font family under which the chosen emoji font is registered. */
export const EMOJI_FONT_FAMILY = "Notemoji Emoji";
/** Body class that switches Notemoji's emoji to the chosen font (see styles.css). */
export const EMOJI_FONT_CLASS = "notemoji-custom-font";

export const MAX_FONT_BYTES = 30 * 1024 * 1024;

export class EmojiFontError extends Error {}

/** Turns font file data into a loaded `FontFace`; injectable for tests. */
export type FontLoader = (family: string, data: ArrayBuffer) => Promise<FontFace>;

const browserLoader: FontLoader = (family, data) => new FontFace(family, data).load();

/**
 * An optional emoji font that changes how Notemoji's emoji look (for example
 * Twemoji or Noto Color Emoji). Only Notemoji's own elements use it; emoji in
 * note text stay as they are. Glyphs the font lacks fall back to the system's
 * emoji, so nothing ever disappears.
 *
 * The file lives in `<plugin folder>/fonts/` and is removed with the plugin.
 */
export class EmojiFont {
	private face: FontFace | null = null;
	private readonly documents = new Set<Document>();

	constructor(
		private readonly adapter: DataAdapter,
		readonly folder: string,
		private readonly loader: FontLoader = browserLoader,
	) {}

	get active(): boolean {
		return this.face !== null;
	}

	/** Copies a font into the plugin folder (replacing the previous one). Returns its file name. */
	async install(name: string, data: ArrayBuffer): Promise<string> {
		if (!isFontFileName(name)) {
			throw new EmojiFontError(`"${name}" is not a TTF, OTF, WOFF or WOFF2 font.`);
		}
		if (data.byteLength > MAX_FONT_BYTES) {
			throw new EmojiFontError(`"${name}" is larger than 30 MB.`);
		}
		// Fail before replacing anything when the browser cannot use the font.
		let face: FontFace;
		try {
			face = await this.loader(EMOJI_FONT_FAMILY, data);
		} catch {
			throw new EmojiFontError(`"${name}" could not be loaded as a font.`);
		}

		await this.removeFiles();
		if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
		await this.adapter.writeBinary(this.path(name), data);
		this.use(face);
		return name;
	}

	/** Loads an installed font (e.g. on startup). Returns false when it is missing or broken. */
	async load(name: string): Promise<boolean> {
		if (!isFontFileName(name) || !(await this.adapter.exists(this.path(name)))) {
			this.unload();
			return false;
		}
		try {
			this.use(
				await this.loader(
					EMOJI_FONT_FAMILY,
					await this.adapter.readBinary(this.path(name)),
				),
			);
			return true;
		} catch (error) {
			console.error(`[notemoji] Could not load the emoji font "${name}".`, error);
			this.unload();
			return false;
		}
	}

	/** Deletes the font file and switches back to the system's emoji. */
	async uninstall(): Promise<void> {
		this.unload();
		await this.removeFiles();
	}

	/** Makes the font available in a window (the main window and pop-outs). */
	attach(doc: Document): void {
		this.documents.add(doc);
		if (!this.face) return;
		doc.fonts.add(this.face);
		doc.body.addClass(EMOJI_FONT_CLASS);
	}

	/** Stops using the font everywhere (keeps the file). */
	unload(): void {
		for (const doc of this.documents) {
			if (this.face) doc.fonts.delete(this.face);
			doc.body.removeClass(EMOJI_FONT_CLASS);
		}
		this.face = null;
	}

	private use(face: FontFace): void {
		this.unload();
		this.face = face;
		for (const doc of this.documents) this.attach(doc);
	}

	private async removeFiles(): Promise<void> {
		if (await this.adapter.exists(this.folder)) await this.adapter.rmdir(this.folder, true);
	}

	private path(name: string): string {
		return normalizePath(`${this.folder}/${name}`);
	}
}
