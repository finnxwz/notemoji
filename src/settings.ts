import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { NoteTitleMode } from "./icons/data";
import { ICON_PROPERTY } from "./icons/icon-service";
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
					.onChange((value) => {
						settings.noteTitle = value as NoteTitleMode;
						plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Emoji in tab titles").addToggle((toggle) =>
			toggle.setValue(settings.showInTabs).onChange((value) => {
				settings.showInTabs = value;
				plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("Emoji in view header title")
			.setDesc("The title in the bar at the top of each tab.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showInViewHeader).onChange((value) => {
					settings.showInViewHeader = value;
					plugin.saveSettings();
				}),
			);

		this.displayStoredData(containerEl);
	}

	private displayStoredData(containerEl: HTMLElement): void {
		const { icons } = this.plugin;
		new Setting(containerEl).setName("Stored emoji").setHeading();

		const legacy = icons.notesInData().length;
		if (legacy > 0) {
			new Setting(containerEl)
				.setName("Move note emoji to frontmatter")
				.setDesc(
					`${plural(legacy, "note keeps its", "notes keep their")} emoji in the plugin data from an earlier version. ` +
						`This writes each one into the note's "${ICON_PROPERTY}" property, so it stays with the note.`,
				)
				.addButton((button) =>
					button
						.setButtonText(`Move ${legacy}`)
						.setCta()
						.onClick(async () => {
							button.setDisabled(true);
							try {
								const { moved, skipped } = await icons.moveNotesToFrontmatter();
								let message = `Moved ${plural(moved, "emoji", "emoji")} to frontmatter.`;
								if (skipped > 0) {
									message += ` ${plural(skipped, "note was", "notes were")} skipped because "${ICON_PROPERTY}" already holds something else.`;
								}
								new Notice(message);
							} catch (error) {
								console.error(
									"[notemoji] Could not move emoji to frontmatter.",
									error,
								);
								new Notice(
									"Some emoji could not be moved. A note may have invalid frontmatter.",
								);
							}
							this.display();
						}),
				);
		}

		const missing = icons.missingPaths().length;
		new Setting(containerEl)
			.setName("Remove emoji of missing files")
			.setDesc(
				missing === 0
					? "Emoji of deleted folders and files are kept, so they come back after a restore or sync. Nothing to clean up right now."
					: `${plural(missing, "emoji belongs", "emoji belong")} to folders or files that no longer exist. ` +
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
