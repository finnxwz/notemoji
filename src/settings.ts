import { addIcon, Notice, PluginSettingTab, Setting } from "obsidian";
import { confirm } from "./confirm-modal";
import { formatBytes } from "./icons/custom-icons";
import { LARGE_FONT_BYTES } from "./icons/emoji-font";
import { EMOJI_SET_PREVIEWS, PREVIEW_SAMPLE } from "./icons/emoji-set-previews";
import { EMOJI_SETS, findEmojiSet } from "./icons/emoji-sets";
import { FONT_EXTENSIONS } from "./icons/icon-value";
import type { NoteTitleMode } from "./icons/data";
import type NotemojiPlugin from "./main";

/** Icon of the settings tab: a real, colourful emoji instead of a line icon. */
const SETTINGS_ICON = "notemoji-emoji";
const SETTINGS_ICON_SVG =
	'<text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-size="86" ' +
	"style=\"stroke: none; fill: currentColor; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif\">" +
	"😀</text>";

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

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
		new Setting(containerEl).setName("Emoji style").setHeading();
		// Filled in once file availability is known; keeps the section in place.
		const sectionEl = containerEl.createDiv();
		void this.fillEmojiStyle(sectionEl).catch((error: unknown) =>
			console.error("[notemoji] Could not show the emoji style settings.", error),
		);
	}

	private async fillEmojiStyle(sectionEl: HTMLElement): Promise<void> {
		const { plugin } = this;
		const { emojiStyle, emojiFont } = plugin.icons.settings;
		const fonts = plugin.emojiFonts;
		const downloaded = await fonts.downloadedSets();
		const isDownloaded = (id: string) => downloaded.some((entry) => entry.set.id === id);

		const cardsEl = sectionEl.createDiv({
			cls: "notemoji-styles",
			attr: { role: "radiogroup", "aria-label": "Emoji style" },
		});
		const addCard = (
			id: string,
			name: string,
			meta: string,
			fillPreview: (el: HTMLElement) => void,
		) => {
			const selected = id === emojiStyle;
			const card = cardsEl.createEl("button", {
				cls: "notemoji-style-card",
				attr: { role: "radio", "aria-checked": String(selected), "data-style": id },
			});
			card.toggleClass("is-selected", selected);
			const headerEl = card.createDiv({ cls: "notemoji-style-header" });
			headerEl.createSpan({ cls: "notemoji-style-name", text: name });
			headerEl.createSpan({ cls: "notemoji-style-meta", text: meta });
			fillPreview(card.createDiv({ cls: "notemoji-style-preview" }));
			card.addEventListener("click", () => {
				if (selected) return;
				void plugin.setEmojiStyle(id).then(() => this.display());
			});
		};

		addCard("system", "System emoji", "Default", (el) =>
			el.createSpan({ cls: "notemoji-style-sample is-system", text: PREVIEW_SAMPLE }),
		);
		for (const set of EMOJI_SETS) {
			const meta = isDownloaded(set.id) ? "Downloaded" : `${formatBytes(set.bytes)} download`;
			addCard(set.id, set.name, meta, (el) => {
				const preview = EMOJI_SET_PREVIEWS[set.id];
				if (!preview) return;
				el.createEl("img", {
					cls: "notemoji-style-image",
					attr: { src: preview, alt: `${set.name} preview`, draggable: "false" },
				}).toggleClass("is-monochrome", set.monochrome === true);
			});
		}
		const ownAvailable = await fonts.isAvailable("file", emojiFont);
		addCard("file", "Own font file", emojiFont === "" ? "Choose a file" : emojiFont, (el) => {
			if (emojiStyle === "file" && ownAvailable && fonts.active) {
				el.createSpan({ cls: "notemoji-style-sample is-own", text: PREVIEW_SAMPLE });
			} else {
				el.createSpan({
					cls: "notemoji-style-hint",
					text: emojiFont === "" ? "TTF, OTF, WOFF or WOFF2" : "Select to preview",
				});
			}
		});

		// Details and actions for the selected style.
		const set = findEmojiSet(emojiStyle);
		const details = new Setting(sectionEl).setClass("notemoji-style-details");
		if (emojiStyle === "system") {
			details.setDesc(
				"Your device's own emoji. Emoji in your notes always stay as they are.",
			);
		} else if (set) {
			const available = isDownloaded(set.id);
			details.setDesc(
				available
					? `${set.credit} Emoji it does not contain use your system's emoji.`
					: `${set.credit} Not on this device yet, so your system's emoji are shown. Download it once (${formatBytes(set.bytes)}) from GitHub.`,
			);
			if (!available) {
				details.addButton((button) =>
					button
						.setButtonText("Download")
						.setCta()
						.onClick(async () => {
							button.setDisabled(true).setButtonText("Downloading…");
							try {
								await plugin.downloadEmojiSet(set);
								new Notice(`${set.name} is ready.`);
							} catch (error) {
								new Notice(
									error instanceof Error ? error.message : "Could not download.",
								);
							}
							this.display();
						}),
				);
			}
		} else {
			this.addOwnFontActions(sectionEl, details, emojiFont, ownAvailable);
		}

		const unused = downloaded.filter((entry) => entry.set.id !== emojiStyle);
		if (unused.length > 0) {
			const total = unused.reduce((sum, entry) => sum + entry.bytes, 0);
			new Setting(sectionEl)
				.setName("Other downloaded styles")
				.setDesc(
					`${unused.map((entry) => entry.set.name).join(", ")} (${formatBytes(total)}) stay on this device, so switching back is instant.`,
				)
				.addButton((button) =>
					button
						.setButtonText("Delete")
						.setWarning()
						.onClick(async () => {
							for (const entry of unused) await plugin.deleteEmojiSet(entry.set);
							this.display();
						}),
				);
		}
	}

	private addOwnFontActions(
		sectionEl: HTMLElement,
		details: Setting,
		emojiFont: string,
		available: boolean,
	): void {
		const { plugin } = this;
		details.setDesc(
			emojiFont === ""
				? "Choose an emoji font file (TTF, OTF, WOFF or WOFF2). Until then your system's emoji are shown."
				: available
					? `Uses "${emojiFont}". Emoji it does not contain use your system's emoji.`
					: `"${emojiFont}" is not on this device yet, so your system's emoji are shown.`,
		);

		const fileInput = sectionEl.createEl("input", {
			cls: "notemoji-hidden-input",
			attr: {
				type: "file",
				accept: FONT_EXTENSIONS.map((extension) => `.${extension}`).join(","),
			},
		});
		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			fileInput.value = "";
			if (file) void this.installOwnFont(file);
		});

		details.addButton((button) =>
			button
				.setButtonText(emojiFont === "" ? "Choose font" : "Change font")
				.setCta()
				.onClick(() => fileInput.click()),
		);
		if (emojiFont !== "") {
			details.addButton((button) =>
				button.setButtonText("Remove font").onClick(async () => {
					try {
						await plugin.removeOwnEmojiFont();
					} catch (error) {
						console.error("[notemoji] Could not remove the emoji font.", error);
						new Notice("Could not remove the emoji font.");
					}
					this.display();
				}),
			);
		}
	}

	/** Installs a chosen font file, asking first when it is large. */
	private async installOwnFont(file: File): Promise<void> {
		const { plugin } = this;
		if (file.size > LARGE_FONT_BYTES) {
			const confirmed = await confirm(plugin.app, {
				title: "Use a large font?",
				message: `"${file.name}" is ${formatBytes(file.size)}. Large fonts slow down Obsidian's start, may not work on phones, and some sync services do not copy files this big.`,
				confirmText: "Use it",
			});
			if (!confirmed) return;
		}
		try {
			await plugin.setOwnEmojiFont(file.name, await file.arrayBuffer());
			new Notice(`Notemoji now uses "${file.name}" for its emoji.`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not use this font.");
		}
		this.display();
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
