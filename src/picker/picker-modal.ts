import { App, Menu, Modal, Notice, Platform, setIcon } from "obsidian";
import { renderIcon } from "../display/icon-source";
import { parseEmojiInput } from "../icons/emoji";
import { CUSTOM_EXTENSIONS, customValue, parseIcon } from "../icons/icon-value";
import { findEntry, getCatalog, searchEmoji } from "./catalog";
import { GridItem, GridLayout, GridSection } from "./grid-layout";
import { VirtualGrid } from "./virtual-grid";

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

const RECENT = { id: "recent", label: "Recently used", icon: "🕘" };
const CUSTOM = { id: "custom", label: "Custom icons", icon: "🖼️" };
const HINT = "Type to search, or use the arrow keys.";
const ACCEPT = CUSTOM_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** Grid geometry; tiles stretch to fill the width, never smaller than this. */
const MIN_TILE_PX = 40;
const HEADER_PX = 28;
const SECTION_GAP_PX = 8;
/** Used before the modal has a size (and in environments without layout). */
const FALLBACK_WIDTH_PX = 360;

const UPLOAD_ITEM: GridItem = {
	kind: "upload",
	value: "",
	name: "Upload an image (PNG, SVG and more)",
};

/**
 * The icon picker: search, category tabs, recently used, the user's custom
 * icons (with upload), and remove.
 *
 * The grid is virtualized (see VirtualGrid): only the rows on screen exist in
 * the DOM, so opening and scrolling stay fast with ~1,900 emoji. Tiles carry
 * no `aria-label`, because Obsidian shows a tooltip for every labelled
 * element the mouse passes; the footer names the hovered emoji instead.
 *
 * Anything that parses as a single emoji or symbol (pasted, or from the
 * system's emoji picker) is offered first when searching, also when it is not
 * in the list.
 */
export class PickerModal extends Modal {
	readonly options: PickerOptions;

	private searchEl!: HTMLInputElement;
	private tabsEl!: HTMLElement;
	private stickyEl!: HTMLElement;
	private emptyEl!: HTMLElement;
	private footerIconEl!: HTMLElement;
	private footerNameEl!: HTMLElement;
	private uploadEl!: HTMLInputElement;
	private grid!: VirtualGrid;
	private layout: GridLayout | null = null;
	private resizeObserver: ResizeObserver | null = null;

