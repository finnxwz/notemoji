import { App, Menu, Modal, Notice, Platform, setIcon } from "obsidian";
import { IconSource, renderIcon } from "../display/icon-source";
import { parseEmojiInput } from "../icons/emoji";
import { CUSTOM_EXTENSIONS, customValue, parseIcon } from "../icons/icon-value";
import { EmojiEntry, findEntry, getCatalog, searchEmoji } from "./catalog";

/** The user's own icon library, as the picker needs it. */
export interface CustomIcons {
	list(): Promise<string[]>;
	url(file: string): string;
	/** Stores an uploaded image; returns its file name, or throws with a message for the user. */
	upload(name: string, data: ArrayBuffer): Promise<string>;
	/** Deletes an icon (after asking). Resolves true when it was deleted. */
	remove(file: string): Promise<boolean>;
}

export interface PickerOptions {
	/** Modal heading, e.g. "Set note emoji". */
	title: string;
	/** Line below the heading, usually the item's name. */
	description?: string;
	/** The item's current icon (emoji or `custom:<file>`), or "" when it has none. */
	current: string;
	/** Recently used icons, most recent first. */
	recent: readonly string[];
	custom: CustomIcons;
	/** Called with the chosen icon, or "" when the icon should be removed. */
	onSubmit: (value: string) => void;
}

interface Tile {
	/** What gets stored: an emoji or `custom:<file>`. */
	value: string;
	name: string;
	el: HTMLElement;
}

interface Section {
	id: string;
	label: string;
	icon: string;
}

const RECENT: Section = { id: "recent", label: "Recently used", icon: "🕘" };
const CUSTOM: Section = { id: "custom", label: "Custom icons", icon: "🖼️" };
const HINT = "Type to search, or use the arrow keys.";
const ACCEPT = CUSTOM_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/**
 * The icon picker: search, category tabs, recently used, the user's custom
 * icons (with upload), and remove.
 *
 * Anything that parses as a single emoji or symbol (pasted, or typed with the
 * system's emoji picker) is offered as the first result, also when it is not
 * in the bundled list.
 */
export class PickerModal extends Modal {
	readonly options: PickerOptions;

	private searchEl!: HTMLInputElement;
	private tabsEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private footerIconEl!: HTMLElement;
	private footerNameEl!: HTMLElement;
	private uploadEl!: HTMLInputElement;

	private customFiles: string[] = [];
	private tiles: Tile[] = [];
	private activeIndex = -1;
	/** Set once the arrow keys moved the selection: ←/→ then move tiles, not the caret. */
	private navigating = false;

	constructor(app: App, options: PickerOptions) {
		super(app);
		this.options = options;
	}

