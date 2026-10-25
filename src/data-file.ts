import { DataAdapter, Notice } from "obsidian";
import {
	mergeChanges,
	parseData,
	PluginData,
	repairAfterOldVersion,
	serializeData,
	StoredData,
} from "./data";

/** Delay before the backup follows a change (ms), so a burst of changes writes it once. */
const BACKUP_DELAY_MS = 2000;

const NEWER_VERSION =
	"Notemoji was updated on another device. Update it on this device too (Settings → Community plugins). Until then, changes here are not saved.";
const UNREADABLE =
	"Notemoji's data.json could not be read. Restore it, for example from your sync's version history, or delete it to start over. Until then, changes are not saved.";
const RESTORED = "Notemoji's data.json could not be read, so the backup on this device is used.";

/** What the plugin offers for reading and writing its files. */
export interface DataFileHost {
	adapter: DataAdapter;
	/** Path of data.json. */
	dataPath: string;
	/** Path of the backup on this device. */
	backupPath: string;
	/** `Plugin.loadData`, used when data.json is not on disk. */
	loadData(): Promise<unknown>;
	/** `Plugin.saveData`. */
	saveData(data: unknown): Promise<void>;
	/** Called after the data was replaced by data read from disk (sync), to show it. */
	onReplaced(data: PluginData, previous: PluginData): void | Promise<void>;
}

/** Saved data in a comparable form: what parsing and saving it again produces. */
function canonical(data: PluginData): string {
	return JSON.stringify(serializeData(data));
}

/**
 * data.json: loading, saving and reloading after sync, so that no device
 * ever loses data another one wrote.
 *
 * - It remembers what is on disk (last read or written). Everything in
 *   memory that differs from it is a change not saved yet; when the file
 *   changed on disk meanwhile (sync), those changes are combined with it
 *   entry by entry (see `mergeChanges`), never dropped.
 * - Saves and reloads run one after another in a queue. A save writes the
 *   current data when it is its turn (a burst of changes is one write), and
 *   checks the file first, in case sync replaced it and the reload is still
 *   to come.
 * - Data of a newer version is never saved over (read-only until this device
 *   is updated); data saved over by Notemoji 1.x is repaired.
 * - `backup.json`, a copy on this device, repairs data.json when it is
 *   unreadable or was saved over by 1.x while this device was closed.
 *   Obsidian Sync doesn't sync it; other sync tools may copy it along, which
 *   is harmless.
 */
export class DataFile {
	data!: PluginData;
	/** What data.json holds (canonical), or null when there is none or it is unreadable. */
	private onDisk: string | null = null;
	private queue: Promise<void> = Promise.resolve();
	private savePending = false;
	/** Why nothing may be saved right now. */
	private readOnly: "newer" | "unreadable" | null = null;
	private noticeShown = false;
	private backupTimer: number | null = null;
	private lastBackup = "";

	constructor(private readonly host: DataFileHost) {}

	/**
	 * Whether changes nobody made here (automatic ones) may be saved: the data
	 * is data.json as read from disk, and this version may save over it. Not
	 * while data.json is missing or unreadable (the backup may be shown, and
	 * nothing is saved until a change is made here; sync may still bring it),
	 * or written by a newer version.
	 */
	get settled(): boolean {
		return this.onDisk !== null && this.readOnly === null;
	}

	/** Reads data.json at startup, repairing it from the backup when needed. */
	async load(): Promise<void> {
		const { raw, damaged } = await this.read();
		let data = parseData(raw);
		if (!damaged && data.source !== "none") this.onDisk = canonical(data);
		let repaired = false;
		const backup =
			damaged || data.source === "old" || data.source === "none"
				? await this.readBackup()
				: null;
		if (damaged) {
			// Not saved right away: sync may still bring an intact copy.
			if (backup) {
				data = backup;
				new Notice(RESTORED);
			} else {
				this.setReadOnly("unreadable");
			}
		} else if (data.source === "none" && backup) {
			// data.json may not be downloaded yet (e.g. iCloud): show the last known data.
			data = backup;
		} else if (data.source === "old" && backup) {
			data = repairAfterOldVersion(raw, backup);
			repaired = true;
		} else if (data.source === "newer") {
			this.setReadOnly("newer");
		}
		this.data = data;
		if (repaired) this.save();
		// A backup of nothing would only ever restore nothing.
		else if (data.source !== "none") this.scheduleBackup();
	}

	/** Saves the current data (queued; a burst of changes is written once). */
	save(): void {
		if (this.readOnly) {
			this.showReadOnlyNotice();
			return;
		}
		if (this.savePending) return;
		this.savePending = true;
		void this.enqueue(async () => {
			this.savePending = false;
			await this.writeNow();
		});
	}

	/** Reads data.json again after it changed on disk (sync), and shows what changed. */
	reload(): Promise<void> {
		return this.enqueue(async () => {
			const { raw, damaged } = await this.read();
			// Half written or half synced: the complete file follows.
			if (damaged) return;
			const next = parseData(raw);
			if (next.source === "none") {
				// Deleted: as the unreadable notice suggests, start over.
				if (this.readOnly === "unreadable") this.readOnly = null;
				return;
			}
			if (await this.takeIn(raw, next)) this.save();
			else this.scheduleBackup();
		});
	}

