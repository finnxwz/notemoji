import { App, TAbstractFile, TFile } from "obsidian";
import { parseEmojiInput, parseIconValue, IconValue } from "./emoji";
import { IconStore } from "./icon-store";
import { NotemojiSettings, PluginData, pushRecent } from "./data";

/** The frontmatter property that holds a note's emoji. */
export const ICON_PROPERTY = "icon";

/** Markdown notes keep their emoji in frontmatter; everything else in data.json. */
export function isNote(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension === "md";
}

export interface IconServiceOptions {
	/** Persists data.json (settings, folder/file icons, recent). */
	save: () => void;
	/**
	 * Asked before replacing a note's `icon` property that holds something
	 * other than an emoji (e.g. another plugin's icon name). Resolve true to replace.
	 */
	confirmReplace: (file: TFile, current: unknown, emoji: string) => Promise<boolean>;
}

/**
 * The single source of truth for "which emoji does this item have".
 *
 * - Notes: the `icon` frontmatter property, indexed from the metadata cache.
 * - Folders and other files: data.json by vault path.
 * - Notes from version 1 may still be in data.json; frontmatter wins.
 *
 * Renderers only call `get(path)` and re-render on `onChange`.
 */
export class IconService {
	private readonly app: App;
	private data: PluginData;
	private readonly options: IconServiceOptions;
	/** Emoji found in note frontmatter, by path. */
	private readonly noteIcons = new IconStore();
	private readonly listeners = new Set<() => void>();

	constructor(app: App, data: PluginData, options: IconServiceOptions) {
		this.app = app;
		this.data = data;
		this.options = options;
	}

	get settings(): NotemojiSettings {
		return this.data.settings;
	}

	get recent(): readonly string[] {
		return this.data.recent;
	}

	get(path: string): string | undefined {
		return this.noteIcons.get(path) ?? this.data.icons.get(path);
	}

	/** Subscribes to icon changes; returns an unsubscribe function. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	/** Swaps in data.json reloaded after an external change (e.g. sync). */
	replaceData(data: PluginData): void {
		this.data = data;
		this.emit();
	}

	// ------------------------------------------------------------------ frontmatter index

