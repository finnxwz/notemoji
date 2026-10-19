import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { confirm } from "./confirm-modal";
import { FileExplorerRenderer } from "./display/file-explorer";
import { TitleDecorations } from "./display/titles";
import { NotemojiSettings, parseData, PluginData, serializeData } from "./icons/data";
import { ICON_PROPERTY, IconService, isNote } from "./icons/icon-service";
import { PickerModal } from "./picker/picker-modal";
import { NotemojiSettingTab } from "./settings";

/** Coalescing window for title updates (ms); workspace events come in bursts. */
const TITLE_SYNC_DELAY_MS = 30;

/** How an item is called in menus. */
function describeItem(file: TAbstractFile): "note" | "file" | "folder" {
	if (file instanceof TFolder) return "folder";
	return isNote(file) ? "note" : "file";
}

export default class NotemojiPlugin extends Plugin {
	icons!: IconService;
	private data!: PluginData;
	private explorer!: FileExplorerRenderer;
	private titles!: TitleDecorations;
	private titleTimer: number | null = null;

	/** Serialised save queue; a newer snapshot is never overwritten by an older one. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		this.data = parseData(await this.readData());
		this.icons = new IconService(this.app, this.data, {
			save: () => this.persist(),
			confirmReplace: (file, current) =>
				confirm(this.app, {
					title: "Replace icon property?",
					message: `The "${ICON_PROPERTY}" property of "${file.basename}" is "${String(current)}", which is not an emoji. It may belong to another plugin. Replace it?`,
					confirmText: "Replace",
					warning: true,
				}),
		});

		const lookup = (path: string) => this.icons.get(path);
		this.explorer = new FileExplorerRenderer(this.app, lookup);
		this.titles = new TitleDecorations(this.app, lookup, (file) => this.openPicker(file));
		this.register(this.icons.onChange(() => this.refresh()));

		this.addSettingTab(new NotemojiSettingTab(this));
		this.registerCommands();
		this.registerEvents();
		this.app.workspace.onLayoutReady(() => this.initialize());
	}

	onunload(): void {
		if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
		this.explorer?.dispose();
		this.titles?.dispose();
	}

	/** Reloads data.json after it was changed on disk, e.g. by sync. */
	async onExternalSettingsChange(): Promise<void> {
		// A save still in flight must not land after (and over) the reloaded data.
		await this.saveQueue;
		const data = parseData(await this.readData());
		if (JSON.stringify(serializeData(data)) === JSON.stringify(serializeData(this.data)))
			return;
		this.data = data;
		this.icons.replaceData(data);
	}

	/** Changes settings, saves and re-renders. Always edits the current data, also after a reload. */
	updateSettings(patch: Partial<NotemojiSettings>): void {
		Object.assign(this.data.settings, patch);
		this.persist();
		this.refresh();
	}

	private initialize(): void {
		this.icons.indexNotes();
		this.explorer.attach();
		this.scheduleTitleSync();

		// In a vault opened for the first time, the metadata cache may still be
		// indexing. Read every note once more when it is complete.
		const ref = this.app.metadataCache.on("resolved", () => {
			this.app.metadataCache.offref(ref);
			this.icons.indexNotes();
		});
		this.registerEvent(ref);
	}

	// ------------------------------------------------------------------ wiring

	private registerEvents(): void {
		const { workspace, vault, metadataCache } = this.app;

		// The file explorer may be closed, moved or re-created at any time, and
		// tabs, views and their titles change with the layout.
		this.registerEvent(
			workspace.on("layout-change", () => {
				this.explorer.attach();
				this.scheduleTitleSync();
			}),
		);
		this.registerEvent(workspace.on("active-leaf-change", () => this.scheduleTitleSync()));
		this.registerEvent(workspace.on("file-open", () => this.scheduleTitleSync()));

		this.registerEvent(
			vault.on("rename", (file, oldPath) => this.icons.handleRename(file, oldPath)),
		);
		this.registerEvent(vault.on("delete", (file) => this.icons.handleDelete(file)));
		this.registerEvent(
			metadataCache.on("changed", (file) => {
				this.icons.handleMetadataChange(file);
				// The reading view may have re-rendered the note's title.
				this.scheduleTitleSync();
			}),
		);

		this.registerEvent(
			workspace.on("file-menu", (menu, file) => this.addMenuItems(menu, file)),
		);
	}

