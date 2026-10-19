import type { App } from "obsidian";
import { filePathOfLeaf } from "../internals";
import type { IconLookup } from "./file-explorer";

/** The title in the view header (top bar) of every open file, any type. */
export function collectViewHeaders(
	app: App,
	lookup: IconLookup,
	into: Map<HTMLElement, string>,
): void {
	app.workspace.iterateAllLeaves((leaf) => {
		const path = filePathOfLeaf(leaf);
		const emoji = path === undefined ? undefined : lookup(path);
		if (emoji === undefined) return;

		const titleEl = leaf.view?.containerEl.querySelector<HTMLElement>(".view-header-title");
		if (titleEl) into.set(titleEl, emoji);
	});
}