	async onOpen(): Promise<void> {
		const { contentEl, options } = this;
		this.modalEl.addClass("notemoji-picker-modal");
		this.titleEl.setText(options.title);
		contentEl.addClass("notemoji-picker");
		if (options.description) {
			contentEl.createDiv({ cls: "notemoji-picker-description", text: options.description });
		}

		const toolbarEl = contentEl.createDiv({ cls: "notemoji-picker-toolbar" });
		this.searchEl = toolbarEl.createEl("input", {
			cls: "notemoji-picker-search",
			attr: {
				type: "search",
				placeholder: "Search or paste an emoji",
				"aria-label": "Search emoji",
				autocomplete: "off",
				spellcheck: "false",
			},
		});
		this.searchEl.addEventListener("input", () => {
			this.navigating = false;
			this.render();
		});
		this.searchEl.addEventListener("keydown", (event) => this.handleKeydown(event));

		if (options.current !== "") {
			toolbarEl
				.createEl("button", { cls: "notemoji-picker-remove", text: "Remove" })
				.addEventListener("click", () => this.submit(""));
		}

		this.uploadEl = contentEl.createEl("input", {
			cls: "notemoji-hidden-input notemoji-picker-upload-input",
			attr: { type: "file", accept: ACCEPT, multiple: true },
		});
		this.uploadEl.addEventListener("change", () => void this.upload());

		this.tabsEl = contentEl.createDiv({
			cls: "notemoji-picker-tabs",
			attr: { role: "tablist" },
		});
		this.bodyEl = contentEl.createDiv({ cls: "notemoji-picker-body" });
		this.bodyEl.addEventListener("click", (event) => {
			const tile = this.tileFromEvent(event);
			if (tile) this.submit(tile.value);
		});
		this.bodyEl.addEventListener("mouseover", (event) => {
			const tile = this.tileFromEvent(event);
			if (tile) this.showInFooter(tile);
		});
		// Right-click, or long-press on touch screens.
		this.bodyEl.addEventListener("contextmenu", (event) => this.showTileMenu(event));
		this.bodyEl.addEventListener("scroll", () => this.highlightTab(), { passive: true });

		const footerEl = contentEl.createDiv({ cls: "notemoji-picker-footer" });
		this.footerIconEl = footerEl.createDiv({ cls: "notemoji-picker-footer-emoji" });
		this.footerNameEl = footerEl.createDiv({ cls: "notemoji-picker-footer-name" });

		// On phones the keyboard would cover most of the grid; tap to search instead.
		if (!Platform.isMobile) this.searchEl.focus();

		await this.loadCustomIcons();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private get source(): IconSource {
		return { get: () => undefined, url: (file) => this.options.custom.url(file) };
	}

	// ------------------------------------------------------------------ rendering

	private async loadCustomIcons(): Promise<void> {
		try {
			this.customFiles = await this.options.custom.list();
		} catch (error) {
			console.error("[notemoji] Could not list custom icons.", error);
			this.customFiles = [];
		}
		this.renderTabs();
		this.render();
	}

	/** Recent entries that can still be shown (custom icons may have been deleted). */
	private recent(): string[] {
		return this.options.recent.filter((value) => {
			const icon = parseIcon(value);
			return icon?.type !== "custom" || this.customFiles.includes(icon.file);
		});
	}

	private renderTabs(): void {
		this.tabsEl.empty();
		const sections: Section[] = [CUSTOM, ...getCatalog()];
		if (this.recent().length > 0) sections.unshift(RECENT);
		for (const section of sections) {
			this.tabsEl
				.createEl("button", {
					cls: "notemoji-picker-tab",
					text: section.icon,
					attr: { "aria-label": section.label, "data-section": section.id, role: "tab" },
				})
				.addEventListener("click", () => this.jumpTo(section.id));
		}
	}

	/** Rebuilds the grid for the current query. */
	private render(): void {
		this.bodyEl.empty();
		this.tiles = [];
		this.activeIndex = -1;
		this.showDefaultFooter();

		const query = this.searchEl.value.trim();
		this.contentEl.toggleClass("is-searching", query !== "");
		if (query === "") this.renderBrowse();
		else this.renderSearch(query);

		this.highlightTab();
	}

	private renderBrowse(): void {
		const recent = this.recent();
		if (recent.length > 0) {
			const gridEl = this.createSection(RECENT.id, RECENT.label);
			for (const value of recent) this.addTile(gridEl, value, this.nameOf(value));
		}

		const customEl = this.createSection(CUSTOM.id, CUSTOM.label);
		for (const file of this.customFiles) this.addTile(customEl, customValue(file), file);
		const uploadEl = customEl.createEl("button", {
			cls: "notemoji-picker-upload",
			attr: { "aria-label": "Upload an image (PNG, SVG and more)" },
		});
		setIcon(uploadEl, "image-plus");
		uploadEl.addEventListener("click", () => this.uploadEl.click());

		for (const category of getCatalog()) {
			const gridEl = this.createSection(category.id, category.label);
			for (const entry of category.entries) this.addEntry(gridEl, entry);
		}
	}

	private renderSearch(query: string): void {
		const gridEl = this.createSection("results", "");
		const pasted = parseEmojiInput(query);
		if (pasted.status === "ok") {
			this.addTile(gridEl, pasted.emoji, findEntry(pasted.emoji)?.name ?? "");
		}
		const lower = query.toLowerCase();
		for (const file of this.customFiles) {
			if (file.toLowerCase().includes(lower)) this.addTile(gridEl, customValue(file), file);
		}
		for (const entry of searchEmoji(getCatalog(), query)) {
			if (entry.emoji !== this.tiles[0]?.value) this.addEntry(gridEl, entry);
		}

		if (this.tiles.length === 0) {
			this.bodyEl.createDiv({
				cls: "notemoji-picker-empty",
				text: "No emoji found. You can also paste any emoji here.",
			});
			return;
		}
		this.setActive(0, false);
	}

	private createSection(id: string, label: string): HTMLElement {
		const sectionEl = this.bodyEl.createDiv({
			cls: "notemoji-picker-section",
			attr: { "data-section": id },
		});
		if (label !== "")
			sectionEl.createDiv({ cls: "notemoji-picker-section-title", text: label });
		return sectionEl.createDiv({ cls: "notemoji-picker-grid" });
	}

	private addEntry(gridEl: HTMLElement, entry: EmojiEntry): void {
		this.addTile(gridEl, entry.emoji, entry.name);
	}

	private addTile(gridEl: HTMLElement, value: string, name: string): void {
		const el = gridEl.createEl("button", {
			cls: "notemoji-picker-emoji",
			attr: { "aria-label": name || value, "data-index": this.tiles.length, tabindex: -1 },
		});
		renderIcon(el, value, this.source);
		el.toggleClass("is-current", value === this.options.current);
		this.tiles.push({ value, name, el });
	}

	private nameOf(value: string): string {
		const icon = parseIcon(value);
		if (icon?.type === "custom") return icon.file;
		return findEntry(value)?.name ?? "";
	}

	// ------------------------------------------------------------------ custom icons

	private async upload(): Promise<void> {
		const files = Array.from(this.uploadEl.files ?? []);
		this.uploadEl.value = "";
		const added: string[] = [];
		for (const file of files) {
			try {
				added.push(await this.options.custom.upload(file.name, await file.arrayBuffer()));
			} catch (error) {
				new Notice(
					error instanceof Error ? error.message : `Could not add "${file.name}".`,
				);
			}
		}
		if (added.length === 0) return;

		// A single upload is what the user wants to use right away.
		if (files.length === 1) {
			this.submit(customValue(added[0]));
			return;
		}
		this.searchEl.value = "";
		await this.loadCustomIcons();
		this.jumpTo(CUSTOM.id);
	}

	private showTileMenu(event: MouseEvent): void {
		const icon = parseIcon(this.tileFromEvent(event)?.value);
		if (icon?.type !== "custom") return;
		event.preventDefault();
		new Menu()
			.addItem((item) =>
				item
					.setTitle("Delete custom icon")
					.setIcon("trash")
					.onClick(async () => {
						if (await this.options.custom.remove(icon.file))
							await this.loadCustomIcons();
					}),
			)
			.showAtMouseEvent(event);
	}

	// ------------------------------------------------------------------ interaction

	private handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				event.preventDefault();
				this.navigating = true;
				this.moveVertically(event.key === "ArrowDown" ? 1 : -1);
				break;
			case "ArrowRight":
			case "ArrowLeft":
				if (!this.navigating) return;
				event.preventDefault();
				this.setActive(this.activeIndex + (event.key === "ArrowRight" ? 1 : -1), true);
				break;
			case "Enter": {
				event.preventDefault();
				const tile = this.tiles[this.activeIndex] ?? this.tiles[0];
				if (tile) this.submit(tile.value);
				break;
			}
		}
	}

	/** Moves to the closest tile in the next or previous visual row. */
	private moveVertically(direction: 1 | -1): void {
		const current = this.tiles[this.activeIndex];
		if (!current) {
			this.setActive(direction === 1 ? 0 : this.tiles.length - 1, true);
			return;
		}

		const from = current.el.getBoundingClientRect();
		let best = -1;
		let bestTop = 0;
		let bestDistance = Infinity;
		for (
			let i = this.activeIndex + direction;
			i >= 0 && i < this.tiles.length;
			i += direction
		) {
			const rect = this.tiles[i].el.getBoundingClientRect();
			const inOtherRow = direction === 1 ? rect.top > from.top + 1 : rect.top < from.top - 1;
			if (!inOtherRow) continue;
			// Stop once we moved past the nearest row.
			if (best !== -1 && Math.abs(rect.top - bestTop) > 1) break;
			const distance = Math.abs(rect.left - from.left);
			if (distance < bestDistance) {
				best = i;
				bestTop = rect.top;
				bestDistance = distance;
			}
		}
		// Layout without geometry (e.g. hidden): fall back to the next tile.
		this.setActive(best !== -1 ? best : this.activeIndex + direction, true);
	}

	private setActive(index: number, scroll: boolean): void {
		const tile = this.tiles[index];
		if (!tile) return;
		this.tiles[this.activeIndex]?.el.removeClass("is-active");
		this.activeIndex = index;
		tile.el.addClass("is-active");
		if (scroll) tile.el.scrollIntoView({ block: "nearest" });
		this.showInFooter(tile);
	}

	private jumpTo(sectionId: string): void {
		if (this.searchEl.value !== "") {
			this.searchEl.value = "";
			this.render();
		}
		const sectionEl = this.bodyEl.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
		if (sectionEl) this.bodyEl.scrollTop = sectionEl.offsetTop - this.bodyEl.offsetTop;
		this.highlightTab(sectionId);
	}

	/** Marks the tab of the section at the top of the grid (or `sectionId`). */
	private highlightTab(sectionId?: string): void {
		let currentId = sectionId ?? "";
		if (sectionId === undefined) {
			const top = this.bodyEl.scrollTop + this.bodyEl.offsetTop + 4;
			for (const el of Array.from(
				this.bodyEl.querySelectorAll<HTMLElement>("[data-section]"),
			)) {
				if (el.offsetTop <= top) currentId = el.dataset.section ?? "";
			}
		}
		for (const tabEl of Array.from(
			this.tabsEl.querySelectorAll<HTMLElement>("[data-section]"),
		)) {
			const active = tabEl.dataset.section === currentId;
			tabEl.toggleClass("is-active", active);
			tabEl.setAttr("aria-selected", String(active));
		}
	}

	private showInFooter(tile: Tile): void {
		renderIcon(this.footerIconEl, tile.value, this.source);
		this.footerNameEl.setText(tile.name || "Custom emoji");
	}

	private showDefaultFooter(): void {
		const { current } = this.options;
		renderIcon(this.footerIconEl, current, this.source);
		this.footerNameEl.setText(current === "" ? HINT : this.nameOf(current) || "Current emoji");
	}

	private tileFromEvent(event: Event): Tile | undefined {
		const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			".notemoji-picker-emoji",
		);
		return el ? this.tiles[Number(el.dataset.index)] : undefined;
	}

	private submit(value: string): void {
		this.close();
		this.options.onSubmit(value);
	}
}
