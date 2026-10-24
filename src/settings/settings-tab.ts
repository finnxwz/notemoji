import { addIcon, Notice, PluginSettingTab, Setting } from "obsidian";
import { confirm } from "../confirm-modal";
import type { NoteTitleMode } from "../data";
import type NotemojiPlugin from "../main";
import { CustomIconsSection } from "./custom-icons-section";
import { EmojiStyleSection } from "./emoji-style-section";
import { formatBytes, plural } from "../format";

/** Icon of the settings tab: a real, colourful emoji instead of a line icon. */
const SETTINGS_ICON = "notemoji-emoji";
const SETTINGS_ICON_SVG =
	'<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-size="86" ' +
	"style=\"stroke: none; fill: currentColor; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif\">" +
	"😀</text>";

export class NotemojiSettingTab extends PluginSettingTab {
	private readonly plugin: NotemojiPlugin;

	constructor(plugin: NotemojiPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
		// The icon next to the tab in the settings sidebar. `SettingTab.icon` exists
		// since Obsidian 1.11; older versions simply ignore the property.
		addIcon(SETTINGS_ICON, SETTINGS_ICON_SVG);
		Reflect.set(this, "icon", SETTINGS_ICON);
	}

	display(): void {
		const { containerEl, plugin } = this;
		const { settings } = plugin;
		containerEl.empty();

		new Setting(containerEl).setName("Display").setHeading();
		new Setting(containerEl)
			.setName("Emoji at note title")
			.setDesc("Shown while the inline title is on (appearance settings).")
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

		new Setting(containerEl)
			.setName("Automatic emoji for new notes")
			.setDesc(
				"Give each new note an emoji that fits its name or folder, with a bit of chance so notes next to each other differ. Your own emoji always win.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.autoEmoji)
					.onChange((value) => plugin.updateSettings({ autoEmoji: value })),
			);

		this.displayEmojiStyle(containerEl);
		this.displayCustomIcons(containerEl);
		this.displayStoredData(containerEl);
	}

	private displayEmojiStyle(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Emoji style").setHeading();
		new EmojiStyleSection(this.plugin, containerEl);
	}

	private displayCustomIcons(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Custom icons").setHeading();
		new CustomIconsSection(this.plugin, containerEl);
	}

	private displayStoredData(containerEl: HTMLElement): void {
		const { icons } = this.plugin;
		const { spriteCache } = this.plugin.style;
		new Setting(containerEl).setName("Maintenance").setHeading();

		const cacheSetting = new Setting(containerEl)
			.setName("Picker image cache")
			.setDesc(
				"Pre-rendered emoji for each style, so the picker opens and scrolls smoothly. Removed with the plugin.",
			);
		cacheSetting.addButton((button) => {
			button
				.setButtonText("Clear")
				.setDisabled(true)
				.onClick(async () => {
					try {
						await spriteCache.clear();
					} catch (error) {
						console.error("[notemoji] Could not clear the picker image cache.", error);
					}
					this.display();
				});
			void spriteCache.size().then(
				(bytes) => {
					if (bytes === 0) return;
					cacheSetting.setDesc(
						`${formatBytes(bytes)} of pre-rendered emoji for each style, so the picker opens and scrolls smoothly. They are drawn again when needed and removed with the plugin.`,
					);
					button.setDisabled(false);
				},
				(error: unknown) =>
					console.error("[notemoji] Could not read the picker image cache.", error),
			);
		});

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
					.onClick(async () => {
						const confirmed = await confirm(this.plugin.app, {
							title: "Remove emoji of missing files?",
							message: `${plural(missing, "emoji", "emoji")} of notes, folders or files that no longer exist will be removed. They won't come back if the items are restored or synced later.`,
							confirmText: "Remove",
							warning: true,
						});
						if (!confirmed) return;
						const removed = icons.removeMissing();
						new Notice(`Removed ${plural(removed, "emoji", "emoji")}.`);
						this.display();
					}),
			);
	}
}