	private sections: GridSection[] = [];
	private customFiles: string[] = [];
	private activeIndex = -1;
	/** Section whose tab is highlighted ("" for none, null before the first update). */
	private shownSection: string | null = null;
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
				autocomplete: "off",
				spellcheck: "false",
			},
		});
		this.searchEl.addEventListener("input", () => {
			this.navigating = false;
			this.rebuild();
		});
		this.searchEl.addEventListener("keydown", (event) => this.handleKeydown(event));
		if (options.current !== "") {
			toolbarEl
				.createEl("button", { cls: "notemoji-picker-remove", text: "Remove" })
				.addEventListener("click", () => this.submit(""));
		}

		this.uploadEl = contentEl.createEl("input", {
			cls: "notemoji-hidden-input",
			attr: { type: "file", accept: ACCEPT, multiple: true },
		});
		this.uploadEl.addEventListener("change", () => void this.upload());

		this.tabsEl = contentEl.createDiv({
			cls: "notemoji-picker-tabs",
			attr: { role: "tablist" },
		});

		const gridWrapEl = contentEl.createDiv({ cls: "notemoji-picker-grid-wrap" });
		this.stickyEl = gridWrapEl.createDiv({ cls: "notemoji-picker-sticky" });
		this.grid = new VirtualGrid(
			gridWrapEl,
			(tileEl, item, index) => this.renderTile(tileEl, item, index),
			() => this.onGridScroll(),
		);
		this.emptyEl = gridWrapEl.createDiv({
			cls: "notemoji-picker-empty",
			text: "No emoji found. You can also paste any emoji here.",
		});
		const gridEl = this.grid.scrollEl;
		gridEl.addEventListener("click", (event) => this.chooseFromEvent(event));
		gridEl.addEventListener("mouseover", (event) => {
			const index = this.indexFromEvent(event);
			if (index !== undefined) this.showInFooter(index);
		});
		// Right-click, or long-press on touch screens.
		gridEl.addEventListener("contextmenu", (event) => this.showTileMenu(event));

		const footerEl = contentEl.createDiv({ cls: "notemoji-picker-footer" });
		this.footerIconEl = footerEl.createDiv({ cls: "notemoji-picker-footer-emoji" });
		this.footerNameEl = footerEl.createDiv({ cls: "notemoji-picker-footer-name" });

		this.renderTabs();
		this.rebuild();
		// Tiles stretch to the width; lay out again when it changes (e.g. window resize).
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.relayout(true));
			this.resizeObserver.observe(gridEl);
		}

		// On phones the keyboard would cover most of the grid; tap to search instead.
		if (!Platform.isMobile) this.searchEl.focus();

		await this.loadCustomIcons();
	}

	onClose(): void {
		this.resizeObserver?.disconnect();
		this.grid.dispose();
		this.contentEl.empty();
	}

	// ------------------------------------------------------------------ model

	private async loadCustomIcons(): Promise<void> {
		let files: string[];
		try {
			files = await this.options.custom.list();
		} catch (error) {
			console.error("[notemoji] Could not list custom icons.", error);
			files = [];
		}
		if (files.join("\n") === this.customFiles.join("\n")) return;
		const hadRecent = this.recent().length > 0;
		this.customFiles = files;
		if (this.recent().length > 0 !== hadRecent) this.renderTabs();
		this.rebuild(true);
	}

	/** Recent entries that can still be shown (custom icons may have been deleted). */
	private recent(): string[] {
		return this.options.recent.filter((value) => {
			const icon = parseIcon(value);
			return icon?.type !== "custom" || this.customFiles.includes(icon.file);
		});
	}

	private item(value: string, name: string): GridItem {
		return { kind: parseIcon(value)?.type === "custom" ? "custom" : "emoji", value, name };
	}

	private browseSections(): GridSection[] {
		const sections: GridSection[] = [];
		const recent = this.recent();
		if (recent.length > 0) {
			sections.push({
				id: RECENT.id,
				label: RECENT.label,
				items: recent.map((value) => this.item(value, this.nameOf(value))),
			});
		}
		sections.push({
			id: CUSTOM.id,
			label: CUSTOM.label,
			items: [
				...this.customFiles.map((file) => this.item(customValue(file), file)),
				UPLOAD_ITEM,
			],
		});
		for (const category of getCatalog()) {
			sections.push({
				id: category.id,
				label: category.label,
				items: category.entries.map((entry) => ({
					kind: "emoji",
					value: entry.emoji,
					name: entry.name,
				})),
			});
		}
		return sections;
	}

	private searchSections(query: string): GridSection[] {
		const items: GridItem[] = [];
		const pasted = parseEmojiInput(query);
		if (pasted.status === "ok") {
			items.push(this.item(pasted.emoji, findEntry(pasted.emoji)?.name ?? ""));
		}
		const lower = query.toLowerCase();
		for (const file of this.customFiles) {
			if (file.toLowerCase().includes(lower)) items.push(this.item(customValue(file), file));
		}
		for (const entry of searchEmoji(getCatalog(), query)) {
			if (entry.emoji === items[0]?.value) continue;
			items.push({ kind: "emoji", value: entry.emoji, name: entry.name });
		}
		return items.length > 0 ? [{ id: "results", label: "", items }] : [];
	}

	private nameOf(value: string): string {
		const icon = parseIcon(value);
		if (icon?.type === "custom") return icon.file;
		return findEntry(value)?.name ?? "";
	}

	// ------------------------------------------------------------------ rendering

	/** Rebuilds the grid for the current query. */
	private rebuild(keepScroll = false): void {
		const query = this.searchEl.value.trim();
		this.contentEl.toggleClass("is-searching", query !== "");
		this.sections = query === "" ? this.browseSections() : this.searchSections(query);
		this.shownSection = null;
		this.activeIndex = -1;
		this.emptyEl.toggleClass("is-visible", this.sections.length === 0);
		this.layout = null;
		this.relayout(keepScroll);
		this.showDefaultFooter();
		if (query !== "" && this.sections.length > 0) this.setActive(0, false);
	}

	/** Lays the current sections out for the grid's width (skipped when nothing changed). */
	private relayout(keepScroll: boolean): void {
		const width = this.grid.scrollEl.clientWidth || FALLBACK_WIDTH_PX;
		const columns = Math.max(1, Math.floor(width / MIN_TILE_PX));
		const rowHeight = Math.floor(width / columns);
		if (
			this.layout?.metrics.columns === columns &&
			this.layout.metrics.rowHeight === rowHeight
		) {
			return;
		}
		this.layout = new GridLayout(this.sections, {
			columns,
			rowHeight,
			headerHeight: HEADER_PX,
			sectionGap: SECTION_GAP_PX,
		});
		this.grid.setLayout(this.layout, keepScroll);
	}

	private renderTile(tileEl: HTMLElement, item: GridItem, index: number): void {
		tileEl.className = "notemoji-picker-emoji";
		tileEl.dataset.index = String(index);
		if (index === this.activeIndex) tileEl.addClass("is-active");
		if (item.value !== "" && item.value === this.options.current) tileEl.addClass("is-current");
		if (item.kind === "emoji") {
			tileEl.setText(item.value);
		} else if (item.kind === "custom") {
			renderIcon(tileEl, item.value, this.customUrl);
		} else {
			tileEl.addClass("is-upload");
			// The one labelled tile: its icon alone does not say what it does.
			tileEl.setAttr("aria-label", item.name);
			setIcon(tileEl, "image-plus");
		}
	}

	private renderTabs(): void {
		this.tabsEl.empty();
		const sections = [CUSTOM, ...getCatalog()];
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

	/** Keeps the tab highlight and the pinned section label in sync with the scroll position. */
	private onGridScroll(): void {
		const layout = this.layout;
		if (!layout) return;
		const top = this.grid.scrollEl.scrollTop;
		const section = layout.sectionAt(top);
		const id = section?.id ?? "";
		// Runs every scroll frame: touch the DOM only when something changed.
		if (id !== this.shownSection) {
			this.shownSection = id;
			for (const tabEl of Array.from(this.tabsEl.children) as HTMLElement[]) {
				const active = tabEl.dataset.section === id;
				tabEl.toggleClass("is-active", active);
				tabEl.setAttr("aria-selected", String(active));
			}
			this.stickyEl.setText(section?.label ?? "");
		}
		// Once a section's own header scrolled away, its name stays pinned at the top.
		const pinned = (section?.label ?? "") !== "" && top > (layout.sectionTop(id) ?? 0);
		if (pinned !== this.stickyEl.hasClass("is-visible"))
			this.stickyEl.toggleClass("is-visible", pinned);
	}

	private readonly customUrl = (file: string): string => this.options.custom.url(file);

	// ------------------------------------------------------------------ interaction

	private handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing || !this.layout) return;
		const direction = ARROWS[event.key];
		if (direction) {
			// ←/→ keep moving the caret until the arrow keys entered the grid.
			if ((direction === "left" || direction === "right") && !this.navigating) return;
			event.preventDefault();
			this.navigating = true;
			this.setActive(this.layout.move(this.activeIndex, direction), true);
		} else if (event.key === "Enter") {
			event.preventDefault();
			this.choose(Math.max(0, this.activeIndex));
		}
	}

	private setActive(index: number, reveal: boolean): void {
		if (!this.layout || index < 0 || index >= this.layout.items.length) return;
		this.grid.tileElement(this.activeIndex)?.removeClass("is-active");
		this.activeIndex = index;
		if (reveal) this.grid.revealItem(index);
		this.grid.tileElement(index)?.addClass("is-active");
		this.showInFooter(index);
	}

	private jumpTo(sectionId: string): void {
		if (this.searchEl.value !== "") {
			this.searchEl.value = "";
			this.rebuild();
		}
		const top = this.layout?.sectionTop(sectionId);
		if (top !== undefined) this.grid.scrollTo(top);
	}

	private chooseFromEvent(event: MouseEvent): void {
		const index = this.indexFromEvent(event);
		if (index !== undefined) this.choose(index);
	}

	/** Uses an item: submits an icon, or opens the file dialog for the upload tile. */
	private choose(index: number): void {
		const item = this.layout?.items[index];
		if (!item) return;
		if (item.kind === "upload") this.uploadEl.click();
		else this.submit(item.value);
	}

	private showInFooter(index: number): void {
		const item = this.layout?.items[index];
		if (!item) return;
		if (item.kind === "upload") {
			this.footerIconEl.empty();
			this.footerNameEl.setText(item.name);
			return;
		}
		renderIcon(this.footerIconEl, item.value, this.customUrl);
		this.footerNameEl.setText(item.name || "Custom emoji");
	}

	private showDefaultFooter(): void {
		const { current } = this.options;
		renderIcon(this.footerIconEl, current, this.customUrl);
		this.footerNameEl.setText(current === "" ? HINT : this.nameOf(current) || "Current emoji");
	}

	private indexFromEvent(event: Event): number | undefined {
		const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			".notemoji-picker-emoji",
		);
		return el ? Number(el.dataset.index) : undefined;
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
		const index = this.indexFromEvent(event);
		const icon = parseIcon(index === undefined ? undefined : this.layout?.items[index]?.value);
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

	private submit(value: string): void {
		this.close();
		this.options.onSubmit(value);
	}
}

const ARROWS: Record<string, "up" | "down" | "left" | "right" | undefined> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};
