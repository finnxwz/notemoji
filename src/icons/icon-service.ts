import type { App, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";
import { PluginData, pushRecent } from "../data";
import { CUSTOM_PREFIX } from "./icon-value";

export function isNote(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension === "md";
}

/**
 * The single source of truth for "which emoji does this item have".
 *
 * Every emoji or custom icon (notes, folders, any file) lives in data.json by
 * vault path, so notes are never modified. Renderers only call `get(path)`
 * and re-render on `onChange`.
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

	get recent(): readonly string[] {
		return this.data.recent;
	}

	get(path: string): string | undefined {
		return this.data.icons.get(path);
	}

	/** Every path that has an icon, with the icon. */
	entries(): Iterable<[string, string]> {
		return this.data.icons.entries();
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

	/**
	 * Sets an item's emoji or custom icon (`custom:<name>`). Returns false when
	 * nothing changed or the value is not usable.
	 */
	setIcon(file: TAbstractFile, value: string): boolean {
		if (!this.data.icons.set(file.path, value)) return false;
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

	/** How many items use the custom icon `id`. */
	countCustomUses(id: string): number {
		return this.customUses().get(id) ?? 0;
	}

	/** How many items use each custom icon, by name (also names missing from the library). */
	customUses(): Map<string, number> {
		const uses = new Map<string, number>();
		for (const [, value] of this.data.icons.entries()) {
			if (!value.startsWith(CUSTOM_PREFIX)) continue;
			const id = value.slice(CUSTOM_PREFIX.length);
			uses.set(id, (uses.get(id) ?? 0) + 1);
		}
		return uses;
	}

	/**
	 * Forgets deleted custom icons: removes them from items and from the
	 * recent list. Without `ids`, forgets every custom icon.
	 */
	forgetCustomIcons(ids?: readonly string[]): void {
		const values = ids?.map((id) => CUSTOM_PREFIX + id);
		const matches = (value: string) =>
			values ? values.includes(value) : value.startsWith(CUSTOM_PREFIX);
		const removed = this.data.icons.removeWhere(matches);
		const recent = this.data.recent.filter((value) => !matches(value));
		if (removed.length === 0 && recent.length === this.data.recent.length) return;
		this.data.recent = recent;
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
