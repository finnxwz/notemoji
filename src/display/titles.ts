import type { App, TFile } from "obsidian";
import type { NotemojiSettings } from "../data";
import { EmojiAttributes } from "./emoji-attribute";
import type { IconSource } from "./icon-source";
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
		private readonly source: IconSource,
		onPick: (file: TFile) => void,
	) {
		this.noteTitles = new NoteTitleIcons(app, source, onPick);
	}

	sync(settings: NotemojiSettings): void {
		const wanted = this.noteTitles.sync(settings.noteTitle);
		if (settings.showInTabs) collectTabTitles(this.app, this.source, wanted);
		if (settings.showInViewHeader) collectViewHeaders(this.app, this.source, wanted);
		this.attributes.apply(wanted, this.source);
	}

	dispose(): void {
		this.noteTitles.dispose();
		this.attributes.clear();
	}
}
