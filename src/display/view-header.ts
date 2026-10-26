import type { App } from "obsidian";
import { filePathOfLeaf } from "../internals";
import type { IconSource } from "./icon-source";

/** The title in the view header (top bar) of every open file, any type. */
export function collectViewHeaders(
	app: App,
	source: IconSource,
	into: Map<HTMLElement, string>,
): void {
	app.workspace.iterateAllLeaves((leaf) => {
		const path = filePathOfLeaf(leaf);
		const emoji = path === undefined ? undefined : source.get(path);
		if (emoji === undefined) return;

		const titleEl = leaf.view?.containerEl.querySelector<HTMLElement>(".view-header-title");
		if (titleEl) into.set(titleEl, emoji);
	});
}
