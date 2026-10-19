import { DataAdapter, normalizePath, Platform } from "obsidian";
import type { NotemojiSettings } from "../data";
import { catalogFingerprint, getCatalog, warmUpCatalog } from "../picker/catalog";
import { EmojiSprites } from "../picker/emoji-sprites";
import { SpriteCacheFolder } from "../picker/sprite-cache";
import { EmojiFonts } from "./emoji-fonts";
import type { EmojiSet } from "./emoji-sets";

/** Delay after startup before the picker is prepared (ms), so it never competes with Obsidian's start. */
const WARM_UP_DELAY_MS = 3000;

/** Reads and changes the plugin's settings (always the current ones, also after a reload). */
export interface StyleSettings {
	get(): NotemojiSettings;
	update(patch: Partial<NotemojiSettings>): void;
}

/**
 * The emoji style: the font Notemoji's emoji are drawn with (see
 * EmojiFonts), and the picker's pre-rendered emoji images (see
 * EmojiSprites), which always show the active style.
 */
export class EmojiStyle {
	readonly fonts: EmojiFonts;
	readonly spriteCache: SpriteCacheFolder;
	readonly sprites: EmojiSprites;
	private warmUpTimer: number | null = null;
	private warmedUp = false;

	constructor(
		adapter: DataAdapter,
		pluginFolder: string,
		private readonly settings: StyleSettings,
	) {
		this.fonts = new EmojiFonts(adapter, normalizePath(`${pluginFolder}/fonts`));
		this.spriteCache = new SpriteCacheFolder(
			adapter,
			normalizePath(`${pluginFolder}/cache/sprites`),
		);
		this.sprites = new EmojiSprites({
			categories: getCatalog,
			fontFamily: resolvedEmojiFont,
			cache: this.spriteCache,
			cacheKey: (details) => this.cacheKey(details),
		});
	}

	/** Applies the chosen style, and prepares the picker once Obsidian had time to start. */
	start(): void {
		void this.load();
		this.warmUpTimer = window.setTimeout(() => this.warmUp(), WARM_UP_DELAY_MS);
	}

	/** Prepares the picker (emoji list and images) once; early when it is opened first. */
	warmUp(): void {
		if (this.warmUpTimer !== null) window.clearTimeout(this.warmUpTimer);
		this.warmUpTimer = null;
		if (this.warmedUp) return;
		this.warmedUp = true;
		warmUpCatalog();
		this.sprites.rebuild();
	}

	/** Applies the chosen style; a file missing on this device means system emoji. */
	async load(): Promise<void> {
		const { emojiStyle, emojiFont } = this.settings.get();
		await this.fonts.apply(emojiStyle, emojiFont);
		// The picker's images show the style: prepare them again.
		if (this.warmedUp) this.sprites.rebuild();
	}

	async select(style: string): Promise<void> {
		this.settings.update({ emojiStyle: style });
		await this.load();
	}

	/** Downloads a set (only ever on the user's request) and uses it. Throws with a message for the user. */
	async download(set: EmojiSet): Promise<void> {
		await this.fonts.download(set);
		await this.select(set.id);
	}

	/** Deletes a downloaded set and its images; deleting the active one switches to system emoji. */
	async deleteSet(set: EmojiSet): Promise<void> {
		await this.fonts.deleteSet(set);
		await this.spriteCache.removeStyle(set.id);
		if (this.settings.get().emojiStyle === set.id) await this.select("system");
	}

	/** Installs your own font file and uses it. Throws with a message for the user. */
	async installOwn(name: string, data: ArrayBuffer): Promise<void> {
		const file = await this.fonts.installOwn(name, data);
		this.settings.update({ emojiStyle: "file", emojiFont: file });
		await this.load();
	}

	/** Deletes your own font file and switches back to system emoji. */
	async removeOwn(): Promise<void> {
		await this.fonts.removeOwn();
		await this.spriteCache.removeStyle(OWN_FONT_FOLDER);
		this.settings.update({ emojiStyle: "system", emojiFont: "" });
		await this.load();
	}

	unload(): void {
		if (this.warmUpTimer !== null) window.clearTimeout(this.warmUpTimer);
		this.fonts.unload();
		this.sprites.dispose();
	}

	/**
	 * Cache key for the picker's images: `<style>/<device>-<details>-<emoji list>`.
	 * Keyed by what is actually drawn: a style whose font is not on this device
	 * (yet) is drawn as system emoji.
	 */
	private cacheKey(details: string): string {
		const { emojiStyle, emojiFont } = this.settings.get();
		const base = `${deviceName()}-${details}-${catalogFingerprint()}`;
		if (!this.fonts.active) return `system/${base}`;
		if (emojiStyle !== "file") return `${emojiStyle}/${base}`;
		// One folder for the own font; another file replaces its images.
		return `${OWN_FONT_FOLDER}/${base}-${emojiFont.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
	}
}

/** Cache folder of the own font file's images. */
const OWN_FONT_FOLDER = "own";

/** The kind of device: the same style is drawn differently on each. */
function deviceName(): string {
	if (Platform.isIosApp) return "ios";
	if (Platform.isAndroidApp) return "android";
	if (Platform.isMacOS) return "macos";
	if (Platform.isWin) return "windows";
	return "linux";
}

/** The font-family list Notemoji's emoji currently use, as the browser resolves it. */
function resolvedEmojiFont(): string {
	const probe = document.body.createSpan({ cls: "notemoji-font-probe" });
	const family = window.getComputedStyle(probe).fontFamily;
	probe.remove();
	return family;
}
