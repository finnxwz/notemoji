import { Notice, PluginSettingTab, Setting } from "obsidian";
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

		this.displayStoredData(containerEl);
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