	private registerCommands(): void {
		this.addCommand({
			id: "set-emoji-active-note",
			name: "Set emoji for current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.openPicker(file);
				return true;
			},
		});
		this.addCommand({
			id: "remove-emoji-active-note",
			name: "Remove emoji from current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || this.icons.get(file.path) === undefined) return false;
				if (!checking) void this.removeEmoji(file);
				return true;
			},
		});
	}

	private addMenuItems(menu: Menu, file: TAbstractFile): void {
		if (!(file instanceof TFile) && !(file instanceof TFolder)) return;

		const kind = describeItem(file);
		const hasEmoji = this.icons.get(file.path) !== undefined;

		menu.addItem((item) =>
			item
				.setTitle(`${hasEmoji ? "Change" : "Set"} ${kind} emoji`)
				.setIcon(hasEmoji ? "smile-plus" : "smile")
				.onClick(() => this.openPicker(file)),
		);
		if (hasEmoji) {
			menu.addItem((item) =>
				item
					.setTitle(`Remove ${kind} emoji`)
					.setIcon("eraser")
					.onClick(() => void this.removeEmoji(file)),
			);
		}
	}

	// ------------------------------------------------------------------ actions

	openPicker(file: TAbstractFile): void {
		const current = this.icons.get(file.path) ?? "";
		new PickerModal(this.app, {
			title: `${current === "" ? "Set" : "Change"} ${describeItem(file)} emoji`,
			description: file.name,
			current,
			recent: this.icons.recent,
			onSubmit: (emoji) =>
				void (emoji === "" ? this.removeEmoji(file) : this.setEmoji(file, emoji)),
		}).open();
	}

	private async setEmoji(file: TAbstractFile, emoji: string): Promise<void> {
		try {
			if (await this.icons.setIcon(file, emoji)) this.icons.rememberRecent(emoji);
		} catch (error) {
			this.reportWriteError(file, error);
		}
	}

	private async removeEmoji(file: TAbstractFile): Promise<void> {
		try {
			await this.icons.removeIcon(file);
		} catch (error) {
			this.reportWriteError(file, error);
		}
	}

	private reportWriteError(file: TAbstractFile, error: unknown): void {
		console.error(`[notemoji] Could not update the emoji of "${file.path}".`, error);
		new Notice(
			isNote(file)
				? `Could not update the emoji of "${file.name}". Its frontmatter may be invalid.`
				: `Could not update the emoji of "${file.name}".`,
		);
	}

	// ------------------------------------------------------------------ rendering & data

	private refresh(): void {
		this.explorer.scheduleSync();
		this.scheduleTitleSync();
	}

	private scheduleTitleSync(): void {
		if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
		this.titleTimer = window.setTimeout(() => {
			this.titleTimer = null;
			try {
				this.titles.sync(this.icons.settings);
			} catch (error) {
				console.error("[notemoji] Could not render title emoji.", error);
			}
		}, TITLE_SYNC_DELAY_MS);
	}

	private async readData(): Promise<unknown> {
		try {
			return (await this.loadData()) as unknown;
		} catch (error) {
			console.error("[notemoji] Could not read data.json; starting without it.", error);
			return null;
		}
	}

	private persist(): void {
		const snapshot = serializeData(this.data);
		this.saveQueue = this.saveQueue
			.then(() => this.saveData(snapshot))
			.catch((error: unknown) => {
				console.error("[notemoji] Could not save data.json.", error);
				new Notice("Could not save the emoji. Please check the developer console.");
			});
	}
}