	/** Writes a pending backup right away (on unload). */
	unload(): void {
		if (this.backupTimer === null) return;
		window.clearTimeout(this.backupTimer);
		void this.writeBackup();
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.queue = this.queue.then(task).catch((error: unknown) => {
			console.error("[notemoji] Could not read or save data.json.", error);
		});
		return this.queue;
	}

	private async writeNow(): Promise<void> {
		if (this.readOnly) return;
		// Sync may have replaced the file before Obsidian reported it: take it in first.
		const { raw, damaged } = await this.read();
		if (!damaged) {
			const disk = parseData(raw);
			if (disk.source !== "none" && canonical(disk) !== this.onDisk) {
				await this.takeIn(raw, disk);
			}
		}
		if (this.readOnly) return;
		const snapshot: StoredData = serializeData(this.data);
		try {
			await this.host.saveData(snapshot);
		} catch (error) {
			console.error("[notemoji] Could not save data.json.", error);
			new Notice("Could not save the emoji. Please check the developer console.");
			return;
		}
		this.onDisk = canonical(parseData(snapshot));
		this.scheduleBackup();
	}

	/**
	 * Takes in data.json read from disk (`next`). Returns true when the result
	 * must be saved (repaired, or combined with changes made here).
	 */
	private async takeIn(raw: unknown, next: PluginData): Promise<boolean> {
		const base = this.onDisk;
		this.onDisk = canonical(next);
		if (next.source === "old") {
			// The file this device can't save over stays untouched.
			if (this.readOnly === "newer") return false;
			// A device with Notemoji 1.x saved over the file: put back what it dropped.
			this.readOnly = null;
			await this.replace(repairAfterOldVersion(raw, this.data));
			return true;
		}
		if (next.source === "newer") {
			this.setReadOnly("newer");
			await this.replace(next);
			return false;
		}
		this.readOnly = null;
		const local = serializeData(this.data);
		if (base !== null && JSON.stringify(local) !== base) {
			// Changes made here are not saved yet: keep them on top of the file.
			const before = JSON.parse(base) as StoredData;
			await this.replace(parseData(mergeChanges(before, local, serializeData(next))));
			return true;
		}
		if (canonical(next) !== JSON.stringify(local)) await this.replace(next);
		return false;
	}

	private async replace(data: PluginData): Promise<void> {
		const previous = this.data;
		this.data = data;
		await this.host.onReplaced(data, previous);
	}

	/** data.json as stored; `damaged` when it exists but can't be read as JSON. */
	private async read(): Promise<{ raw: unknown; damaged: boolean }> {
		const { adapter, dataPath } = this.host;
		try {
			// Read directly, so a damaged file is told apart from a missing one.
			if (await adapter.exists(dataPath)) {
				const text = await adapter.read(dataPath);
				return {
					raw: text.trim() === "" ? null : (JSON.parse(text) as unknown),
					damaged: false,
				};
			}
			return { raw: await this.host.loadData(), damaged: false };
		} catch (error) {
			console.error("[notemoji] Could not read data.json.", error);
			return { raw: null, damaged: true };
		}
	}

	private setReadOnly(reason: "newer" | "unreadable"): void {
		if (this.readOnly === reason) return;
		this.readOnly = reason;
		this.noticeShown = false;
		this.showReadOnlyNotice();
	}

	private showReadOnlyNotice(): void {
		if (this.noticeShown || !this.readOnly) return;
		this.noticeShown = true;
		new Notice(this.readOnly === "newer" ? NEWER_VERSION : UNREADABLE, 0);
	}

	// ------------------------------------------------------------------ backup

	private scheduleBackup(): void {
		if (this.readOnly) return;
		if (this.backupTimer !== null) window.clearTimeout(this.backupTimer);
		this.backupTimer = window.setTimeout(() => void this.writeBackup(), BACKUP_DELAY_MS);
	}

	private async writeBackup(): Promise<void> {
		this.backupTimer = null;
		if (this.readOnly) return;
		const json = JSON.stringify(serializeData(this.data));
		if (json === this.lastBackup) return;
		try {
			await this.host.adapter.write(this.host.backupPath, json);
			this.lastBackup = json;
		} catch (error) {
			console.error("[notemoji] Could not write the backup.", error);
		}
	}

	/** The backup, when it holds data of this version. */
	private async readBackup(): Promise<PluginData | null> {
		const { adapter, backupPath } = this.host;
		try {
			if (!(await adapter.exists(backupPath))) return null;
			const json = await adapter.read(backupPath);
			const backup = parseData(JSON.parse(json) as unknown);
			if (backup.source !== "current") return null;
			this.lastBackup = json;
			return backup;
		} catch (error) {
			console.error("[notemoji] Could not read the backup.", error);
			return null;
		}
	}
}
