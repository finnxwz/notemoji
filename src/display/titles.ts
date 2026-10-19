import type { App, TFile } from "obsidian";
import type { NotemojiSettings } from "../icons/data";
import { EmojiAttributes } from "./emoji-attribute";
import type { IconLookup } from "./file-explorer";
import { NoteTitleIcons } from "./note-title";
import { collectTabTitles } from "./tab-title";
import { collectViewHeaders } from "./view-header";

/**
 * Emoji at every title outside the file explorer: note title, tab title and
 * view header title. One idempotent pass renders all of them from scratch.
 */
export class TitleDecorations {
	private readonly attributes = new EmojiAttributes();
	private readonly noteTitles: NoteTitleIcons;

	constructor(
		private readonly app: App,
		private readonly lookup: IconLookup,
		onPick: (file: TFile) => void,
	) {
		this.noteTitles = new NoteTitleIcons(app, lookup, onPick);
	}

	sync(settings: NotemojiSettings): void {
		const wanted = this.noteTitles.sync(settings.noteTitle);
		if (settings.showInTabs) collectTabTitles(this.app, this.lookup, wanted);
		if (settings.showInViewHeader) collectViewHeaders(this.app, this.lookup, wanted);
		this.attributes.apply(wanted);
	}

	dispose(): void {
		this.noteTitles.dispose();
		this.attributes.clear();
	}
}
