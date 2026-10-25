import {
	addIcon,
	Notice,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
	type SettingDropdownControl,
	type SettingToggleControl,
} from "obsidian";
import { confirm } from "../confirm-modal";
import type { NoteTitleMode } from "../data";
import type NotemojiPlugin from "../main";
import { CustomIconsSection } from "./custom-icons-section";
import { EmojiStyleSection } from "./emoji-style-section";
import { EMOJI_SETS } from "../style/emoji-sets";
import { formatBytes, plural } from "../format";
import { setDestructive } from "../internals";

/** Icon of the settings tab: a real, colourful emoji instead of a line icon. */
const SETTINGS_ICON = "notemoji-emoji";
const SETTINGS_ICON_SVG =
	'<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-size="86" ' +
	"style=\"stroke: none; fill: currentColor; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif\">" +
	"😀</text>";

const CACHE_DESC =
	"Pre-rendered emoji for each style, so the picker opens and scrolls smoothly. Removed with the plugin.";

/** The settings changed with a toggle or a dropdown. */
const CONTROL_KEYS = [
	"noteTitle",
	"showInTabs",
	"showInViewHeader",
	"showInLinks",
	"autoEmoji",
] as const;
type ControlKey = (typeof CONTROL_KEYS)[number];

const NOTE_TITLE_OPTIONS: Readonly<Record<NoteTitleMode, string>> = {
	above: "Large, above the title",
	inline: "Inline, before the title",
	off: "Off",
};

function isControlKey(key: string): key is ControlKey {
	return (CONTROL_KEYS as readonly string[]).includes(key);
}

interface RowBase {
	name: string;
	desc?: string;
	/** More words the settings search finds the row by. */
	aliases?: string[];
}

/** A row of the tab: a setting with a toggle or dropdown, or one drawn by Notemoji. */
type Row =
	| (RowBase & { control: SettingToggleControl<ControlKey> | SettingDropdownControl<ControlKey> })
	| (RowBase & { render: (setting: Setting) => void });

interface Group {
	heading: string;
	rows: Row[];
}

/**
 * Notemoji's settings tab. Obsidian 1.13 builds it from setting definitions,
 * which also put every setting into its settings search; older versions call
 * `display()`, which draws the same rows itself.
 */
export class NotemojiSettingTab extends PluginSettingTab {
	private readonly plugin: NotemojiPlugin;
	/** The custom icons as drawn last; their uses change when emoji are removed here. */
	private customIcons: CustomIconsSection | null = null;

	constructor(plugin: NotemojiPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
		// The icon next to the tab in the settings sidebar. `SettingTab.icon` exists
		// since Obsidian 1.11; older versions simply ignore the property.
		addIcon(SETTINGS_ICON, SETTINGS_ICON_SVG);
		Reflect.set(this, "icon", SETTINGS_ICON);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.groups().map(({ heading, rows }) => ({ type: "group", heading, items: rows }));
	}

	getControlValue(key: string): unknown {
		return isControlKey(key) ? this.plugin.settings[key] : undefined;
	}

	/** Through the plugin, which saves all of data.json and shows the change right away. */
	setControlValue(key: string, value: unknown): void {
		if (!isControlKey(key)) return;
		// As stored: a boolean from a toggle, one of the options from the dropdown.
		if (typeof value !== typeof this.plugin.settings[key]) return;
		if (key === "noteTitle" && !Object.hasOwn(NOTE_TITLE_OPTIONS, String(value))) return;
		this.plugin.updateSettings({ [key]: value });
	}

