import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { EmojiModal } from "./src/emoji-modal";
import { FileExplorerRenderer } from "./src/file-explorer";
import { IconStore } from "./src/icon-store";

/** How an item is called in the UI. */
type ItemKind = "note" | "file" | "folder";

function describeItem(file: TAbstractFile): ItemKind {
	if (file instanceof TFolder) return "folder";
	if (file instanceof TFile && file.extension === "md") return "note";
	return "file";
}

export default class NotemojiPlugin extends Plugin {
	private store = new IconStore();
	private renderer!: FileExplorerRenderer;

	/** Serialised save queue; a newer snapshot is never overwritten by an older one. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		this.store = await this.loadStore();
		this.renderer = new FileExplorerRenderer(this.app, this.store);

		// The file explorer may be closed, moved or re-created at any time.
		this.registerEvent(this.app.workspace.on("layout-change", () => this.renderer.attach()));

		// Keep stored paths in sync with the vault.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)),
		);
		this.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file)));

		// Right-click menu for notes and folders in the file explorer.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => this.addExplorerMenuItems(menu, file)),
		);

		// Both commands need an open note, so they are only offered when there is one.
		this.addCommand({
			id: "set-emoji-active-note",
			name: "Set emoji for active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.openEmojiModal(file, describeItem(file));
				return true;
			},
		});
		this.addCommand({
			id: "remove-emoji-active-note",
			name: "Remove emoji from active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || this.store.get(file.path) === undefined) return false;
				if (!checking) this.removeEmojiFromActiveNote(file);
				return true;
			},
		});

		this.app.workspace.onLayoutReady(() => this.initialize());
	}

	onunload(): void {
		this.renderer?.dispose();
	}

	/** Drops stale paths (deleted while the plugin was not running) and renders. */
	private initialize(): void {
		try {
			const removed = this.store.prune(
				(path) => this.app.vault.getAbstractFileByPath(path) !== null,
			);
			if (removed.length > 0) this.persist();
		} catch (error) {
			console.error("[notemoji] Could not clean up stale icon mappings.", error);
		}

		this.renderer.attach();
	}

	// ------------------------------------------------------------------ context menu

	private addExplorerMenuItems(menu: Menu, file: TAbstractFile): void {
		if (!(file instanceof TFile) && !(file instanceof TFolder)) return;

		const kind = describeItem(file);
		const hasEmoji = this.store.get(file.path) !== undefined;

		menu.addItem((item) =>
			item
				.setTitle(`${hasEmoji ? "Change" : "Set"} ${kind} emoji`)
				.setIcon(hasEmoji ? "smile-plus" : "smile")
				.onClick(() => this.openEmojiModal(file, kind)),
		);

		if (hasEmoji) {
			menu.addItem((item) =>
				item
					.setTitle(`Remove ${kind} emoji`)
					.setIcon("eraser")
					.onClick(() => this.applyEmoji(file.path, "")),
			);
		}
	}

	private openEmojiModal(file: TAbstractFile, kind: ItemKind): void {
		const current = this.store.get(file.path) ?? "";
		new EmojiModal(this.app, {
			title: `${current === "" ? "Set" : "Change"} ${kind} emoji`,
			description: `Choose an emoji for “${file.name}”.`,
			current,
			onSubmit: (emoji) => this.applyEmoji(file.path, emoji),
		}).open();
	}

	// ------------------------------------------------------------------ commands

	private removeEmojiFromActiveNote(file: TAbstractFile): void {
		if (!this.applyEmoji(file.path, "")) {
			new Notice(`Notemoji: “${file.name}” has no emoji.`);
		}
	}

	// ------------------------------------------------------------------ data

	private applyEmoji(path: string, emoji: string): boolean {
		try {
			const changed = emoji === "" ? this.store.remove(path) : this.store.set(path, emoji);
			if (!changed) return false;

			this.persist();
			this.renderer.scheduleSync();
			return true;
		} catch (error) {
			console.error(`[notemoji] Could not update the emoji of “${path}”.`, error);
			new Notice("Notemoji could not update the emoji. Please check the developer console.");
			return false;
		}
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		try {
			if (!this.store.rename(oldPath, file.path)) return;
		} catch (error) {
			console.error(`[notemoji] Could not move the emoji from “${oldPath}”.`, error);
			return;
		}

		this.persist();
		this.renderer.scheduleSync();
	}

	private handleDelete(file: TAbstractFile): void {
		try {
			if (!this.store.removeTree(file.path)) return;
		} catch (error) {
			console.error(`[notemoji] Could not clean up the emoji of “${file.path}”.`, error);
			return;
		}

		this.persist();
		this.renderer.scheduleSync();
	}

	private async loadStore(): Promise<IconStore> {
		let raw: unknown = null;
		try {
			raw = (await this.loadData()) as unknown;
		} catch (error) {
			console.error("[notemoji] Could not read the plugin data file; starting without icons.", error);
		}
		return IconStore.fromData(raw);
	}

	private persist(): void {
		const snapshot = this.store.toData();
		this.saveQueue = this.saveQueue
			.then(() => this.saveData(snapshot))
			.catch((error: unknown) => {
				console.error("[notemoji] Could not save icons.", error);
				new Notice("Notemoji could not save the emoji. Please check the developer console.");
			});
	}
}
