import { Notice, PluginSettingTab, Setting } from "obsidian";
import { confirm } from "./confirm-modal";
import { formatBytes } from "./icons/custom-icons";
import { FONT_EXTENSIONS } from "./icons/icon-value";
import type { NoteTitleMode } from "./icons/data";
import type NotemojiPlugin from "./main";

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export class NotemojiSettingTab extends PluginSettingTab {
	private readonly plugin: NotemojiPlugin;

	constructor(plugin: NotemojiPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl, plugin } = this;
		const { icons } = plugin;
		const settings = icons.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Emoji at note title")
			.setDesc(
				"Shown in the editing and reading view while the inline title is turned on in the appearance settings.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("above", "Large, above the title")
					.addOption("inline", "Inline, before the title")
					.addOption("off", "Off")
					.setValue(settings.noteTitle)
					.onChange((value) =>
						plugin.updateSettings({ noteTitle: value as NoteTitleMode }),
					),
			);

		new Setting(containerEl)
			.setName("Emoji in tab titles")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showInTabs)
					.onChange((value) => plugin.updateSettings({ showInTabs: value })),
			);

		new Setting(containerEl)
			.setName("Emoji in view header title")
			.setDesc("The title in the bar at the top of each tab.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showInViewHeader)
					.onChange((value) => plugin.updateSettings({ showInViewHeader: value })),
			);

		this.displayEmojiStyle(containerEl);
		this.displayCustomIcons(containerEl);
		this.displayStoredData(containerEl);
	}

	private displayEmojiStyle(containerEl: HTMLElement): void {
		const { plugin } = this;
		const font = plugin.icons.settings.emojiFont;
		new Setting(containerEl).setName("Emoji style").setHeading();

		const fileInput = containerEl.createEl("input", {
			cls: "notemoji-hidden-input",
			attr: {
				type: "file",
				accept: FONT_EXTENSIONS.map((extension) => `.${extension}`).join(","),
			},
		});
		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			fileInput.value = "";
			if (!file) return;
			void file
				.arrayBuffer()
				.then((data) => plugin.setEmojiFont(file.name, data))
				.then(
					() => new Notice(`Notemoji now uses "${file.name}" for its emoji.`),
					(error: unknown) =>
						new Notice(
							error instanceof Error ? error.message : "Could not use this font.",
						),
				)
				.finally(() => this.display());
		});

		const setting = new Setting(containerEl)
			.setName("Emoji font")
			.setDesc(
				font === ""
					? "Uses your system's emoji. Choose a font file (TTF, OTF, WOFF or WOFF2) to show Notemoji's emoji in another style. Emoji in your notes are not affected."
					: `Uses "${font}" for Notemoji's emoji. Emoji the font does not contain are shown with your system's emoji. Emoji in your notes are not affected.`,
			)
			.addButton((button) =>
				button
					.setButtonText(font === "" ? "Choose font" : "Change font")
					.onClick(() => fileInput.click()),
			);
		if (font !== "") {
			setting.addButton((button) =>
				button.setButtonText("Use system emoji").onClick(async () => {
					try {
						await plugin.clearEmojiFont();
					} catch (error) {
						console.error("[notemoji] Could not remove the emoji font.", error);
						new Notice("Could not remove the emoji font.");
					}
					this.display();
				}),
			);
		}
	}

	private displayCustomIcons(containerEl: HTMLElement): void {
		const { plugin } = this;
		new Setting(containerEl).setName("Custom icons").setHeading();

		const setting = new Setting(containerEl)
			.setName("Your icons")
			.setDesc("Upload your own images (PNG, SVG and more) in the picker's custom section.");
		setting.addButton((button) => {
			button
				.setButtonText("Delete all")
				.setWarning()
				.setDisabled(true)
				.onClick(async () => {
					const { count } = await plugin.customIcons.usage();
					const confirmed = await confirm(plugin.app, {
						title: "Delete all custom icons?",
						message: `All ${plural(count, "custom icon", "custom icons")} will be deleted. Notes, folders and files using them will show no icon anymore.`,
						confirmText: "Delete all",
						warning: true,
					});
					if (!confirmed) return;
					try {
						await plugin.customIcons.removeAll();
						plugin.icons.forgetCustomIcons();
						new Notice("Deleted all custom icons.");
					} catch (error) {
						console.error("[notemoji] Could not delete the custom icons.", error);
						new Notice("Could not delete the custom icons.");
					}
					this.display();
				});

			void plugin.customIcons.usage().then(
				({ count, bytes }) => {
					if (count === 0) return;
					setting.setDesc(
						`${plural(count, "icon", "icons")}, ${formatBytes(bytes)}, stored in "${plugin.customIcons.folder}". ` +
							"They are removed together with the plugin. Upload more in the picker.",
					);
					button.setDisabled(false);
				},
				(error: unknown) =>
					console.error("[notemoji] Could not read the custom icons.", error),
			);
		});
	}

	private displayStoredData(containerEl: HTMLElement): void {
		const { icons } = this.plugin;
		new Setting(containerEl).setName("Stored emoji").setHeading();

		const missing = icons.missingPaths().length;
		new Setting(containerEl)
			.setName("Remove emoji of missing files")
			.setDesc(
				missing === 0
					? "Emoji of deleted notes, folders and files are kept, so they come back after a restore or sync. Nothing to clean up right now."
					: `${plural(missing, "emoji belongs", "emoji belong")} to notes, folders or files that no longer exist. ` +
							"They are kept on purpose, so they come back after a restore or sync.",
			)
			.addButton((button) =>
				button
					.setButtonText(missing === 0 ? "Remove" : `Remove ${missing}`)
					.setWarning()
					.setDisabled(missing === 0)
					.onClick(() => {
						const removed = icons.removeMissing();
						new Notice(`Removed ${plural(removed, "emoji", "emoji")}.`);
						this.display();
					}),
			);
	}
}
