import { Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { confirm } from "./confirm-modal";
import { FileExplorerRenderer } from "./display/file-explorer";
import type { IconSource } from "./display/icon-source";
import { TitleDecorations } from "./display/titles";
import { NotemojiSettings, parseData, PluginData, serializeData } from "./icons/data";
import { CustomIconLibrary } from "./icons/custom-icons";
import { EmojiFonts } from "./icons/emoji-font";
import type { EmojiSet } from "./icons/emoji-sets";
import { IconService, isNote } from "./icons/icon-service";
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
	customIcons!: CustomIconLibrary;
	emojiFonts!: EmojiFonts;
	private data!: PluginData;
	private explorer!: FileExplorerRenderer;
	private titles!: TitleDecorations;
	private titleTimer: number | null = null;

	/** Serialised save queue; a newer snapshot is never overwritten by an older one. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		this.data = parseData(await this.readData());
		this.icons = new IconService(this.app, this.data, () => this.persist());

		const pluginFolder =
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.customIcons = new CustomIconLibrary(
			this.app.vault.adapter,
			normalizePath(`${pluginFolder}/icons`),
		);
		this.emojiFonts = new EmojiFonts(
			this.app.vault.adapter,
			normalizePath(`${pluginFolder}/fonts`),
		);
		this.emojiFonts.attach(document);

		const source: IconSource = {
			get: (path) => this.icons.get(path),
			url: (file) => this.customIcons.url(file),
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
		this.emojiFonts?.unload();
		this.explorer?.dispose();
		this.titles?.dispose();
	}

	/** Reloads data.json after it was changed on disk, e.g. by sync. */
	async onExternalSettingsChange(): Promise<void> {
		// A save still in flight must not land after (and over) the reloaded data.
		await this.saveQueue;
		// Sync may also have brought new custom icon files.
		this.customIcons.refresh();
		const data = parseData(await this.readData());
		if (JSON.stringify(serializeData(data)) === JSON.stringify(serializeData(this.data)))
			return;
		const fontChanged =
			data.settings.emojiStyle !== this.data.settings.emojiStyle ||
			data.settings.emojiFont !== this.data.settings.emojiFont;
		this.data = data;
		this.icons.replaceData(data);
		if (fontChanged) await this.loadEmojiFont();
	}

	/** Changes settings, saves and re-renders. Always edits the current data, also after a reload. */
	updateSettings(patch: Partial<NotemojiSettings>): void {
		Object.assign(this.data.settings, patch);
		this.persist();
		this.refresh();
	}

	private initialize(): void {
		this.explorer.attach();
		this.scheduleTitleSync();
		void this.loadEmojiFont();
	}

	// ------------------------------------------------------------------ emoji font

	/** Applies the chosen emoji style; a file missing on this device means system emoji. */
	async loadEmojiFont(): Promise<void> {
		const { emojiStyle, emojiFont } = this.data.settings;
		await this.emojiFonts.apply(emojiStyle, emojiFont);
	}

	async setEmojiStyle(style: string): Promise<void> {
		this.updateSettings({ emojiStyle: style });
		await this.loadEmojiFont();
	}

	/** Downloads a set (only ever on the user's request) and uses it if it is selected. */
	async downloadEmojiSet(set: EmojiSet): Promise<void> {
		await this.emojiFonts.download(set);
		if (this.data.settings.emojiStyle === set.id) await this.loadEmojiFont();
	}

	/** Deletes a downloaded set; deleting the active one switches to system emoji. */
	async deleteEmojiSet(set: EmojiSet): Promise<void> {
		await this.emojiFonts.deleteSet(set);
		if (this.data.settings.emojiStyle === set.id) await this.setEmojiStyle("system");
	}

	/** Installs your own font file and uses it. Throws with a message for the user. */
	async setOwnEmojiFont(name: string, data: ArrayBuffer): Promise<void> {
		const file = await this.emojiFonts.installOwn(name, data);
		this.updateSettings({ emojiStyle: "file", emojiFont: file });
		await this.loadEmojiFont();
	}

	/** Deletes your own font file and switches back to the system's emoji. */
	async removeOwnEmojiFont(): Promise<void> {
		await this.emojiFonts.removeOwn();
		this.updateSettings({ emojiStyle: "system", emojiFont: "" });
		await this.loadEmojiFont();
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
			workspace.on("window-open", (_window, win) => this.emojiFonts.attach(win.document)),
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
		const current = this.icons.get(file.path) ?? "";
		new PickerModal(this.app, {
			title: `${current === "" ? "Set" : "Change"} ${describeItem(file)} emoji`,
			description: file.name,
			current,
			recent: this.icons.recent,
			custom: {
				list: () => this.customIcons.list(),
				url: (name) => this.customIcons.url(name),
				upload: (name, data) => this.customIcons.add(name, data),
				remove: (name) => this.deleteCustomIcon(name),
			},
			onSubmit: (emoji) => {
				if (emoji === "") this.icons.removeIcon(file);
				else if (this.icons.setIcon(file, emoji)) this.icons.rememberRecent(emoji);
			},
		}).open();
	}

	/** Deletes a custom icon after confirmation; items using it lose their icon. */
	async deleteCustomIcon(file: string): Promise<boolean> {
		const uses = this.icons.countCustomUses(file);
		const confirmed = await confirm(this.app, {
			title: "Delete custom icon?",
			message:
				uses === 0
					? `"${file}" will be deleted.`
					: `"${file}" will be deleted. ${uses === 1 ? "1 item uses" : `${uses} items use`} it and will show no icon anymore.`,
			confirmText: "Delete",
			warning: true,
		});
		if (!confirmed) return false;
		try {
			await this.customIcons.remove(file);
		} catch (error) {
			console.error(`[notemoji] Could not delete the custom icon "${file}".`, error);
			new Notice(`Could not delete "${file}".`);
			return false;
		}
		this.icons.forgetCustomIcons([file]);
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
