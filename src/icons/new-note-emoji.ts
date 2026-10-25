import type { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { AutoPick, hemisphereOf, isUntitled, pickAutoEmoji } from "./auto-emoji";
import { IconService, isNote } from "./icon-service";

/** How soon after it was created a note must be opened to count as made on this device (ms). */
const OPEN_WITHIN_MS = 5000;

/** How long after its automatic emoji a new name of the note may still change it (ms). */
const RENAME_WITHIN_MS = 5 * 60 * 1000;

/** How many automatic picks of this session the next one tries to differ from. */
const RECENT_PICKS = 8;

interface Pick extends AutoPick {
	/** When it was picked. */
	time: number;
}

/**
 * Drops the oldest entries while they are expired. Entries are added in the
 * order they were created; one moved by a rename keeps its time and may
 * outlive the sweep, which is harmless: the time is checked again on use.
 */
function dropExpired(map: Map<string, number>, now: number): void {
	for (const [key, time] of map) {
		if (now - time <= OPEN_WITHIN_MS) return;
		map.delete(key);
	}
}

function moveEntry<T>(map: Map<string, T>, from: string, to: string): void {
	const entry = map.get(from);
	if (entry === undefined) return;
	map.delete(from);
	map.set(to, entry);
}

/** The file name of a path, with its extension. */
function fileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
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
	 * New notes still named "Untitled" (Obsidian's name for a note before it has
	 * one): they get their emoji with their real name, which says what they are.
	 */
	private readonly unnamed = new Set<string>();
	/**
	 * This session's automatic emoji by path. A deleted note keeps its emoji in
	 * data.json (deletes never touch it), so a new note at the same path would
	 * otherwise count as having one of its own.
	 */
	private readonly picks = new Map<string, Pick>();
	/** The latest automatic picks, most recent first. */
	private recentPicks: string[] = [];

	constructor(app: App, icons: IconService, enabled: () => boolean) {
		this.app = app;
		this.icons = icons;
		this.enabled = enabled;
	}

	/** Vault `create`: a new note gets its emoji when it is opened (right away if it already is). */
	handleCreate(file: TAbstractFile): void {
		// While starting, Obsidian reports every file of the vault as created.
		if (!this.app.workspace.layoutReady || !this.enabled() || !isNote(file)) return;
		if (this.app.workspace.getActiveFile() === file) {
			this.assign(file);
			return;
		}
		const now = Date.now();
		dropExpired(this.created, now);
		this.created.set(file.path, now);
	}

	/** Workspace `file-open`: a note opened right after it was created gets its emoji. */
	handleOpen(file: TFile | null): void {
		const created = file ? this.created.get(file.path) : undefined;
		if (!file || created === undefined) return;
		this.created.delete(file.path);
		// Still a note: it may have been renamed to another extension meanwhile.
		if (Date.now() - created <= OPEN_WITHIN_MS && this.enabled() && isNote(file)) {
			this.assign(file);
		}
	}

	/**
	 * Vault `rename`, after the emoji moved along. A new note that was
	 * "Untitled" gets its emoji now that it has a name. Soon after its automatic
	 * emoji, a sad or serious name removes it, and a friendly emoji makes way
	 * for one that fits the new name, unless the user chose an emoji meanwhile.
	 * Moving the note or renaming a folder above it is no new name.
	 */
	handleRename(file: TAbstractFile, oldPath: string): void {
		moveEntry(this.created, oldPath, file.path);
		moveEntry(this.picks, oldPath, file.path);

		if (this.unnamed.delete(oldPath)) {
			if (!isNote(file)) return;
			if (isUntitled(file.basename)) this.unnamed.add(file.path);
			else if (this.enabled()) this.assign(file);
			return;
		}

		const pick = this.picks.get(file.path);
		if (!pick || !isNote(file) || fileName(oldPath) === file.name) return;
		if (!this.enabled() || Date.now() - pick.time > RENAME_WITHIN_MS) return;
		if (this.icons.get(file.path) !== pick.emoji) return;
		const next = this.pick(file);
		if (next === undefined) {
			this.icons.removeIcon(file);
			this.picks.delete(file.path);
		} else if (pick.source === "fallback" && next.source !== "fallback") {
			this.store(file, next);
		}
	}

	/**
	 * The user chose an emoji for this item or removed it, also when it is the
	 * same as the automatic one: from now on it is theirs.
	 */
	forget(path: string): void {
		this.created.delete(path);
		this.unnamed.delete(path);
		this.picks.delete(path);
	}

	private assign(file: TFile): void {
		if (isUntitled(file.basename)) {
			this.unnamed.add(file.path);
			return;
		}
		// The user's own emoji always win, also one that moved here with a rename.
		const current = this.icons.get(file.path);
		if (current !== undefined && current !== this.picks.get(file.path)?.emoji) return;
		const pick = this.pick(file);
		if (pick) this.store(file, pick);
	}

	/** Stores the emoji like one chosen in the picker, but not as recently used: nobody chose it. */
	private store(file: TFile, pick: AutoPick): void {
		if (!this.icons.setIcon(file, pick.emoji) && this.icons.get(file.path) !== pick.emoji)
			return;
		this.picks.set(file.path, { ...pick, time: Date.now() });
		this.recentPicks = [pick.emoji, ...this.recentPicks].slice(0, RECENT_PICKS);
	}

	private pick(file: TFile): AutoPick | undefined {
		// Its folders up to the vault root, nearest first.
		const folders: TFolder[] = [];
		for (let folder = file.parent; folder && !folder.isRoot(); folder = folder.parent) {
			folders.push(folder);
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
