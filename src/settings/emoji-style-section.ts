import { Notice, Platform, setIcon } from "obsidian";
import { confirm } from "../confirm-modal";
import type NotemojiPlugin from "../main";
import { LARGE_FONT_BYTES } from "../style/emoji-fonts";
import { EMOJI_SET_PREVIEWS, PREVIEW_SAMPLE } from "../style/emoji-set-previews";
import { EMOJI_SETS, EmojiSet, FONT_EXTENSIONS } from "../style/emoji-sets";
import { formatBytes } from "../format";

/**
 * The emoji style picker in the settings: one card per style with a preview,
 * its state, and its actions (download, delete, choose a file) on the card.
 *
 * Re-renders only itself, so switching styles never rebuilds or scrolls the
 * whole settings tab; a newer render always wins over a slower older one.
 */
export class EmojiStyleSection {
	private readonly el: HTMLElement;
	private readonly fileInput: HTMLInputElement;
	private renderToken = 0;
	/** Sets that are being downloaded right now. */
	private readonly downloading = new Set<string>();

	constructor(
		private readonly plugin: NotemojiPlugin,
		parentEl: HTMLElement,
	) {
		this.el = parentEl.createDiv({ cls: "notemoji-styles-section" });
		this.fileInput = parentEl.createEl("input", {
			cls: "notemoji-hidden-input",
			attr: {
				type: "file",
				// Phones may grey out font files they have no type for (e.g. WOFF2 on
				// iOS), so they offer every file; installOwn checks the name anyway.
				accept: Platform.isMobile
					? null
					: FONT_EXTENSIONS.map((extension) => `.${extension}`).join(","),
			},
		});
		this.fileInput.addEventListener("change", () => {
			const file = this.fileInput.files?.[0];
			this.fileInput.value = "";
			if (file) void this.installOwnFont(file);
		});
		void this.render();
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const { emojiStyle, emojiFont } = this.plugin.settings;
		const { fonts } = this.plugin.style;
		const downloaded = new Set((await fonts.downloadedSets()).map((entry) => entry.set.id));
		const ownAvailable = await fonts.isAvailable("file", emojiFont);
		if (token !== this.renderToken) return;

		this.el.empty();
		const cardsEl = this.el.createDiv({
			cls: "notemoji-styles",
			attr: { role: "radiogroup" },
		});

		// System emoji
		const system = this.card(cardsEl, "system", "System emoji", "Default", emojiStyle);
		system.preview.createSpan({ cls: "notemoji-style-sample is-system", text: PREVIEW_SAMPLE });
		system.onSelect = () => this.select("system");

		// Downloadable sets
		for (const set of EMOJI_SETS) {
			const isDownloaded = downloaded.has(set.id);
			const isBusy = this.downloading.has(set.id);
			const meta = isBusy
				? "Downloading…"
				: isDownloaded
					? "Downloaded"
					: formatBytes(set.bytes);
			const card = this.card(cardsEl, set.id, set.name, meta, emojiStyle);
			const preview = EMOJI_SET_PREVIEWS[set.id];
			if (preview) {
				card.preview
					.createEl("img", {
						cls: "notemoji-style-image",
						attr: { src: preview, alt: `${set.name} preview`, draggable: "false" },
					})
					.toggleClass("is-monochrome", set.monochrome === true);
			}

			if (isBusy) {
				card.el.addClass("is-busy");
			} else if (isDownloaded) {
				this.action(card.actions, "trash-2", "Delete download", () => this.deleteSet(set));
				card.onSelect = () => this.select(set.id);
			} else {
				this.action(
					card.actions,
					"download",
					"Download",
					() => this.download(set),
					"Download",
				);
				card.onSelect = () => this.download(set);
			}
		}

		// Own font file
		const own = this.card(
			cardsEl,
			"file",
			"Own font file",
			emojiFont === "" ? "TTF, OTF, WOFF2" : emojiFont,
			emojiStyle,
		);
		if (emojiStyle === "file" && ownAvailable && fonts.active) {
			own.preview.createSpan({ cls: "notemoji-style-sample is-own", text: PREVIEW_SAMPLE });
		} else {
			own.preview.createSpan({
				cls: "notemoji-style-hint",
				text: emojiFont === "" ? "Use any emoji font you have" : "Select to use it",
			});
		}
		if (emojiFont === "") {
			this.action(
				own.actions,
				"folder-open",
				"Choose font",
				() => this.fileInput.click(),
				"Choose",
			);
			own.onSelect = () => this.fileInput.click();
		} else {
			this.action(own.actions, "folder-open", "Change font", () => this.fileInput.click());
			this.action(own.actions, "trash-2", "Remove font", () => this.removeOwnFont());
			own.onSelect = () => this.select("file");
		}

		this.el.createDiv({
			cls: "notemoji-styles-caption",
			text: this.caption(emojiStyle, emojiFont, ownAvailable, downloaded),
		});
	}

