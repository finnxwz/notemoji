import { App, Menu, Modal, Notice, Platform, setIcon } from "obsidian";
import { IconUrl, renderIcon } from "../display/icon-source";
import { parseEmojiInput } from "../icons/emoji";
import { customValue, lucideValue, parseIcon } from "../icons/icon-value";
import { IMAGE_EXTENSIONS } from "../icons/image-format";
import { lucideIconId, lucideLabel, searchLucide } from "../icons/library-icons";
import { MAX_UPLOAD_BYTES } from "../icons/prepare-icon";
import { findEntry, getCatalog, searchEmoji } from "./catalog";
import { onContextMenu } from "./context-menu";
import { GridItem, GridLayout, GridSection } from "./grid-layout";
import type { SpriteSource } from "./emoji-sprites";
import { VirtualGrid } from "./virtual-grid";

/** The user's own icon library, as the picker needs it. */
export interface CustomIcons {
	/** Names of all icons. */
	list(): Promise<string[]>;
	url(id: string): string | undefined;
	/** Stores an uploaded image; returns the icon's name, or throws with a message for the user. */
	upload(fileName: string, data: ArrayBuffer): Promise<string>;
	/** Deletes an icon (after asking). Resolves true when it was deleted. */
	remove(id: string): Promise<boolean>;
}

/** Obsidian's own icons (Lucide), as the picker needs them. */
export interface ObsidianIcons {
	/** Names of every icon this device's Obsidian has, e.g. `arrow-right`. */
	list(): readonly string[];
	/** URL of an icon's copy in data.json; `undefined` when there is none. */
	storedUrl(name: string): string | undefined;
}

export interface PickerOptions {
	/** Modal heading, e.g. "Set note emoji". */
	title: string;
	/** Line below the heading, usually the item's name. */
	description?: string;
	/** The item's current icon (emoji, `custom:<name>` or `lucide:<name>`), or "" when it has none. */
	current: string;
	/** Recently used icons, most recent first. */
	recent: readonly string[];
	custom: CustomIcons;
	library: ObsidianIcons;
	/** Pre-rendered emoji images; tiles fall back to text without them. */
	sprites?: SpriteSource;
	/** Called with the chosen icon, or "" when the icon should be removed. */
	onSubmit: (value: string) => void;
}

const RECENT = { id: "recent", label: "Recently used", icon: "🕘" };
const CUSTOM = { id: "custom", label: "Custom icons", icon: "🖼️" };
/** Its tab shows one of Obsidian's icons (by its name) instead of an emoji. */
const LIBRARY = { id: "lucide", label: "Obsidian icons", icon: "shapes" };
const HINT = "Type to search, or use the arrow keys.";
const ACCEPT = IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** How long a notice explaining a refused upload stays (ms); it may take a moment to read. */
const UPLOAD_NOTICE_MS = 10_000;

/** Grid geometry; tiles stretch to fill the width, never smaller than this. */
const MIN_TILE_PX = 40;
/** Header rows include the space between sections, so rows cover the whole grid. */
const HEADER_PX = 36;
const SECTION_GAP_PX = 0;
/** Used before the modal has a size (and in environments without layout). */
const FALLBACK_WIDTH_PX = 360;

const UPLOAD_ITEM: GridItem = {
	kind: "upload",
	value: "",
	name: "Upload an image (PNG, SVG and more)",
};

