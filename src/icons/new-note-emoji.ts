import type { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { AutoPick, hemisphereOf, pickAutoEmoji } from "./auto-emoji";
import { IconService, isNote } from "./icon-service";

/** How soon after it was created a note must be opened to count as made on this device (ms). */
const OPEN_WITHIN_MS = 5000;

/** How long after its automatic emoji an untitled note's first rename may still change it (ms). */
const RENAME_WITHIN_MS = 5 * 60 * 1000;

/** How many automatic picks of this session the next one tries to differ from. */
const RECENT_PICKS = 8;

/** Drops the oldest entries while they are expired (a map keeps the order they were added in). */
function dropExpired<T>(map: Map<string, T>, expired: (value: T) => boolean): void {
	for (const [key, value] of map) {
		if (!expired(value)) return;
		map.delete(key);
	}
}

/**
 * Automatic emoji for new notes (the setting of the same name).
 *
 * Only for notes made on this device: notes opened within seconds of being
 * created, as with "New note", daily notes and templates. Notes that arrive
 * by sync or import, or that other plugins create in bulk, are hardly ever
 * opened that quickly, so two devices don't pick different emoji for the same
 * note: the device that made it picks, and the emoji syncs like any other.
 */
export class NewNoteEmoji {
	private readonly app: App;
	private readonly icons: IconService;
	private readonly enabled: () => boolean;
	/** Notes created and not opened yet, with the time they were created. */
	private readonly created = new Map<string, number>();
	/**
	 * Notes whose automatic emoji came from the friendly emoji because nothing
	 * fit, with that emoji and when it was picked. Obsidian names a new note
	 * "Untitled" (in any language) and its real name follows right after.
	 */
	private readonly untitled = new Map<string, { emoji: string; time: number }>();
	/** The latest automatic picks, most recent first. */
	private recentPicks: string[] = [];

	constructor(app: App, icons: IconService, enabled: () => boolean) {
		this.app = app;
		this.icons = icons;
		this.enabled = enabled;
	}

	/** Vault `create`: remembers a new note until it is opened. */
	handleCreate(file: TAbstractFile): void {
		// While starting, Obsidian reports every file of the vault as created.
		if (!this.app.workspace.layoutReady || !this.enabled() || !isNote(file)) return;
		this.untitled.delete(file.path);
		if (this.app.workspace.getActiveFile() === file) {
			this.assign(file);
			return;
		}
		const now = Date.now();
		dropExpired(this.created, (time) => now - time > OPEN_WITHIN_MS);
		this.created.set(file.path, now);
	}

	/** Workspace `file-open`: a note opened right after it was created gets its emoji. */
	handleOpen(file: TFile | null): void {
		const created = file ? this.created.get(file.path) : undefined;
		if (!file || created === undefined) return;
		this.created.delete(file.path);
		if (Date.now() - created <= OPEN_WITHIN_MS && this.enabled()) this.assign(file);
	}

	/**
	 * Vault `rename`, after the emoji moved along. When an untitled note gets
	 * its real name and that fits a theme, the friendly emoji makes way, unless
	 * the user chose another one meanwhile.
	 */
	handleRename(file: TAbstractFile, oldPath: string): void {
		const created = this.created.get(oldPath);
		if (created !== undefined) {
			this.created.delete(oldPath);
			this.created.set(file.path, created);
		}

		const pick = this.untitled.get(oldPath);
		if (!pick) return;
		this.untitled.delete(oldPath);
		if (!isNote(file) || !this.enabled() || Date.now() - pick.time > RENAME_WITHIN_MS) return;
		if (this.icons.get(file.path) !== pick.emoji) return;
		const next = this.pick(file);
		if (next.source !== "fallback") this.store(file, next.emoji);
	}

	private assign(file: TFile): void {
		// The user's own emoji always win, also one that moved here with a rename.
		if (this.icons.get(file.path) !== undefined) return;
		const pick = this.pick(file);
		if (!this.store(file, pick.emoji) || pick.source !== "fallback") return;
		const now = Date.now();
		dropExpired(this.untitled, (entry) => now - entry.time > RENAME_WITHIN_MS);
		this.untitled.set(file.path, { emoji: pick.emoji, time: now });
	}

	/** Stores the emoji like one chosen in the picker, but not as recently used: nobody chose it. */
	private store(file: TFile, emoji: string): boolean {
		if (!this.icons.setIcon(file, emoji)) return false;
		this.recentPicks = [emoji, ...this.recentPicks].slice(0, RECENT_PICKS);
		return true;
	}

	private pick(file: TFile): AutoPick {
		// Its folder and the one above, without the vault root.
		const folders: TFolder[] = [];
		let folder = file.parent;
		while (folder && !folder.isRoot() && folders.length < 2) {
			folders.push(folder);
			folder = folder.parent;
		}
		const neighbours: string[] = [];
		for (const item of file.parent?.children ?? []) {
			const icon = item === file ? undefined : this.icons.get(item.path);
			if (icon !== undefined) neighbours.push(icon);
		}
		return pickAutoEmoji({
			name: file.basename,
			folders: folders.map((folder) => ({
				name: folder.name,
				icon: this.icons.get(folder.path),
			})),
			neighbours,
			recentPicks: this.recentPicks,
			hemisphere: hemisphereOf(Intl.DateTimeFormat().resolvedOptions().timeZone),
		});
	}
}
