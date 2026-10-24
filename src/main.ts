import { Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { confirm } from "./confirm-modal";
import type { NotemojiSettings, PluginData } from "./data";
import { DataFile } from "./data-file";
import { ExplorerSource, FileExplorerRenderer } from "./display/file-explorer";
import { TitleDecorations } from "./display/titles";
import { canvasCodec } from "./icons/canvas-codec";
import { CustomIconError, CustomIconLibrary, StoredIcon } from "./icons/custom-icons";
import { IconService, isNote } from "./icons/icon-service";
import { prepareIcon } from "./icons/prepare-icon";
import { PickerModal } from "./picker/picker-modal";
import { NotemojiSettingTab } from "./settings/settings-tab";
import { EmojiStyle } from "./style/emoji-style";

/** Coalescing window for title updates (ms); workspace events come in bursts. */
const TITLE_SYNC_DELAY_MS = 30;

/** How an item is called in menus. */
function describeItem(file: TAbstractFile): "note" | "file" | "folder" {
	if (file instanceof TFolder) return "folder";
	return isNote(file) ? "note" : "file";
}

export default class NotemojiPlugin extends Plugin {
	icons!: IconService;
	customIcons!: CustomIconLibrary;
	/** The emoji font and the picker's pre-rendered emoji. */
	style!: EmojiStyle;
	/** The current settings; change them with `updateSettings`. Always those of the current data. */
	declare settings: Readonly<NotemojiSettings>;
	/** data.json: loading, saving, reloading after sync, backup. */
	private file!: DataFile;
	private explorer!: FileExplorerRenderer;
	private titles!: TitleDecorations;
	private titleTimer: number | null = null;

	async onload(): Promise<void> {
		const pluginFolder =
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.file = new DataFile({
			adapter: this.app.vault.adapter,
			dataPath: normalizePath(`${pluginFolder}/data.json`),
			backupPath: normalizePath(`${pluginFolder}/backup.json`),
			loadData: () => this.loadData() as Promise<unknown>,
			saveData: (data) => this.saveData(data),
			onReplaced: (data, previous) => this.showReplaced(data, previous),
		});
		await this.file.load();
		// `Plugin` declares `settings` as a field, so it can't be overridden by a getter.
		Object.defineProperty(this, "settings", { get: () => this.data.settings });
		this.icons = new IconService(this.app, this.data, () => this.persist());
		this.customIcons = new CustomIconLibrary(
			() => this.data.customIcons,
			() => this.persist(),
			() => Object.keys(this.data.unknown.customIcons),
		);

		this.style = new EmojiStyle(this.app.vault.adapter, pluginFolder, {
			get: () => this.data.settings,
			update: (patch) => this.updateSettings(patch),
		});
		this.style.fonts.attach(document);

		const source: ExplorerSource = {
			get: (path) => this.icons.get(path),
			entries: () => this.icons.entries(),
			url: (id) => this.customIcons.url(id),
		};
		this.explorer = new FileExplorerRenderer(this.app, source);
		this.titles = new TitleDecorations(this.app, source, (file) => this.openPicker(file));
		this.register(this.icons.onChange(() => this.refresh()));

		this.addSettingTab(new NotemojiSettingTab(this));
		this.registerCommands();
		this.registerEvents();
		this.app.workspace.onLayoutReady(() => this.initialize());
	}

	onunload(): void {
		if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
		this.file?.unload();
		this.style?.unload();
		this.explorer?.dispose();
		this.titles?.dispose();
		this.customIcons?.dispose();
	}

	/** The current data (data.json may be reloaded, so never keep a reference). */
	private get data(): PluginData {
		return this.file.data;
	}

	/** Reloads data.json after it was changed on disk, e.g. by sync. */
	async onExternalSettingsChange(): Promise<void> {
		await this.file.reload();
	}

	/** Shows data that replaced what was shown (read from disk after sync). */
	private async showReplaced(data: PluginData, previous: PluginData): Promise<void> {
		// Before onload finished (a repair at startup), nothing is shown yet.
		if (!this.icons) return;
		this.icons.replaceData(data);
		// Icons removed or replaced on another device.
		this.customIcons.releaseStale();
		if (
			data.settings.emojiStyle !== previous.settings.emojiStyle ||
			data.settings.emojiFont !== previous.settings.emojiFont
		) {
			await this.style.load();
		}
	}

	/** Changes settings, saves and re-renders. Always edits the current data, also after a reload. */
	updateSettings(patch: Partial<NotemojiSettings>): void {
		Object.assign(this.data.settings, patch);
		// A value kept for a newer version is replaced by what was chosen here.
		for (const key of Object.keys(patch)) delete this.data.unknown.settings[key];
		this.persist();
		this.refresh();
	}

	private initialize(): void {
		this.explorer.attach();
		this.scheduleTitleSync();
		this.style.start();
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
		// Pop-out windows need the emoji font too.
		this.registerEvent(
			workspace.on("window-open", (_window, win) => this.style.fonts.attach(win.document)),
		);
		this.registerEvent(
			workspace.on("window-close", (_window, win) => this.style.fonts.detach(win.document)),
		);
		this.registerEvent(workspace.on("file-open", () => this.scheduleTitleSync()));

		this.registerEvent(
			vault.on("rename", (file, oldPath) => this.icons.handleRename(file, oldPath)),
		);
		// The reading view may re-render a note's title when the note changes.
		this.registerEvent(metadataCache.on("changed", () => this.scheduleTitleSync()));

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
				if (!checking) this.icons.removeIcon(file);
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
					.onClick(() => this.icons.removeIcon(file)),
			);
		}
	}

	// ------------------------------------------------------------------ actions

	openPicker(file: TAbstractFile): void {
		// Opened before the startup preparation ran: start it now.
		this.style.warmUp();
		const current = this.icons.get(file.path) ?? "";
		new PickerModal(this.app, {
			title: `${current === "" ? "Set" : "Change"} ${describeItem(file)} emoji`,
			description: file.name,
			current,
			recent: this.icons.recent,
			sprites: this.style.sprites,
			custom: {
				list: () => Promise.resolve(this.customIcons.list()),
				url: (id) => this.customIcons.url(id),
				upload: (fileName, data) => this.uploadCustomIcon(fileName, data),
				remove: (id) => this.deleteCustomIcon(id),
			},
			onSubmit: (emoji) => {
				if (emoji === "") this.icons.removeIcon(file);
				else if (this.icons.setIcon(file, emoji)) this.icons.rememberRecent(emoji);
			},
		}).open();
	}

	/**
	 * Turns an uploaded file into a custom icon and returns its name. Throws
	 * with a message for the user when the image can't be used.
	 */
	async uploadCustomIcon(fileName: string, data: ArrayBuffer): Promise<string> {
		let icon: StoredIcon;
		try {
			icon = await prepareIcon(fileName, new Uint8Array(data), canvasCodec);
		} catch (error) {
			if (error instanceof CustomIconError) throw error;
			console.error(`[notemoji] Could not convert "${fileName}".`, error);
			throw new CustomIconError(`"${fileName}" could not be converted on this device.`);
		}
		const { id, existing } = this.customIcons.add(fileName, icon);
		if (existing) new Notice(`"${fileName}" is already one of your icons, as "${id}".`);
		return id;
	}

	/** Deletes a custom icon after confirmation; items using it lose their icon. */
	async deleteCustomIcon(id: string): Promise<boolean> {
		const uses = this.icons.countCustomUses(id);
		const confirmed = await confirm(this.app, {
			title: "Delete custom icon?",
			message:
				uses === 0
					? `"${id}" will be deleted.`
					: `"${id}" will be deleted. ${uses === 1 ? "1 item uses" : `${uses} items use`} it and will show no icon anymore.`,
			confirmText: "Delete",
			warning: true,
		});
		if (!confirmed) return false;
		this.customIcons.remove(id);
		this.icons.forgetCustomIcons([id]);
		return true;
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
				this.titles.sync(this.data.settings);
			} catch (error) {
				console.error("[notemoji] Could not render title emoji.", error);
			}
		}, TITLE_SYNC_DELAY_MS);
	}

	private persist(): void {
		this.file.save();
	}
}