	/** Before Obsidian 1.13 (deprecated since): the rows of `groups()`, drawn here. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const group of this.groups()) {
			new Setting(containerEl).setName(group.heading).setHeading();
			for (const row of group.rows) {
				const setting = new Setting(containerEl).setName(row.name);
				if (row.desc !== undefined) setting.setDesc(row.desc);
				if ("render" in row) row.render(setting);
				else this.addControl(setting, row.control);
			}
		}
	}

	private addControl(
		setting: Setting,
		control: SettingToggleControl<ControlKey> | SettingDropdownControl<ControlKey>,
	): void {
		const value = this.getControlValue(control.key);
		const change = (next: unknown) => this.setControlValue(control.key, next);
		if (control.type === "toggle") {
			setting.addToggle((toggle) => toggle.setValue(value === true).onChange(change));
		} else {
			setting.addDropdown((dropdown) =>
				dropdown.addOptions(control.options).setValue(String(value)).onChange(change),
			);
		}
	}

	private groups(): Group[] {
		return [
			{
				heading: "Display",
				rows: [
					{
						name: "Emoji at note title",
						desc: "Shown while the inline title is on (appearance settings).",
						control: {
							type: "dropdown",
							key: "noteTitle",
							options: NOTE_TITLE_OPTIONS,
						},
					},
					{
						name: "Emoji in tab titles",
						control: { type: "toggle", key: "showInTabs" },
					},
					{
						name: "Emoji in view header title",
						desc: "The title in the bar at the top of each tab.",
						control: { type: "toggle", key: "showInViewHeader" },
					},
					{
						name: "Emoji next to links",
						desc: "The linked note's emoji in front of links in your notes.",
						control: { type: "toggle", key: "showInLinks" },
					},
					{
						name: "Automatic emoji for new notes",
						desc: "Give each new note an emoji that fits its name or folder, with a bit of chance so notes next to each other differ. Your own emoji always win.",
						control: { type: "toggle", key: "autoEmoji" },
					},
				],
			},
			{
				heading: "Emoji style",
				rows: [
					{
						name: "Emoji style",
						desc: "How emoji look: your system's emoji, a downloadable style or your own font.",
						aliases: [
							"System emoji",
							...EMOJI_SETS.map((set) => set.name),
							"Own font file",
							"Download",
						],
						render: (setting) =>
							this.section(setting, (el) => new EmojiStyleSection(this.plugin, el)),
					},
				],
			},
			{
				heading: "Custom icons",
				rows: [
					{
						name: "Custom icons",
						desc: "Your own images and the Obsidian icons you use: storage, uses and deleting.",
						aliases: ["Images", "Upload", "Storage", "Obsidian icons"],
						render: (setting) =>
							this.section(setting, (el) => {
								this.customIcons = new CustomIconsSection(this.plugin, el);
							}),
					},
				],
			},
			{
				heading: "Maintenance",
				rows: [
					{
						name: "Picker image cache",
						desc: CACHE_DESC,
						render: (setting) => this.pickerCache(setting),
					},
					{
						name: "Remove emoji of missing files",
						// Replaced by the current count when drawn.
						desc: "Emoji of deleted notes, folders and files are kept, so they come back after a restore or sync.",
						render: (setting) => this.missingFiles(setting),
					},
				],
			},
		];
	}

	/**
	 * A part of the tab Notemoji draws itself (and re-draws after a change),
	 * in place of the row's name and control.
	 */
	private section(setting: Setting, create: (el: HTMLElement) => void): void {
		setting.setClass("notemoji-section-row");
		create(setting.settingEl);
	}

	private pickerCache(setting: Setting): void {
		const { spriteCache } = this.plugin.style;
		setting.addButton((button) => {
			const show = () =>
				void spriteCache.size().then(
					(bytes) => {
						setting.setDesc(
							bytes === 0
								? CACHE_DESC
								: `${formatBytes(bytes)} of pre-rendered emoji for each style, so the picker opens and scrolls smoothly. They are drawn again when needed and removed with the plugin.`,
						);
						button.setDisabled(bytes === 0);
					},
					(error: unknown) =>
						console.error("[notemoji] Could not read the picker image cache.", error),
				);
			button
				.setButtonText("Clear")
				.setDisabled(true)
				.onClick(async () => {
					try {
						await spriteCache.clear();
					} catch (error) {
						console.error("[notemoji] Could not clear the picker image cache.", error);
					}
					show();
				});
			show();
		});
	}

	private missingFiles(setting: Setting): void {
		const { icons } = this.plugin;
		setting.addButton((button) => {
			const show = () => {
				const missing = icons.missingPaths().length;
				setting.setDesc(
					missing === 0
						? "Emoji of deleted notes, folders and files are kept, so they come back after a restore or sync. Nothing to clean up right now."
						: `${plural(missing, "emoji belongs", "emoji belong")} to notes, folders or files that no longer exist. ` +
								"They are kept on purpose, so they come back after a restore or sync.",
				);
				button.setButtonText(missing === 0 ? "Remove" : `Remove ${missing}`);
				button.setDisabled(missing === 0);
			};
			setDestructive(button).onClick(async () => {
				const missing = icons.missingPaths().length;
				const confirmed = await confirm(this.plugin.app, {
					title: "Remove emoji of missing files?",
					message: `${plural(missing, "emoji", "emoji")} of notes, folders or files that no longer exist will be removed. They won't come back if the items are restored or synced later.`,
					confirmText: "Remove",
					warning: true,
				});
				if (!confirmed) return;
				const removed = icons.removeMissing();
				new Notice(`Removed ${plural(removed, "emoji", "emoji")}.`);
				show();
				this.customIcons?.render();
			});
			show();
		});
	}
}
