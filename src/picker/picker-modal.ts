import { App, Modal, Platform } from "obsidian";
import { parseEmojiInput } from "../icons/emoji";
import { EmojiEntry, findEntry, getCatalog, searchEmoji } from "./catalog";

export interface PickerOptions {
	/** Modal heading, e.g. "Set note emoji". */
	title: string;
	/** Line below the heading, usually the item's name. */
	description?: string;
	/** The item's current emoji, or "" when it has none. */
	current: string;
	/** Recently used emoji, most recent first. */
	recent: readonly string[];
	/** Called with the chosen emoji, or "" when the emoji should be removed. */
	onSubmit: (emoji: string) => void;
}

interface Tile {
	emoji: string;
	name: string;
	el: HTMLElement;
}

interface Section {
	id: string;
	label: string;
	icon: string;
}

const RECENT: Section = { id: "recent", label: "Recently used", icon: "🕘" };
const HINT = "Type to search, or use the arrow keys.";

/**
 * The emoji picker: search, category tabs, recently used, remove.
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
	private footerEmojiEl!: HTMLElement;
	private footerNameEl!: HTMLElement;

	private tiles: Tile[] = [];
	private activeIndex = -1;
	/** Set once the arrow keys moved the selection: ←/→ then move tiles, not the caret. */
	private navigating = false;

	constructor(app: App, options: PickerOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
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

		this.tabsEl = contentEl.createDiv({
			cls: "notemoji-picker-tabs",
			attr: { role: "tablist" },
		});
		for (const section of this.sections()) {
			this.tabsEl
				.createEl("button", {
					cls: "notemoji-picker-tab",
					text: section.icon,
					attr: { "aria-label": section.label, "data-section": section.id, role: "tab" },
				})
				.addEventListener("click", () => this.jumpTo(section.id));
		}

		this.bodyEl = contentEl.createDiv({ cls: "notemoji-picker-body" });
		this.bodyEl.addEventListener("click", (event) => {
			const tile = this.tileFromEvent(event);
			if (tile) this.submit(tile.emoji);
		});
		this.bodyEl.addEventListener("mouseover", (event) => {
			const tile = this.tileFromEvent(event);
			if (tile) this.showInFooter(tile);
		});
		this.bodyEl.addEventListener("scroll", () => this.highlightTab(), { passive: true });

		const footerEl = contentEl.createDiv({ cls: "notemoji-picker-footer" });
		this.footerEmojiEl = footerEl.createDiv({ cls: "notemoji-picker-footer-emoji" });
		this.footerNameEl = footerEl.createDiv({ cls: "notemoji-picker-footer-name" });

		this.render();

		// On phones the keyboard would cover most of the grid; tap to search instead.
		if (!Platform.isMobile) this.searchEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ------------------------------------------------------------------ rendering

	private sections(): Section[] {
		const sections = getCatalog().map(({ id, label, icon }) => ({ id, label, icon }));
		return this.options.recent.length > 0 ? [RECENT, ...sections] : sections;
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
		if (this.options.recent.length > 0) {
			const gridEl = this.createSection(RECENT.id, RECENT.label);
			for (const emoji of this.options.recent) {
				this.addTile(gridEl, emoji, findEntry(emoji)?.name ?? "");
			}
		}
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
		for (const entry of searchEmoji(getCatalog(), query)) {
			if (entry.emoji !== this.tiles[0]?.emoji) this.addEntry(gridEl, entry);
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

	private addTile(gridEl: HTMLElement, emoji: string, name: string): void {
		const el = gridEl.createEl("button", {
			cls: "notemoji-picker-emoji",
			text: emoji,
			attr: { "aria-label": name || emoji, "data-index": this.tiles.length, tabindex: -1 },
		});
		el.toggleClass("is-current", emoji === this.options.current);
		this.tiles.push({ emoji, name, el });
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
				if (tile) this.submit(tile.emoji);
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
		this.footerEmojiEl.setText(tile.emoji);
		this.footerNameEl.setText(tile.name || "Custom emoji");
	}

	private showDefaultFooter(): void {
		const { current } = this.options;
		this.footerEmojiEl.setText(current);
		this.footerNameEl.setText(
			current === "" ? HINT : (findEntry(current)?.name ?? "Current emoji"),
		);
	}

	private tileFromEvent(event: Event): Tile | undefined {
		const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			".notemoji-picker-emoji",
		);
		return el ? this.tiles[Number(el.dataset.index)] : undefined;
	}

	private submit(emoji: string): void {
		this.close();
		this.options.onSubmit(emoji);
	}
}