	// ------------------------------------------------------------------ building

	private card(
		parentEl: HTMLElement,
		id: string,
		name: string,
		meta: string,
		selectedId: string,
	): {
		el: HTMLElement;
		preview: HTMLElement;
		actions: HTMLElement;
		onSelect: (() => unknown) | null;
	} {
		const selected = id === selectedId;
		const el = parentEl.createDiv({
			cls: "notemoji-style-card",
			attr: {
				role: "radio",
				"aria-checked": String(selected),
				tabindex: 0,
				"data-style": id,
			},
		});
		el.toggleClass("is-selected", selected);
		const headerEl = el.createDiv({ cls: "notemoji-style-header" });
		headerEl.createSpan({ cls: "notemoji-style-name", text: name });
		headerEl.createSpan({ cls: "notemoji-style-meta", text: meta });
		const actions = headerEl.createDiv({ cls: "notemoji-style-actions" });
		const card = {
			el,
			preview: el.createDiv({ cls: "notemoji-style-preview" }),
			actions,
			onSelect: null as (() => unknown) | null,
		};

		const activate = () => {
			if (!selected) void card.onSelect?.();
		};
		el.addEventListener("click", (event) => {
			// Clicks on the card's own buttons are handled by them.
			if ((event.target as HTMLElement).closest("button")) return;
			activate();
		});
		el.addEventListener("keydown", (event) => {
			if (event.target !== el || (event.key !== "Enter" && event.key !== " ")) return;
			event.preventDefault();
			activate();
		});
		return card;
	}

	private action(
		parentEl: HTMLElement,
		icon: string,
		label: string,
		run: () => unknown,
		text?: string,
	): void {
		const button = parentEl.createEl("button", {
			cls: "notemoji-style-action clickable-icon",
			attr: { "aria-label": label },
		});
		setIcon(button.createSpan({ cls: "notemoji-style-action-icon" }), icon);
		if (text) button.createSpan({ text });
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			void run();
		});
	}

	private caption(
		style: string,
		ownFont: string,
		ownAvailable: boolean,
		downloaded: ReadonlySet<string>,
	): string {
		if (style === "system")
			return "Your device's own emoji. Emoji in your notes always stay as they are.";
		const { unsupported } = this.plugin.style.fonts;
		if (style === "file") {
			if (ownFont === "")
				return "Choose a font file. Until then your system's emoji are shown.";
			if (!ownAvailable)
				return `"${ownFont}" is not on this device yet, so your system's emoji are shown.`;
			return unsupported
				? `"${ownFont}" can't be drawn on this device, so your system's emoji are shown here.`
				: `Uses "${ownFont}". Emoji it does not contain use your system's emoji.`;
		}
		const set = EMOJI_SETS.find((entry) => entry.id === style);
		if (!set) return "";
		if (!downloaded.has(set.id))
			return `${set.credit} Not on this device yet: your system's emoji are shown until you download it.`;
		return unsupported
			? `${set.credit} This device can't draw ${set.name} (its colour format isn't supported here, for example on iPhone and iPad), so your system's emoji are shown here. Other devices still use it.`
			: set.credit;
	}

	// ------------------------------------------------------------------ actions

	private async select(style: string): Promise<void> {
		await this.plugin.style.select(style);
		await this.render();
	}

	/** Downloads a set (shown on its card) and selects it. */
	private async download(set: EmojiSet): Promise<void> {
		if (this.downloading.has(set.id)) return;
		this.downloading.add(set.id);
		void this.render();
		try {
			await this.plugin.style.download(set);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : `Could not download ${set.name}.`);
		} finally {
			this.downloading.delete(set.id);
			await this.render();
		}
	}

	private async deleteSet(set: EmojiSet): Promise<void> {
		try {
			await this.plugin.style.deleteSet(set);
		} catch (error) {
			console.error(`[notemoji] Could not delete ${set.name}.`, error);
			new Notice(`Could not delete ${set.name}.`);
		}
		await this.render();
	}

	/** Installs a chosen font file, asking first when it is large. */
	private async installOwnFont(file: File): Promise<void> {
		if (file.size > LARGE_FONT_BYTES) {
			const confirmed = await confirm(this.plugin.app, {
				title: "Use a large font?",
				message: `"${file.name}" is ${formatBytes(file.size)}. Large fonts slow down Obsidian's start, may not work on phones, and some sync services do not copy files this big.`,
				confirmText: "Use it",
			});
			if (!confirmed) return;
		}
		try {
			await this.plugin.style.installOwn(file.name, await file.arrayBuffer());
			new Notice(`Notemoji now uses "${file.name}" for its emoji.`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not use this font.");
		}
		await this.render();
	}

	private async removeOwnFont(): Promise<void> {
		try {
			await this.plugin.style.removeOwn();
		} catch (error) {
			console.error("[notemoji] Could not remove the emoji font.", error);
			new Notice("Could not remove the emoji font.");
		}
		await this.render();
	}
}
