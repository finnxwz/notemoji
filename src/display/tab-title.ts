import type { App } from "obsidian";
import { filePathOfLeaf, LeafWithTabHeader } from "../internals";
import type { IconSource } from "./icon-source";

/**
 * Tab titles of every open file (any type), in the main area and pop-out
 * windows. Sidebar tabs show icons instead of titles, so they are skipped.
 */
export function collectTabTitles(
	app: App,
	source: IconSource,
	into: Map<HTMLElement, string>,
): void {
	const { leftSplit, rightSplit } = app.workspace;
	app.workspace.iterateAllLeaves((leaf) => {
		const root = leaf.getRoot();
		if (root === leftSplit || root === rightSplit) return;

		const titleEl = (leaf as LeafWithTabHeader).tabHeaderInnerTitleEl;
		const path = filePathOfLeaf(leaf);
		const emoji = path === undefined ? undefined : source.get(path);
		if (titleEl && emoji !== undefined) into.set(titleEl, emoji);
	});
}