/**
 * The icon picker: search, category tabs, recently used, the user's custom
 * icons (with upload), Obsidian's own icons, and remove.
 *
 * The grid is virtualized (see VirtualGrid): only the rows on screen exist in
 * the DOM, so opening and scrolling stay fast with ~1,900 emoji and as many
 * Obsidian icons. Tiles carry no `aria-label`, because Obsidian shows a
 * tooltip for every labelled element the mouse passes; the footer names the
 * hovered emoji instead.
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
	private stopSprites: (() => void) | null = null;

	private sections: GridSection[] = [];
	private customIds: string[] = [];
	/** Names of Obsidian's icons on this device, and the same as a set for lookups. */
	private libraryNames: readonly string[] = [];
	private libraryNameSet = new Set<string>();
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
		this.libraryNames = options.library.list();
		this.libraryNameSet = new Set(this.libraryNames);
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
		gridEl.addEventListener("click", (event) => {
			const index = this.indexOf(event.target as HTMLElement);
			if (index !== undefined) this.choose(index);
		});
		gridEl.addEventListener("mouseover", (event) => {
			const index = this.indexOf(event.target as HTMLElement);
			if (index !== undefined) this.showInFooter(index);
		});
		// Right-click, or long-press on touch screens.
		onContextMenu(gridEl, (target, position) => this.showTileMenu(target, position));

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

		// Categories whose images become ready while the picker is open switch over.
		this.stopSprites = options.sprites?.onChange(() => this.grid.refreshTiles()) ?? null;

		// On phones the keyboard would cover most of the grid; tap to search instead.
		if (!Platform.isMobile) this.searchEl.focus();

		await this.loadCustomIcons();
	}

	onClose(): void {
		this.stopSprites?.();
		this.resizeObserver?.disconnect();
		this.grid.dispose();
		this.contentEl.empty();
	}

	// ------------------------------------------------------------------ model

	private async loadCustomIcons(): Promise<void> {
		let ids: string[];
		try {
			ids = await this.options.custom.list();
		} catch (error) {
			console.error("[notemoji] Could not list custom icons.", error);
			ids = [];
		}
		if (ids.join("\n") === this.customIds.join("\n")) return;
		const hadRecent = this.recent().length > 0;
		this.customIds = ids;
		if (this.recent().length > 0 !== hadRecent) this.renderTabs();
		this.rebuild(true);
	}

	/**
	 * Recent entries that can be shown: custom icons may have been deleted, an
	 * Obsidian icon may have neither a copy nor a drawing on this device, and
	 * newer versions add other kinds.
	 */
	private recent(): string[] {
		return this.options.recent.filter((value) => {
			const icon = parseIcon(value);
			if (icon?.type === "custom") return this.customIds.includes(icon.id);
			if (icon?.type === "lucide") {
				return (
					this.libraryNameSet.has(icon.name) ||
					this.options.library.storedUrl(icon.name) !== undefined
				);
			}
			return icon !== undefined;
		});
	}

	private item(value: string, name: string): GridItem {
		return { kind: parseIcon(value)?.type ?? "emoji", value, name };
	}

	private libraryItem(name: string): GridItem {
		return { kind: "lucide", value: lucideValue(name), name: lucideLabel(name) };
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
			items: [...this.customIds.map((id) => this.item(customValue(id), id)), UPLOAD_ITEM],
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
		// After every emoji, so people who use emoji only never have to scroll past them.
		if (this.libraryNames.length > 0) {
			sections.push({
				id: LIBRARY.id,
				label: LIBRARY.label,
				items: this.libraryNames.map((name) => this.libraryItem(name)),
			});
		}
		return sections;
	}

	private searchSections(query: string): GridSection[] {
		const items: GridItem[] = [];
		const pasted = this.pastedItem(query);
		if (pasted?.first) items.push(pasted.item);
		const lower = query.toLowerCase();
		for (const id of this.customIds) {
			if (id.toLowerCase().includes(lower)) items.push(this.item(customValue(id), id));
		}
		for (const entry of searchEmoji(getCatalog(), query)) {
			if (entry.emoji === pasted?.item.value) continue;
			items.push({ kind: "emoji", value: entry.emoji, name: entry.name });
		}
		for (const name of searchLucide(this.libraryNames, query)) {
			items.push(this.libraryItem(name));
		}
		if (pasted && !pasted.first) items.push(pasted.item);
		return items.length > 0 ? [{ id: "results", label: "", items }] : [];
	}

	/**
	 * A pasted or typed emoji or symbol as a tile. A real emoji (pasted, or from
	 * the system's emoji picker) comes first. Text typed on a keyboard is a
	 * search: `+1` and `<3` look for 👍 and ❤️, not for the `+` and `<` they
	 * start with, so a lone keyboard symbol (`$`) only comes after the results.
	 */
	private pastedItem(query: string): { item: GridItem; first: boolean } | undefined {
		const pasted = parseEmojiInput(query);
		if (pasted.status !== "ok") return undefined;
		const typed = /^[\x20-\x7e]$/.test(pasted.emoji);
		if (typed && pasted.extra) return undefined;
		// Stored as the list has it, e.g. with the emoji variation selector (❤ → ❤️).
		const entry = findEntry(pasted.emoji);
		return { item: this.item(entry?.emoji ?? pasted.emoji, entry?.name ?? ""), first: !typed };
	}

	private nameOf(value: string): string {
		const icon = parseIcon(value);
		if (icon?.type === "custom") return icon.id;
		if (icon?.type === "lucide") return lucideLabel(icon.name);
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
		// Keeps the pinned section label clear of the scrollbar.
		this.stickyEl.setCssProps({
			"--notemoji-scrollbar-width": `${this.grid.scrollbarWidth}px`,
		});
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
			const slot = this.options.sprites?.slot(item.value);
			if (!slot) {
				tileEl.setText(item.value);
				return;
			}
			// A slice of a pre-rendered image: no glyph has to be drawn while scrolling.
			tileEl.empty();
			tileEl.createSpan({ cls: "notemoji-sprite" }).setCssProps({
				"--notemoji-sprite-image": slot.image,
				"--notemoji-sprite-position": slot.position,
				"--notemoji-sprite-size": slot.size,
			});
		} else if (item.kind === "custom") {
			renderIcon(tileEl, item.value, this.iconUrl);
		} else if (item.kind === "lucide") {
			tileEl.addClass("is-lucide");
			this.drawIcon(tileEl, item.value);
		} else {
			// Explained in the footer on hover, like every tile (no tooltip).
			tileEl.addClass("is-upload");
			setIcon(tileEl, "image-plus");
		}
	}

	private renderTabs(): void {
		this.tabsEl.empty();
		const sections = [CUSTOM, ...getCatalog()];
		if (this.recent().length > 0) sections.unshift(RECENT);
		for (const section of sections) this.addTab(section).setText(section.icon);
		if (this.libraryNames.length > 0) setIcon(this.addTab(LIBRARY), lucideIconId(LIBRARY.icon));
	}

	private addTab(section: { id: string; label: string }): HTMLElement {
		const tabEl = this.tabsEl.createEl("button", {
			cls: "notemoji-picker-tab",
			attr: { "aria-label": section.label, "data-section": section.id, role: "tab" },
		});
		tabEl.addEventListener("click", () => this.jumpTo(section.id));
		return tabEl;
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

	private readonly iconUrl: IconUrl = (icon) =>
		icon.type === "custom"
			? this.options.custom.url(icon.id)
			: this.options.library.storedUrl(icon.name);

	/**
	 * Shows an icon in a tile or the footer. An Obsidian icon shows its copy
	 * (as everywhere else) or else this device's own drawing, which Obsidian
	 * draws quickly enough for scrolling through all of them.
	 */
	private drawIcon(el: HTMLElement, value: string): void {
		const icon = parseIcon(value);
		if (icon?.type === "lucide" && this.options.library.storedUrl(icon.name) === undefined) {
			el.empty();
			setIcon(el, lucideIconId(icon.name));
			return;
		}
		renderIcon(el, value, this.iconUrl);
	}

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
			// Only a selected tile: the best search result, or one reached with the arrows.
			if (this.activeIndex >= 0) this.choose(this.activeIndex);
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
		this.drawIcon(this.footerIconEl, item.value);
		this.footerNameEl.setText(displayName(item.value, item.name || "Custom emoji"));
	}

	private showDefaultFooter(): void {
		const { current } = this.options;
		this.drawIcon(this.footerIconEl, current);
		this.footerNameEl.setText(
			current === "" ? HINT : displayName(current, this.nameOf(current) || "Current emoji"),
		);
	}

	/** Flat index of the tile at (or around) an element. */
	private indexOf(target: HTMLElement | null): number | undefined {
		const el = target?.closest<HTMLElement>(".notemoji-picker-emoji");
		return el ? Number(el.dataset.index) : undefined;
	}

	// ------------------------------------------------------------------ custom icons

	private async upload(): Promise<void> {
		const files = Array.from(this.uploadEl.files ?? []);
		this.uploadEl.value = "";
		const added: string[] = [];
		for (const file of files) {
			try {
				// Checked before reading: a huge file (a video) would fill a phone's memory.
				if (file.size > MAX_UPLOAD_BYTES) {
					throw new Error(
						`"${file.name}" is larger than 20 MB. Please use a smaller image.`,
					);
				}
				added.push(await this.options.custom.upload(file.name, await file.arrayBuffer()));
			} catch (error) {
				new Notice(
					error instanceof Error ? error.message : `Could not add "${file.name}".`,
					UPLOAD_NOTICE_MS,
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

	/** The menu of a custom icon tile (delete); returns false for any other tile. */
	private showTileMenu(target: HTMLElement, position: { x: number; y: number }): boolean {
		const index = this.indexOf(target);
		const icon = parseIcon(index === undefined ? undefined : this.layout?.items[index]?.value);
		if (icon?.type !== "custom") return false;
		new Menu()
			.addItem((item) =>
				item
					.setTitle("Delete custom icon")
					.setIcon("trash")
					.onClick(async () => {
						if (await this.options.custom.remove(icon.id)) await this.loadCustomIcons();
					}),
			)
			.showAtPosition(position);
		return true;
	}

	private submit(value: string): void {
		this.close();
		this.options.onSubmit(value);
	}
}

/** Names of emoji and Obsidian icons start with a capital ("Party popper"); custom icon names stay as they are. */
function displayName(value: string, name: string): string {
	if (parseIcon(value)?.type === "custom") return name;
	return name.charAt(0).toUpperCase() + name.slice(1);
}

const ARROWS: Record<string, "up" | "down" | "left" | "right" | undefined> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};