	/** Reads the `icon` property of every note, e.g. once the layout is ready. */
	indexNotes(): void {
		this.noteIcons.clear();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const value = this.readProperty(file);
			if (value.kind === "emoji") this.noteIcons.set(file.path, value.emoji);
		}
		this.emit();
	}

	/** For `metadataCache.on("changed")`; only notifies when the emoji changed. */
	handleMetadataChange(file: TFile): void {
		const value = this.readProperty(file);
		const emoji = value.kind === "emoji" ? value.emoji : undefined;
		if (emoji === this.noteIcons.get(file.path)) return;

		if (emoji === undefined) this.noteIcons.remove(file.path);
		else this.noteIcons.set(file.path, emoji);
		this.emit();
	}

	private readProperty(file: TFile): IconValue {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return parseIconValue(frontmatter?.[ICON_PROPERTY]);
	}

	// ------------------------------------------------------------------ user actions

	/** Sets an item's emoji. Returns false when nothing changed (or the user declined). */
	async setIcon(file: TAbstractFile, input: string): Promise<boolean> {
		const parsed = parseEmojiInput(input);
		if (parsed.status !== "ok") return false;
		const emoji = parsed.emoji;

		if (!isNote(file)) {
			if (!this.data.icons.set(file.path, emoji)) return false;
			this.options.save();
			this.emit();
			return true;
		}

		const current = this.readProperty(file);
		const hasLegacyEntry = this.data.icons.get(file.path) !== undefined;
		if (current.kind === "emoji" && current.emoji === emoji && !hasLegacyEntry) return false;
		if (current.kind === "other") {
			if (!(await this.options.confirmReplace(file, current.value, emoji))) return false;
		}

		if (current.kind !== "emoji" || current.emoji !== emoji) {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					frontmatter[ICON_PROPERTY] = emoji;
				},
			);
		}
		// Shown right away instead of waiting for the metadata cache, which may
		// also have re-indexed the note already (then there is nothing to emit).
		let changed = this.noteIcons.set(file.path, emoji);
		// The note's emoji now lives in frontmatter only.
		if (this.data.icons.remove(file.path)) {
			this.options.save();
			changed = true;
		}
		if (changed) this.emit();
		return true;
	}

	/** Removes an item's emoji wherever it is stored. Returns false when it had none. */
	async removeIcon(file: TAbstractFile): Promise<boolean> {
		let changed = false;

		if (isNote(file) && this.readProperty(file).kind === "emoji") {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					delete frontmatter[ICON_PROPERTY];
				},
			);
			this.noteIcons.remove(file.path);
			changed = true;
		}
		if (this.data.icons.remove(file.path)) {
			this.options.save();
			changed = true;
		}

		if (changed) this.emit();
		return changed;
	}

	rememberRecent(emoji: string): void {
		const recent = pushRecent(this.data.recent, emoji);
		if (recent.join() === this.data.recent.join()) return;
		this.data.recent = recent;
		this.options.save();
	}

	// ------------------------------------------------------------------ vault events

	handleRename(file: TAbstractFile, oldPath: string): void {
		// Frontmatter travels with the note; only the index and data.json need moving.
		const movedIndex = this.noteIcons.rename(oldPath, file.path);
		const movedData = this.data.icons.rename(oldPath, file.path);
		if (movedData) this.options.save();
		if (movedIndex || movedData) this.emit();
	}

	/**
	 * Deletes never touch data.json: with sync, a "delete" can be one half of a
	 * rename on another device. The entry just stays hidden until the item
	 * comes back or the user cleans up missing files.
	 */
	handleDelete(file: TAbstractFile): void {
		if (this.noteIcons.removeTree(file.path)) this.emit();
	}

	// ------------------------------------------------------------------ maintenance

	/** data.json entries whose item does not exist (anymore). */
	missingPaths(): string[] {
		const missing: string[] = [];
		for (const [path] of this.data.icons.entries()) {
			if (!this.app.vault.getAbstractFileByPath(path)) missing.push(path);
		}
		return missing;
	}

	/** Removes the data.json entries of missing items. Returns how many were removed. */
	removeMissing(): number {
		const removed = this.data.icons.prune(
			(path) => this.app.vault.getAbstractFileByPath(path) !== null,
		);
		if (removed.length > 0) {
			this.options.save();
			this.emit();
		}
		return removed.length;
	}

	/** Notes whose emoji is still in data.json (from version 1). */
	notesInData(): TFile[] {
		const notes: TFile[] = [];
		for (const [path] of this.data.icons.entries()) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && isNote(file)) notes.push(file);
		}
		return notes;
	}

	/**
	 * Moves note emoji from data.json into frontmatter. Notes whose `icon`
	 * property holds something else are skipped (and keep their entry).
	 */
	async moveNotesToFrontmatter(): Promise<{ moved: number; skipped: number }> {
		let moved = 0;
		let skipped = 0;
		try {
			for (const file of this.notesInData()) {
				const emoji = this.data.icons.get(file.path);
				if (emoji === undefined) continue;

				const current = this.readProperty(file);
				if (current.kind === "other") {
					skipped += 1;
					continue;
				}
				if (current.kind === "none") {
					await this.app.fileManager.processFrontMatter(
						file,
						(frontmatter: Record<string, unknown>) => {
							frontmatter[ICON_PROPERTY] = emoji;
						},
					);
					this.noteIcons.set(file.path, emoji);
				}
				// An emoji already in frontmatter wins; the old entry is just dropped.
				this.data.icons.remove(file.path);
				moved += 1;
			}
		} finally {
			// Keep the progress even when a note could not be written.
			if (moved > 0) {
				this.options.save();
				this.emit();
			}
		}
		return { moved, skipped };
	}
}
