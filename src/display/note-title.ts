import { App, MarkdownView, TFile } from "obsidian";
import type { NoteTitleMode } from "../icons/data";
import type { IconLookup } from "./file-explorer";

const ICON_CLASS = "notemoji-title-icon";

/**
 * The inline title elements of every open note, with their file.
 *
 * Only notes open in workspace tabs count: hover previews are not workspace
 * leaves, and titles inside embeds are skipped explicitly.
 */
export function noteTitles(app: App): Array<{ titleEl: HTMLElement; file: TFile }> {
	const titles: Array<{ titleEl: HTMLElement; file: TFile }> = [];
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.file) continue;
		// Both the editing and the reading view have one.
		for (const titleEl of Array.from(
			view.containerEl.querySelectorAll<HTMLElement>(".inline-title"),
		)) {
			if (titleEl.closest(".markdown-embed, .popover")) continue;
			titles.push({ titleEl, file: view.file });
		}
	}
	return titles;
}

/**
 * Large, clickable emoji above the inline title ("above" mode).
 * The "inline" mode is display-only and handled through `EmojiAttributes`.
 *
 * Hidden by CSS while Obsidian's "Show inline title" is off.
 */
export class NoteTitleIcons {
	private readonly icons = new Set<HTMLElement>();

	constructor(
		private readonly app: App,
		private readonly lookup: IconLookup,
		private readonly onPick: (file: TFile) => void,
	) {}

	/** Renders the "above" icons; returns the inline-mode decorations to apply. */
	sync(mode: NoteTitleMode): Map<HTMLElement, string> {
		const inline = new Map<HTMLElement, string>();
		const wanted = new Set<HTMLElement>();

		if (mode !== "off") {
			for (const { titleEl, file } of noteTitles(this.app)) {
				const emoji = this.lookup(file.path);
				if (emoji === undefined) continue;
				if (mode === "inline") inline.set(titleEl, emoji);
				else wanted.add(this.applyIcon(titleEl, file, emoji));
			}
		}

		for (const icon of this.icons) {
			if (wanted.has(icon)) continue;
			icon.remove();
			this.icons.delete(icon);
		}
		return inline;
	}

	dispose(): void {
		this.sync("off");
	}

	private applyIcon(titleEl: HTMLElement, file: TFile, emoji: string): HTMLElement {
		const previous = titleEl.previousElementSibling;
		let icon =
			previous instanceof HTMLElement && previous.hasClass(ICON_CLASS) ? previous : null;
		if (!icon) {
			icon = this.createIcon();
			titleEl.parentElement?.insertBefore(icon, titleEl);
		}
		icon.dataset.path = file.path;
		const button = icon.firstElementChild;
		if (button && button.textContent !== emoji) button.textContent = emoji;
		this.icons.add(icon);
		return icon;
	}

	private createIcon(): HTMLElement {
		const icon = createDiv({ cls: ICON_CLASS, attr: { contenteditable: "false" } });
		icon.createEl("button", {
			cls: "notemoji-title-icon-button",
			attr: { "aria-label": "Change emoji" },
		});
		// Keep the editor from moving the cursor or taking focus.
		icon.addEventListener("mousedown", (event) => event.preventDefault());
		icon.addEventListener("click", (event) => {
			event.preventDefault();
			const file = this.app.vault.getAbstractFileByPath(icon.dataset.path ?? "");
			if (file instanceof TFile) this.onPick(file);
		});
		return icon;
	}
}
