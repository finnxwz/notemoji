import type { App, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";
import { parseEmojiInput } from "./emoji";
import { NotemojiSettings, PluginData, pushRecent } from "./data";

export function isNote(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension === "md";
}

/**
 * The single source of truth for "which emoji does this item have".
 *
 * Every emoji (notes, folders, any file) lives in data.json by vault path, so
 * notes are never modified. Renderers only call `get(path)` and re-render on
 * `onChange`.
 */
export class IconService {
	private readonly app: App;
	private data: PluginData;
	private readonly save: () => void;
	private readonly listeners = new Set<() => void>();

	constructor(app: App, data: PluginData, save: () => void) {
		this.app = app;
		this.data = data;
		this.save = save;
	}

	get settings(): NotemojiSettings {
		return this.data.settings;
	}

	get recent(): readonly string[] {
		return this.data.recent;
	}

	get(path: string): string | undefined {
		return this.data.icons.get(path);
	}

	/** Subscribes to icon changes; returns an unsubscribe function. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	/** Swaps in data.json reloaded after an external change (e.g. sync). */
	replaceData(data: PluginData): void {
		this.data = data;
		this.notify();
	}

	/** Sets an item's emoji. Returns false when nothing changed or the input is no emoji. */
	setIcon(file: TAbstractFile, input: string): boolean {
		const parsed = parseEmojiInput(input);
		if (parsed.status !== "ok" || !this.data.icons.set(file.path, parsed.emoji)) return false;
		this.save();
		this.notify();
		return true;
	}

	/** Removes an item's emoji. Returns false when it had none. */
	removeIcon(file: TAbstractFile): boolean {
		if (!this.data.icons.remove(file.path)) return false;
		this.save();
		this.notify();
		return true;
	}

	rememberRecent(emoji: string): void {
		const recent = pushRecent(this.data.recent, emoji);
		if (recent.join() === this.data.recent.join()) return;
		this.data.recent = recent;
		this.save();
	}

	/**
	 * Moves emoji along with a rename or move inside Obsidian (folders take
	 * their contents along).
	 *
	 * Deletes are deliberately not handled: with sync, a "delete" can be one
	 * half of a rename on another device. The entry just stays hidden until the
	 * item comes back or the user removes emoji of missing files.
	 */
	handleRename(file: TAbstractFile, oldPath: string): void {
		if (!this.data.icons.rename(oldPath, file.path)) return;
		this.save();
		this.notify();
	}

	/** Entries whose item does not exist (anymore). */
	missingPaths(): string[] {
		const missing: string[] = [];
		for (const [path] of this.data.icons.entries()) {
			if (!this.app.vault.getAbstractFileByPath(path)) missing.push(path);
		}
		return missing;
	}

	/** Removes the entries of missing items. Returns how many were removed. */
	removeMissing(): number {
		const removed = this.data.icons.prune(
			(path) => this.app.vault.getAbstractFileByPath(path) !== null,
		);
		if (removed.length > 0) {
			this.save();
			this.notify();
		}
		return removed.length;
	}
}
